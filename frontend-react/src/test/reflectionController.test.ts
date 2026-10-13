import { afterEach, describe, expect, test } from 'vitest';
import { SessionController } from '../services/sessionController';
import { MapController } from '../features/map/MapController';
import { ReflectionController } from '../features/reflection/ReflectionController';
import { practiceSource, reflectionPracticeId } from '../features/reflection/types';
import { mapBackend, mapData, topic, mapEntry } from './mapBackend';
import { deferred, json, jwt, subscription } from './backend';
const cleanup: {
  session: SessionController;
  map: MapController;
  reflection: ReflectionController;
}[] = [];
afterEach(() =>
  cleanup.splice(0).forEach((value) => {
    value.reflection.stop();
    value.map.stop();
    value.session.stop();
  }),
);
const practice = (id = 'p') => mapEntry(id, 'Pause before reacting', 'practice');
async function setup(options: Parameters<typeof mapBackend>[0] = {}) {
  localStorage.setItem('feely_token', jwt());
  const backend = mapBackend({ initial: mapData([], [practice()]), ...options });
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  await session.reload();
  const map = new MapController(session);
  map.configure(session.getToken(), true, subscription);
  const reflection = new ReflectionController(session, map);
  reflection.configure(session.getToken(), true);
  const result = { session, map, reflection };
  cleanup.push(result);
  return { ...backend, ...result };
}
const ticks = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
describe('Reflection atomic completion and source/draft identity', () => {
  test('only Router-state source is accepted; source belongs to the existing Practice model', () => {
    expect(reflectionPracticeId({ practiceId: 'p', returnTo: 'https://elsewhere.test' })).toBe('p');
    expect(reflectionPracticeId({ practiceId: 3 })).toBeNull();
    expect(reflectionPracticeId({ practiceId: ' ' })).toBeNull();
    const data = mapData([topic('t', 'Topic', { entries: [practice()] })]);
    expect(practiceSource(data, 'p')?.category).toBe('practice');
    expect(practiceSource(data, 'missing')).toBeNull();
  });
  test('no source makes no request or write, and non-practice/missing sources cannot submit', async () => {
    const { reflection, fetch, writes } = await setup({
      initial: mapData([], [mapEntry('note', 'Note')]),
    });
    const before = fetch.mock.calls.length;
    await reflection.open(null);
    expect(fetch.mock.calls.length).toBe(before);
    await reflection.open('note');
    expect(reflection.getSnapshot().loadError).toBe('Practice not found.');
    expect(await reflection.submit()).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  test('initial active/paused practice opens with empty optional answer, completed source is read-only', async () => {
    const { reflection, setData } = await setup({
      initial: mapData([], [{ ...practice(), status: 'paused', reflection: 'Earlier note' }]),
    });
    await reflection.open('p');
    expect(reflection.getSnapshot().answer).toBe('');
    setData(mapData([], [{ ...practice(), status: 'completed', reflection: 'Saved reflection' }]));
    await reflection.open('p', true);
    expect(reflection.getSnapshot().initiallyCompleted).toBe(true);
    expect(reflection.getSnapshot().answer).toBe('Saved reflection');
    reflection.edit('No edit');
    expect(await reflection.submit()).toBe(false);
  });
  test('exact one atomic PATCH trims text and consumes canonical Practice/Map, with no extra entity', async () => {
    const { reflection, map, writes } = await setup();
    await reflection.open('p');
    reflection.edit('  It helped. \n');
    expect(await reflection.submit()).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(String(writes()[0][0])).toBe('http://127.0.0.1:8000/api/v1/users/me/map/practices/p');
    expect(writes()[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      status: 'completed',
      reflection: 'It helped.',
    });
    expect(practiceSource(map.getSnapshot().data, 'p')?.reflection).toBe('It helped.');
    expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('completed');
  });
  test.each(['', '   \n\t'])(
    'optional %j answer sends null without stricter validation',
    async (answer) => {
      const { reflection, writes } = await setup();
      await reflection.open('p');
      reflection.edit(answer);
      expect(await reflection.submit()).toBe(true);
      expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
        status: 'completed',
        reflection: null,
      });
    },
  );
  test('double submission cannot overlap or optimistically complete practice', async () => {
    const pending = deferred<Response>();
    const { reflection, map, writes } = await setup({ write: () => pending.promise });
    await reflection.open('p');
    reflection.edit('Draft');
    const first = reflection.submit();
    await ticks();
    expect(await reflection.submit()).toBe(false);
    expect(writes()).toHaveLength(1);
    expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('active');
    const completed = { ...practice(), status: 'completed' as const, reflection: 'Canonical' };
    pending.resolve(json({ practice: completed, map: mapData([], [completed]) }));
    expect(await first).toBe(true);
    expect(practiceSource(map.getSnapshot().data, 'p')?.reflection).toBe('Canonical');
  });
  test('failed completion retains raw answer, does not complete, and explicit retry reuses the same ID', async () => {
    let fail = true;
    const { reflection, writes } = await setup({
      write: (_path, init) =>
        fail
          ? json({ detail: 'Try again' }, 503)
          : json({
              practice: { ...practice(), ...JSON.parse(String(init.body)) },
              map: mapData([], [{ ...practice(), ...JSON.parse(String(init.body)) }]),
            }),
    });
    await reflection.open('p');
    reflection.edit('  Keep this draft  ');
    expect(await reflection.submit()).toBe(false);
    expect(reflection.getSnapshot().answer).toBe('  Keep this draft  ');
    expect(reflection.getSnapshot().error).toBe('Try again');
    fail = false;
    expect(await reflection.submit()).toBe(true);
    expect(writes()).toHaveLength(2);
  });
  test('network failure is not replayed; answer and active practice remain', async () => {
    const { reflection, map, writes } = await setup({
      write: () => Promise.reject(new TypeError('Offline')),
    });
    await reflection.open('p');
    reflection.edit('Private answer');
    expect(await reflection.submit()).toBe(false);
    expect(writes()).toHaveLength(1);
    expect(reflection.getSnapshot().answer).toBe('Private answer');
    expect(reflection.getSnapshot().error).toContain('lost its connection');
    expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('active');
  });
  test.each(['wrong-status', 'wrong-field', 'map-mismatch'])(
    'malformed %s response cannot report completion',
    async (kind) => {
      const completed = { ...practice(), status: 'completed' as const, reflection: 'Saved' };
      const result =
        kind === 'wrong-status'
          ? practice()
          : kind === 'wrong-field'
            ? { ...completed, reflection: 3 }
            : completed;
      const { reflection, map } = await setup({
        write: () =>
          json({
            practice: result,
            map: mapData([], [kind === 'map-mismatch' ? practice() : (result as typeof completed)]),
          }),
      });
      await reflection.open('p');
      reflection.edit('Keep');
      expect(await reflection.submit()).toBe(false);
      expect(reflection.getSnapshot().error).toContain('invalid Map');
      expect(reflection.getSnapshot().answer).toBe('Keep');
      expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('active');
    },
  );
  test('typing during completion preserves newer answer and retries in the same existing Practice', async () => {
    const pending = deferred<Response>();
    let calls = 0;
    const { reflection, writes } = await setup({
      write: (_path, init) =>
        ++calls === 1
          ? pending.promise
          : json({
              practice: { ...practice(), ...JSON.parse(String(init.body)) },
              map: mapData([], [{ ...practice(), ...JSON.parse(String(init.body)) }]),
            }),
    });
    await reflection.open('p');
    reflection.edit('First');
    const saving = reflection.submit();
    await ticks();
    reflection.edit('Newer');
    const completed = { ...practice(), status: 'completed' as const, reflection: 'First' };
    pending.resolve(json({ practice: completed, map: mapData([], [completed]) }));
    expect(await saving).toBe(false);
    expect(reflection.getSnapshot().answer).toBe('Newer');
    expect(reflection.getSnapshot().completedWithNewEdits).toBe(true);
    expect(await reflection.submit()).toBe(true);
    expect(writes()).toHaveLength(2);
  });
  test('old source read cannot replace a newer practice even when transport ignores abort', async () => {
    const response = deferred<Response>();
    let reads = 0;
    const data = mapData([], [practice('a'), practice('b')]);
    const { reflection } = await setup({
      read: () => (++reads === 1 ? response.promise : json(data)),
    });
    const first = reflection.open('a');
    await ticks();
    await reflection.open('b');
    reflection.edit('B draft');
    response.resolve(json(data));
    await first;
    expect(reflection.getSnapshot().id).toBe('b');
    expect(reflection.getSnapshot().answer).toBe('B draft');
  });
  test('late submission updates Map but cannot close/overwrite a new source or a closed form', async () => {
    const response = deferred<Response>();
    const { reflection, map } = await setup({
      initial: mapData([], [practice('a'), practice('b')]),
      write: () => response.promise,
    });
    await reflection.open('a');
    reflection.edit('A');
    const saving = reflection.submit();
    await ticks();
    const openingB = reflection.open('b');
    const completed = { ...practice('a'), status: 'completed' as const, reflection: 'A' };
    response.resolve(json({ practice: completed, map: mapData([], [completed, practice('b')]) }));
    expect(await saving).toBe(false);
    await openingB;
    expect(reflection.getSnapshot().id).toBe('b');
    expect(reflection.getSnapshot().answer).toBe('');
    expect(practiceSource(map.getSnapshot().data, 'a')?.status).toBe('completed');
  });
  test('close during submission suppresses stale return without canceling backend persistence', async () => {
    const response = deferred<Response>();
    const { reflection, map } = await setup({ write: () => response.promise });
    await reflection.open('p');
    reflection.edit('Saved after close');
    const saving = reflection.submit();
    await ticks();
    reflection.close();
    const completed = {
      ...practice(),
      status: 'completed' as const,
      reflection: 'Saved after close',
    };
    response.resolve(json({ practice: completed, map: mapData([], [completed]) }));
    expect(await saving).toBe(false);
    expect(reflection.getSnapshot().id).toBeNull();
    expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('completed');
  });
  test('same-owner gates preserve draft; changing owner clears private input', async () => {
    const { reflection, session } = await setup();
    await reflection.open('p');
    reflection.edit('Private');
    reflection.configure(session.getToken(), false);
    reflection.configure(session.getToken(), true);
    await reflection.open('p');
    expect(reflection.getSnapshot().answer).toBe('Private');
    reflection.configure(null, false);
    expect(reflection.getSnapshot().answer).toBe('');
  });
  test('completed response remains successful if background refresh fails; no second PATCH is needed', async () => {
    let failReads = false;
    const { reflection, map, writes } = await setup({
      read: () =>
        failReads ? json({ detail: 'Refresh unavailable' }, 503) : json(mapData([], [practice()])),
    });
    await reflection.open('p');
    reflection.edit('Saved');
    expect(await reflection.submit()).toBe(true);
    failReads = true;
    await map.load();
    expect(writes()).toHaveLength(1);
    expect(practiceSource(map.getSnapshot().data, 'p')?.status).toBe('completed');
  });
  test('token changing before provider effects cannot send old form data as the next account', async () => {
    const { reflection, map, session, writes } = await setup();
    await reflection.open('p');
    reflection.edit('Old private answer');
    session.signOut();
    expect(await reflection.submit()).toBe(false);
    expect(await map.practice('p', 'completed', 'Old private answer')).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  test('source deletion after loading is explicit and preserves the unsaved answer', async () => {
    const { reflection, map, setData, writes } = await setup();
    await reflection.open('p');
    reflection.edit('Before deletion');
    setData(mapData());
    await map.load();
    reflection.synchronize();
    expect(reflection.getSnapshot().loadError).toBe('Practice not found.');
    expect(reflection.getSnapshot().answer).toBe('Before deletion');
    expect(await reflection.submit()).toBe(false);
    expect(writes()).toHaveLength(0);
  });
  test('rate limit retains answer/retry semantics and does not replay completion', async () => {
    const { reflection, writes } = await setup({
      write: () => json({ detail: 'Too many requests' }, 429, { 'Retry-After': '15' }),
    });
    await reflection.open('p');
    reflection.edit('Retained');
    expect(await reflection.submit()).toBe(false);
    expect(reflection.getSnapshot().error).toContain('15 seconds');
    expect(reflection.getSnapshot().answer).toBe('Retained');
    expect(writes()).toHaveLength(1);
  });
});
