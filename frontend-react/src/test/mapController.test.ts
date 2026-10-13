import { afterEach, describe, expect, test } from 'vitest';
import { SessionController } from '../services/sessionController';
import { MapController } from '../features/map/MapController';
import * as api from '../features/map/mapApi';
import {
  mapNodes,
  mapEdges,
  visibleLayout,
  nodePosition,
  orderedTopics,
  primaryCategory,
  textPreview,
  OVERALL_ID,
} from '../features/map/mapLayout';
import { queueMapWrite, waitForMapWrites } from '../services/mapResource';
import { topicCategoryOf } from '../types/map';
import { mapBackend, topic, mapEntry, mapData } from './mapBackend';
import { deferred, json, jwt, subscription } from './backend';
import type { TopicPayload } from '../types/map';
import { decideJournalSuggestion } from '../features/journal/journalApi';
import { topicSuggestion } from './journalBackend';
const payload: TopicPayload = {
  title: 'Created',
  category: 'experience',
  description: 'Note',
  parent_topic_id: null,
  related_topic_ids: [],
};
const cleanup: { session: SessionController; controller: MapController }[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((value) => {
    value.controller.stop();
    value.session.stop();
  });
});
async function setup(options: Parameters<typeof mapBackend>[0] = {}) {
  localStorage.setItem('feely_token', jwt());
  const backend = mapBackend(options);
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  await session.reload();
  const controller = new MapController(session);
  controller.configure(session.getToken(), true, subscription);
  cleanup.push({ session, controller });
  return { ...backend, session, controller };
}
const ticks = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve();
};

describe('Map renderer/layout ports', () => {
  test('original desktop slots and clamped repeats are deterministic', () => {
    expect(nodePosition(0)).toEqual({ x: 50, y: 56 });
    expect(nodePosition(1)).toEqual({ x: 23, y: 33 });
    expect(nodePosition(9)).toEqual({ x: 54, y: 44 });
    expect(nodePosition(90)).toEqual({ x: 88, y: 56 });
  });
  test('Overall is synthetic and counts distinct source metadata', () => {
    const nodes = mapNodes(
      mapData(
        [],
        [
          mapEntry('a', 'One', 'value', {
            source_chat_id: 'chat',
            source_journal_date: '2026-10-12',
          }),
          mapEntry('b', 'Two', 'practice', { source_chat_id: 'chat' }),
        ],
      ),
    );
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe(OVERALL_ID);
    expect(nodes[0].chat_ids).toEqual(['chat']);
    expect(nodes[0].journal_dates).toEqual(['2026-10-12']);
  });
  test('mobile two-column board grows without overlap and keeps every bubble inside', () => {
    const data = mapData(Array.from({ length: 30 }, (_, i) => topic(String(i), String(i))));
    const { nodes, height } = visibleLayout(data, 'all', true);
    expect(height).toBeGreaterThan(1800);
    const positions = nodes.map((node) => `${node.position.x}:${node.position.y}`);
    expect(new Set(positions).size).toBe(31);
    expect(nodes.every((node) => node.position.y > 0 && node.position.y < 100)).toBe(true);
    expect(nodes[0].position.x).toBe(50);
  });
  test('filter preserves desktop slots and recalculates mobile coordinates without Overall', () => {
    const data = mapData([
      topic('a', 'A', { category: 'person' }),
      topic('b', 'B', { category: 'trait' }),
    ]);
    expect(visibleLayout(data, 'trait', false).nodes[0].position).toEqual(nodePosition(2));
    expect(visibleLayout(data, 'trait', true).nodes[0].position).toEqual({
      x: 26,
      y: (64 / 430) * 100,
    });
  });
  test('parent edges have direction, symmetric related edges render once and filtered edges disappear', () => {
    const nodes = mapNodes(
      mapData([
        topic('a', 'A', { related_topic_ids: ['b'] }),
        topic('b', 'B', { parent_topic_id: 'a', related_topic_ids: ['a'] }),
      ]),
    );
    const edges = mapEdges(nodes);
    expect(edges).toHaveLength(2);
    expect(edges.find((edge) => edge.type === 'parent')?.source.id).toBe('a');
    expect(edges.find((edge) => edge.type === 'parent')?.target.id).toBe('b');
    expect(mapEdges(nodes.filter((node) => node.id !== 'a'))).toEqual([]);
  });
  test('sidebar parent ordering, orphan compatibility and cycle protection match legacy', () => {
    expect(
      orderedTopics([
        topic('c', 'Child', { parent_topic_id: 'p' }),
        topic('p', 'Parent'),
        topic('o', 'Orphan', { parent_topic_id: 'gone' }),
      ]).map((value) => [value.topic.id, value.depth]),
    ).toEqual([
      ['p', 0],
      ['c', 1],
      ['o', 0],
    ]);
    expect(
      orderedTopics([
        topic('a', 'A', { parent_topic_id: 'b' }),
        topic('b', 'B', { parent_topic_id: 'a' }),
      ]),
    ).toHaveLength(2);
  });
  test('entry colors count stable categories; text collapses whitespace and truncates at 86', () => {
    expect(
      primaryCategory([
        mapEntry('a', 'A', 'value'),
        mapEntry('b', 'B', 'practice'),
        mapEntry('c', 'C', 'practice'),
      ]),
    ).toBe('practice');
    expect(textPreview('  A\n B  ').full).toBe('A B');
    expect(textPreview('x'.repeat(87)).preview).toHaveLength(86);
    expect(topicCategoryOf({ id: 'old', title: 'Old' })).toBe('other');
  });
});
describe('Map API/state/ownership and full-response races', () => {
  test('GET uses unchanged endpoint/Bearer/default credentials and missing Map is empty', async () => {
    const { controller, session, fetch } = await setup();
    await controller.load();
    expect(controller.getSnapshot().data?.topic_spaces).toEqual([]);
    const call = fetch.mock.calls.find((call) => String(call[0]).endsWith('/users/me/map'))!;
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe(`Bearer ${session.getToken()}`);
    expect(call[1]?.credentials).toBeUndefined();
    controller.stop();
  });
  test('invalid/wrong graph DTO is rejected without corrupting existing Map', async () => {
    let malformed = false;
    const original = mapData([topic('a', 'A')]);
    const { controller } = await setup({
      read: () => json(malformed ? { topic_spaces: null } : original),
    });
    await controller.load();
    malformed = true;
    await controller.load();
    expect(controller.getSnapshot().loadError).toContain('invalid Map');
    expect(controller.getSnapshot().data).toEqual(original);
    controller.stop();
  });
  test('newer reads win even when abort is ignored by transport', async () => {
    const old = deferred<Response>();
    let calls = 0;
    const { controller } = await setup({
      read: () => (++calls === 1 ? old.promise : json(mapData([topic('new', 'New')]))),
    });
    const first = controller.load();
    await ticks();
    await controller.load();
    old.resolve(json(mapData([topic('old', 'Old')])));
    await first;
    expect(controller.getSnapshot().data?.topic_spaces[0].id).toBe('new');
    controller.stop();
  });
  test('leave/unmount and owner change reject late private graph responses', async () => {
    const response = deferred<Response>();
    const { controller } = await setup({ read: () => response.promise });
    const load = controller.visit();
    await ticks();
    controller.leave();
    controller.configure(null, false, null);
    response.resolve(json(mapData([topic('private', 'Private')])));
    await load;
    expect(controller.getSnapshot().data).toBeNull();
    expect(controller.getSnapshot().loading).toBe(false);
    controller.stop();
  });
  test('selection survives refresh if present; disappears if deleted; close keeps bubble selected', async () => {
    const { controller, setData } = await setup({ initial: mapData([topic('a', 'A')]) });
    await controller.load();
    controller.select('a');
    controller.closeDetails();
    expect(controller.getSnapshot().selected).toBe('a');
    expect(controller.getSnapshot().detailOpen).toBe(false);
    controller.select('a');
    await controller.load();
    expect(controller.getSnapshot().detailOpen).toBe(true);
    setData(mapData());
    await controller.load();
    expect(controller.getSnapshot().selected).toBeNull();
    controller.stop();
  });
  test('filter clears selection and selecting a hidden node resets mismatching filter', async () => {
    const { controller } = await setup({
      initial: mapData([topic('a', 'A', { category: 'person' })]),
    });
    await controller.load();
    controller.filter('trait');
    controller.select('a');
    expect(controller.getSnapshot().filter).toBe('all');
    controller.filter('other');
    expect(controller.getSnapshot().selected).toBeNull();
    controller.stop();
  });
  test('topic creation uses exact payload/null chat source and canonical full Map', async () => {
    const { controller, writes } = await setup();
    await controller.load();
    expect(await controller.saveTopic(payload)).toBe(true);
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ ...payload, chat_id: null });
    expect(controller.getSnapshot().selected).toBe('created-1');
    controller.stop();
  });
  test('pending duplicate node writes are skipped and fields are normalized from backend', async () => {
    const response = deferred<Response>();
    const { controller, writes } = await setup({
      initial: mapData([topic('a', 'A')]),
      write: () => response.promise,
    });
    await controller.load();
    const save = controller.saveTopic(payload, 'a');
    await ticks();
    expect(await controller.saveTopic(payload, 'a')).toBe(false);
    expect(writes()).toHaveLength(1);
    response.resolve(
      json({ topic: topic('a', 'Canonical'), map: mapData([topic('a', 'Canonical')]) }),
    );
    await save;
    expect(controller.getSnapshot().data?.topic_spaces[0].title).toBe('Canonical');
    controller.stop();
  });
  test('mutation does not reset a newer user selection', async () => {
    const response = deferred<Response>();
    const original = mapData([topic('a', 'A'), topic('b', 'B')]);
    const { controller } = await setup({ initial: original, write: () => response.promise });
    await controller.load();
    controller.select('a');
    const save = controller.saveTopic(payload, 'a');
    await ticks();
    controller.select('b');
    response.resolve(
      json({
        topic: topic('a', 'Updated'),
        map: mapData([topic('a', 'Updated'), topic('b', 'B')]),
      }),
    );
    await save;
    expect(controller.getSnapshot().selected).toBe('b');
    controller.stop();
  });
  test('failed mutation leaves graph unchanged and reports exact server error without replay', async () => {
    const original = mapData([topic('a', 'A')]);
    const { controller, writes } = await setup({
      initial: original,
      write: () => json({ detail: 'Topic hierarchy cannot contain a cycle' }, 400),
    });
    await controller.load();
    expect(await controller.saveTopic(payload, 'a')).toBe(false);
    expect(controller.getSnapshot().data).toEqual(original);
    expect(controller.getSnapshot().error).toContain('cycle');
    expect(writes()).toHaveLength(1);
    controller.stop();
  });
  test('stale graph read cannot roll back a completed mutation', async () => {
    const response = deferred<Response>();
    const { controller } = await setup({ read: () => response.promise });
    const read = controller.load();
    await ticks();
    await controller.saveTopic(payload);
    response.resolve(json(mapData()));
    await read;
    expect(controller.getSnapshot().data?.topic_spaces[0].title).toBe('Created');
    controller.stop();
  });
  test('different writes serialize full maps without freezing selection', async () => {
    const first = deferred<Response>();
    let calls = 0;
    const { controller, writes } = await setup({
      initial: mapData([topic('a', 'A'), topic('b', 'B')]),
      write: (_path, _init, data) =>
        ++calls === 1 ? first.promise : json({ topic: data.topic_spaces[1], map: data }),
    });
    await controller.load();
    const one = controller.saveTopic(payload, 'a');
    const two = controller.saveTopic(payload, 'b');
    await ticks();
    expect(writes()).toHaveLength(1);
    controller.select('b');
    first.resolve(
      json({ topic: topic('a', 'First'), map: mapData([topic('a', 'First'), topic('b', 'B')]) }),
    );
    await Promise.all([one, two]);
    expect(writes()).toHaveLength(2);
    expect(controller.getSnapshot().selected).toBe('b');
    controller.stop();
  });
  test('queued writes capture token ownership and cannot send an old payload as another user', async () => {
    const { session } = await setup();
    const pending = deferred<void>();
    const first = queueMapWrite(session.api, async () => pending.promise);
    await ticks();
    let sent = false;
    const queued = queueMapWrite(session.api, async () => {
      sent = true;
    });
    const checked = expect(queued).rejects.toMatchObject({ status: 401 });
    session.signOut();
    pending.resolve();
    await first;
    await checked;
    expect(sent).toBe(false);
    session.stop();
  });
  test('server 402 wins over client capability and requires real capability refresh', async () => {
    const { controller, session } = await setup({
      read: () => json({ detail: 'Premium is required to access My Map.' }, 402),
    });
    await controller.load();
    expect(controller.getSnapshot().denied).toBe(true);
    controller.configure(session.getToken(), true, subscription);
    expect(controller.getSnapshot().enabled).toBe(false);
    controller.configure(session.getToken(), true, { ...subscription });
    expect(controller.getSnapshot().enabled).toBe(true);
    controller.stop();
  });
  test('entry create/edit/delete and practice status use exact legacy payloads/methods', async () => {
    const { session, writes } = await setup();
    const created = await api.createEntry(session.api, {
      category: 'practice',
      text: 'Pause',
      topic_space_id: null,
      source_chat_id: null,
    });
    await api.updateEntry(session.api, created.entry!.id, {
      category: 'practice',
      text: 'Pause again',
      topic_space_id: null,
    });
    await api.updatePractice(session.api, created.entry!.id, 'paused');
    await api.deleteEntry(session.api, created.entry!.id);
    expect(writes().map((call) => call[1]?.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE']);
    expect(JSON.parse(String(writes()[2][1]?.body))).toEqual({
      status: 'paused',
      reflection: null,
    });
    expect(writes()[3][1]?.body).toBeUndefined();
    session.stop();
  });
  test('topic merge/delete/disconnect use original endpoints without edge/position API', async () => {
    const { controller, writes } = await setup({
      initial: mapData([
        topic('a', 'A', { related_topic_ids: ['b'] }),
        topic('b', 'B', { related_topic_ids: ['a'] }),
      ]),
    });
    await controller.load();
    await controller.disconnect('a', 'Related', 'b');
    await controller.merge('a', 'b');
    await controller.deleteTopic('b');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ related_topic_ids: [] });
    expect(JSON.parse(String(writes()[1][1]?.body))).toEqual({ target_topic_space_id: 'b' });
    expect(writes()[2][1]?.method).toBe('DELETE');
    controller.stop();
  });
  test('write invalidation refreshes active Map, but never refetches the hidden workspace', async () => {
    const { controller, session, fetch } = await setup();
    await controller.visit();
    await api.createTopic(session.api, payload);
    await ticks();
    await waitForMapWrites(session.api);
    await ticks();
    expect(controller.getSnapshot().data?.topic_spaces[0].title).toBe('Created');
    controller.leave();
    const before = fetch.mock.calls.length;
    await api.createTopic(session.api, payload);
    await ticks();
    expect(
      fetch.mock.calls.slice(before).filter((call) => String(call[0]).endsWith('/users/me/map')),
    ).toHaveLength(0);
    controller.stop();
  });
  test('network mutation failure is not retried and preserves the authoritative graph', async () => {
    const original = mapData([topic('a', 'A')]);
    const { controller, writes } = await setup({
      initial: original,
      write: () => Promise.reject(new TypeError('Offline')),
    });
    await controller.load();
    expect(await controller.saveTopic(payload, 'a')).toBe(false);
    expect(writes()).toHaveLength(1);
    expect(controller.getSnapshot().errorStatus).toBe(0);
    expect(controller.getSnapshot().data).toEqual(original);
  });
  test('malformed/wrong-identifier mutation is rejected without applying another topic', async () => {
    const original = mapData([topic('a', 'A')]);
    const { controller } = await setup({
      initial: original,
      write: () =>
        json({ topic: topic('wrong', 'Wrong'), map: mapData([topic('wrong', 'Wrong')]) }),
    });
    await controller.load();
    expect(await controller.saveTopic(payload, 'a')).toBe(false);
    expect(controller.getSnapshot().data).toEqual(original);
    expect(controller.getSnapshot().error).toContain('invalid Map');
  });
  test('Under disconnect patches selected child, Contains patches connected child', async () => {
    const { controller, writes } = await setup({
      initial: mapData([topic('a', 'A'), topic('b', 'B', { parent_topic_id: 'a' })]),
    });
    await controller.load();
    await controller.disconnect('a', 'Contains', 'b');
    expect(String(writes()[0][0])).toContain('/topics/b');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ parent_topic_id: null });
    await controller.disconnect('b', 'Under', 'a');
    expect(String(writes()[1][0])).toContain('/topics/b');
  });
  test('practice double click does not overlap writes and applies server status', async () => {
    const pending = deferred<Response>();
    const practice = mapEntry('p', 'Pause', 'practice');
    const { controller, writes } = await setup({
      initial: mapData([], [practice]),
      write: () => pending.promise,
    });
    await controller.load();
    const first = controller.practice('p', 'paused');
    await ticks();
    expect(await controller.practice('p', 'active')).toBe(false);
    expect(writes()).toHaveLength(1);
    const paused = { ...practice, status: 'paused' as const };
    pending.resolve(json({ practice: paused, map: mapData([], [paused]) }));
    await first;
    expect(controller.getSnapshot().data?.unassigned_entries[0].status).toBe('paused');
  });
  test('late delete response cannot reset a newer selection or be rolled back by stale GET', async () => {
    const get = deferred<Response>(),
      remove = deferred<Response>();
    let reads = 0;
    const original = mapData([topic('a', 'A'), topic('b', 'B')]);
    const { controller } = await setup({
      read: () => (++reads === 1 ? json(original) : get.promise),
      write: () => remove.promise,
    });
    await controller.load();
    controller.select('a');
    const refresh = controller.load();
    await ticks();
    const deleting = controller.deleteTopic('a');
    await ticks();
    controller.select('b');
    remove.resolve(
      json({ deleted: true, topic: original.topic_spaces[0], map: mapData([topic('b', 'B')]) }),
    );
    await deleting;
    get.resolve(json(original));
    await refresh;
    expect(controller.getSnapshot().selected).toBe('b');
    expect(controller.getSnapshot().data?.topic_spaces.map((topic) => topic.id)).toEqual(['b']);
  });
  test('Journal review waits for Map write and invalidates an already-running graph read', async () => {
    const oldRead = deferred<Response>(),
      mapWrite = deferred<Response>();
    let graphReads = 0,
      journalCalls = 0;
    const { controller, session } = await setup({
      read: () =>
        ++graphReads === 1
          ? oldRead.promise
          : json(mapData([topic('m', 'Manual'), topic('j', 'Journal')])),
      write: () => mapWrite.promise,
      overrides: {
        '/journal/entries/2026-10-12/suggestions/topic-1': () => {
          journalCalls++;
          return json({
            suggestion: { ...topicSuggestion, status: 'saved', saved_item_id: 'j' },
            map: mapData([topic('m', 'Manual'), topic('j', 'Journal')]),
          });
        },
      },
    });
    const reading = controller.visit();
    await ticks();
    const saving = controller.saveTopic(payload);
    await ticks();
    const review = decideJournalSuggestion(session.api, '2026-10-12', 'topic-1', {
      accepted: true,
    });
    await ticks();
    expect(journalCalls).toBe(0);
    mapWrite.resolve(json({ topic: topic('m', 'Manual'), map: mapData([topic('m', 'Manual')]) }));
    await saving;
    await review;
    await controller.load();
    oldRead.resolve(json(mapData()));
    await reading;
    expect(controller.getSnapshot().data?.topic_spaces.map((topic) => topic.id)).toEqual([
      'm',
      'j',
    ]);
    expect(journalCalls).toBe(1);
  });
  test('Map mutation completion after route leave closes no newer UI and still persists server data', async () => {
    const response = deferred<Response>();
    const { controller } = await setup({ write: () => response.promise });
    await controller.visit();
    controller.openTopic();
    const saving = controller.saveTopic(payload);
    await ticks();
    controller.leave();
    response.resolve(json({ topic: topic('new', 'New'), map: mapData([topic('new', 'New')]) }));
    await saving;
    expect(controller.getSnapshot().popup).toBeNull();
    expect(controller.getSnapshot().data?.topic_spaces[0].title).toBe('New');
  });
});
