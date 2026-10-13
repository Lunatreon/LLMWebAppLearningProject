import { afterEach, describe, expect, test, vi } from 'vitest';
import { SessionController } from '../services/sessionController';
import { JournalController } from '../features/journal/JournalController';
import {
  formattedJournalDate,
  journalWordTotal,
  localDateKey,
  shiftedDateKey,
} from '../features/journal/dates';
import { deferred, json, jwt } from './backend';
import { entry, journalBackend, topicSuggestion } from './journalBackend';

const day = '2026-10-12';
const controllers: { journal: JournalController; session: SessionController }[] = [];
afterEach(() => {
  controllers.splice(0).forEach(({ journal, session }) => {
    journal.stop();
    session.stop();
  });
});
async function setup(options: Parameters<typeof journalBackend>[0] = {}, visit = true) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 12));
  localStorage.setItem('feely_token', jwt());
  const backend = journalBackend(options);
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  await session.reload();
  const journal = new JournalController(session);
  journal.configure(session.getToken(), true, {});
  controllers.push({ journal, session });
  if (visit) await journal.visit();
  return { ...backend, session, journal };
}
const tick = async (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('Journal calendar and autosave state', () => {
  test.each([
    ['2024-02-28', 1, '2024-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-03-28', 1, '2026-03-29'],
    ['2026-10-25', -1, '2026-10-24'],
  ])('local-noon calendar shift %s by %s is %s', (date, offset, expected) => {
    expect(shiftedDateKey(date, offset)).toBe(expected);
    expect(formattedJournalDate(date)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(
        new Date(`${date}T12:00:00`),
      ),
    );
  });
  test('local date/word semantics preserve calendar components and whitespace', () => {
    expect(localDateKey(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
    expect(journalWordTotal('  one\ntwo\tthree  ')).toBe(3);
    expect(journalWordTotal('  ')).toBe(0);
  });
  test('first visit after midnight selects that local day, while later visits retain the selected page', async () => {
    const { journal, session } = await setup({}, false);
    localStorage.setItem('feely_token', jwt(Date.now() / 1000 + 86400));
    await session.reload();
    journal.configure(session.getToken(), true, {});
    vi.setSystemTime(new Date(2026, 9, 13, 0, 1));
    await journal.visit();
    expect(journal.getSnapshot().selected).toBe('2026-10-13');
    await journal.open('2026-10-11');
    await journal.visit();
    expect(journal.getSnapshot().selected).toBe('2026-10-11');
  });
  test('missing day loads an empty model without a PUT, and history uses exactly limit=180', async () => {
    const { journal, puts, fetch } = await setup();
    expect(journal.getSnapshot()).toMatchObject({
      selected: day,
      dirty: false,
      draft: { text: '', message: 'New page' },
    });
    expect(puts().length).toBe(0);
    expect(
      fetch.mock.calls.some((call) => String(call[0]).endsWith('/journal/entries?limit=180')),
    ).toBe(true);
  });
  test('autosave waits 900ms after latest input and sends only raw content with Bearer/default credentials', async () => {
    const { journal, puts, session } = await setup();
    journal.edit(' first\n draft ');
    await tick(899);
    expect(puts().length).toBe(0);
    journal.edit(' latest\n draft ');
    await tick(899);
    expect(puts().length).toBe(0);
    expect(journal.getSnapshot().draft.message).toBe('Unsaved');
    await tick(1);
    expect(puts().length).toBe(1);
    const options = puts()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({ content: ' latest\n draft ' });
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${session.getToken()}`);
    expect(options.credentials).toBeUndefined();
    expect(journal.getSnapshot()).toMatchObject({ dirty: false, draft: { message: 'Saved' } });
  });
  test('unchanged/reverted content does not save or lazily create a row', async () => {
    const { journal, puts } = await setup();
    journal.edit('');
    journal.edit('discarded');
    journal.edit('');
    await tick(1000);
    expect(puts().length).toBe(0);
    expect(journal.getSnapshot().dirty).toBe(false);
  });
  test('duplicate save requests coalesce and a live editor preserves newer text while an older PUT completes', async () => {
    const response = deferred<Response>();
    let first = true;
    const { journal, puts } = await setup({
      write: (date, text) => {
        if (first) {
          first = false;
          return response.promise;
        }
        return json(entry(date, text, true));
      },
    });
    journal.edit('old draft');
    await tick(900);
    journal.edit('new draft');
    expect(journal.getSnapshot()).toMatchObject({
      dirty: true,
      draft: { text: 'new draft', saving: true },
    });
    response.resolve(json(entry(day, 'old draft', true)));
    await tick(0);
    expect(journal.getSnapshot().draft.text).toBe('new draft');
    expect(journal.getSnapshot().dirty).toBe(true);
    await tick(899);
    expect(puts().length).toBe(1);
    await tick(1);
    expect(puts().length).toBe(2);
    await Promise.all([journal.save(), journal.save()]);
    expect(puts().length).toBe(2);
    expect(journal.getSnapshot().dirty).toBe(false);
  });
  test('a queued autosave does not bypass the 900ms debounce of a newer edit', async () => {
    const response = deferred<Response>();
    let first = true;
    const { journal, puts } = await setup({
      write: (date, text) => {
        if (first) {
          first = false;
          return response.promise;
        }
        return json(entry(date, text, true));
      },
    });
    journal.edit('one');
    await tick(900);
    journal.edit('two');
    await tick(900);
    journal.edit('three');
    await tick(100);
    response.resolve(json(entry(day, 'one', true)));
    await tick(0);
    expect(puts().length).toBe(1);
    expect(journal.getSnapshot().draft.text).toBe('three');
    await tick(799);
    expect(puts().length).toBe(1);
    await tick(1);
    expect(puts().length).toBe(2);
    expect(JSON.parse(String(puts()[1][1]?.body)).content).toBe('three');
  });
  test('reverting to the baseline while an older write is pending remains dirty and is persisted afterward', async () => {
    const response = deferred<Response>();
    let first = true;
    const { journal, puts } = await setup({
      write: (date, text) => {
        if (first) {
          first = false;
          return response.promise;
        }
        return json(entry(date, text, true));
      },
    });
    journal.edit('written');
    await tick(900);
    journal.edit('');
    expect(journal.getSnapshot().dirty).toBe(true);
    response.resolve(json(entry(day, 'written', true)));
    await tick(0);
    await tick(900);
    expect(puts().length).toBe(2);
    expect(JSON.parse(String(puts()[1][1]?.body))).toEqual({ content: '' });
    expect(journal.getSnapshot().dirty).toBe(false);
  });
  test('failed save after newer edits keeps those edits dirty and does not replay writes automatically', async () => {
    const response = deferred<Response>();
    const { journal, puts } = await setup({ write: () => response.promise });
    journal.edit('old');
    await tick(900);
    journal.edit('latest');
    response.resolve(json({ detail: 'Save unavailable' }, 503));
    await tick(0);
    expect(journal.getSnapshot()).toMatchObject({
      dirty: true,
      draft: { text: 'latest', status: 'error', message: 'Save unavailable' },
    });
    expect(puts().length).toBe(1);
  });
  test('manual retry persists failed text and clears dirty only after success', async () => {
    let fail = true;
    const { journal, puts } = await setup({
      write: (date, text) =>
        fail ? json({ detail: 'Save unavailable' }, 503) : json(entry(date, text, true)),
    });
    journal.edit('retain');
    await tick(900);
    await tick(2000);
    expect(puts().length).toBe(1);
    expect(journal.getSnapshot().dirty).toBe(true);
    fail = false;
    expect(await journal.flush()).toBe(true);
    expect(puts().length).toBe(2);
    expect(journal.getSnapshot().draft.message).toBe('Saved');
  });
  test('date navigation flushes latest edits before GET and a failed flush leaves selected date/text intact', async () => {
    let fail = true;
    const { journal, fetch } = await setup({
      write: (date, text) =>
        fail ? json({ detail: 'Could not save' }, 503) : json(entry(date, text, true)),
    });
    journal.edit('unsaved');
    expect(await journal.open('2026-10-11')).toBe(false);
    expect(journal.getSnapshot()).toMatchObject({
      selected: day,
      draft: { text: 'unsaved' },
      dirty: true,
    });
    expect(
      fetch.mock.calls.some((call) => String(call[0]).endsWith('/journal/entries/2026-10-11')),
    ).toBe(false);
    fail = false;
    expect(await journal.open('2026-10-11')).toBe(true);
    expect(journal.getSnapshot().selected).toBe('2026-10-11');
  });
  test('rapid date switching aborts/ignores an older response arriving after the newer date', async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const { journal } = await setup({
      read: (date) =>
        date === '2026-10-10'
          ? older.promise
          : date === '2026-10-11'
            ? newer.promise
            : json(entry(date)),
    });
    const first = journal.open('2026-10-10');
    await tick(0);
    const second = journal.open('2026-10-11');
    await tick(0);
    newer.resolve(json(entry('2026-10-11', 'newer date', true)));
    await second;
    older.resolve(json(entry('2026-10-10', 'older date', true)));
    await first;
    expect(journal.getSnapshot()).toMatchObject({
      selected: '2026-10-11',
      draft: { text: 'newer date' },
    });
  });
  test('history reads cannot overwrite rows saved after the history request began', async () => {
    let delayed = false;
    const response = deferred<Response>();
    const { journal } = await setup({ history: () => (delayed ? response.promise : json([])) });
    delayed = true;
    const reading = journal.loadHistory();
    journal.edit('fresh history content');
    await journal.flush();
    response.resolve(json([]));
    await reading;
    expect(journal.getSnapshot().history[0].excerpt).toBe('fresh history content');
  });
  test('local empty/no-suggestion history removal follows legacy while a fresh server index can return that empty row', async () => {
    const { journal } = await setup({ initial: { [day]: entry(day, 'existing', true) } });
    journal.edit('');
    await journal.flush();
    expect(journal.getSnapshot().history.length).toBe(0);
    await journal.loadHistory();
    expect(journal.getSnapshot().history.length).toBe(1);
  });
  test('load/history/malformed failures are explicit without inventing empty successful entries', async () => {
    const { journal } = await setup({
      read: () => json({ detail: 'Entry unavailable' }, 503),
      history: () => json({ invalid: true }),
    });
    expect(journal.getSnapshot().draft.loadError).toBe('Entry unavailable');
    expect(journal.getSnapshot().draft.entry).toBeNull();
    expect(journal.getSnapshot().historyError).toContain('invalid Journal data');
  });
  test('network PUT errors preserve dirty text and are never retried', async () => {
    const { journal, puts } = await setup({
      write: () => Promise.reject(new TypeError('Offline')),
    });
    journal.edit('offline draft');
    await tick(900);
    expect(puts().length).toBe(1);
    expect(journal.getSnapshot()).toMatchObject({
      dirty: true,
      draft: { text: 'offline draft', status: 'error' },
    });
  });
  test('capability loss pauses saves and preserves same-owner drafts until verified access returns', async () => {
    const { journal, puts, session } = await setup();
    journal.edit('paused');
    journal.configure(session.getToken(), false, {});
    await tick(1000);
    expect(puts().length).toBe(0);
    expect(journal.getSnapshot().draft.text).toBe('paused');
    journal.configure(session.getToken(), true, {});
    await tick(900);
    expect(puts().length).toBe(1);
  });
  test('server 402 is authoritative even with a previously allowed capability snapshot', async () => {
    const { journal } = await setup({
      read: () => json({ detail: 'Premium is required to access Journal.' }, 402),
    });
    expect(journal.getSnapshot()).toMatchObject({ enabled: false, denied: true });
  });
  test('owner change clears private text/history and old saves cannot populate another account', async () => {
    const response = deferred<Response>();
    const { journal, session } = await setup({ write: () => response.promise });
    journal.edit('private');
    await tick(900);
    const next = jwt(undefined, '2');
    localStorage.setItem('feely_token', next);
    await session.reload();
    journal.configure(next, true, {});
    response.resolve(json(entry(day, 'private', true)));
    await tick(0);
    expect(journal.getSnapshot().draft.text).toBe('');
    expect(journal.getSnapshot().history).toEqual([]);
  });
  test('keepalive sends the exact same PUT contract and a failure stays dirty', async () => {
    const { journal, puts } = await setup({
      write: () => json({ detail: 'Keepalive failed' }, 503),
    });
    journal.edit('retained');
    await journal.flushAll(true);
    expect(puts()[0][1]?.keepalive).toBe(true);
    expect(journal.getSnapshot()).toMatchObject({ dirty: true, draft: { text: 'retained' } });
  });
  test('analysis flushes first, serializes with PUTs and preserves edits typed while analysis runs', async () => {
    const analysed = deferred<Response>();
    const { journal, puts, posts } = await setup({ analyse: () => analysed.promise });
    journal.edit('Long journal text for analysis');
    const analysing = journal.analyse();
    await tick(0);
    expect(puts().length).toBe(1);
    expect(posts().length).toBe(1);
    journal.edit('A newer journal text');
    await tick(900);
    expect(puts().length).toBe(1);
    analysed.resolve(
      json({ entry: entry(day, 'Long journal text for analysis', true, [topicSuggestion]) }),
    );
    await analysing;
    await tick(0);
    expect(journal.getSnapshot().draft.text).toBe('A newer journal text');
    expect(puts().length).toBe(2);
  });
  test('suggestion decisions use exact date/id payload and reviewed state without a Map page migration', async () => {
    const { journal, posts } = await setup({
      initial: { [day]: entry(day, 'Text with topic suggestions', true, [topicSuggestion]) },
    });
    await journal.decide(topicSuggestion.id, { accepted: false });
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ accepted: false });
    expect(String(posts()[0][0])).toContain(`/journal/entries/${day}/suggestions/topic-1`);
    expect(journal.getSnapshot().draft.entry?.suggestions[0].status).toBe('dismissed');
  });
  test('load network failure uses the shared single GET retry and preserves explicit failure', async () => {
    const { journal, fetch } = await setup(
      { read: () => Promise.reject(new TypeError('Offline')) },
      false,
    );
    const loading = journal.visit();
    await tick(400);
    await loading;
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith(`/journal/entries/${day}`)).length,
    ).toBe(2);
    expect(journal.getSnapshot().draft.loadError).toContain('temporarily lost its connection');
  });
  test('malformed load/save responses never replace the editor or mark a dirty draft saved', async () => {
    const { journal } = await setup({
      write: () => json({ ...entry('2026-10-11', 'wrong date', true) }),
    });
    journal.edit('safe local text');
    await journal.flush();
    expect(journal.getSnapshot()).toMatchObject({
      dirty: true,
      draft: { text: 'safe local text', status: 'error' },
    });
  });
  test('typing while a date-change flush is pending saves the newer text before loading another day', async () => {
    const response = deferred<Response>();
    let first = true;
    const { journal, puts } = await setup({
      write: (date, text) => {
        if (first) {
          first = false;
          return response.promise;
        }
        return json(entry(date, text, true));
      },
    });
    journal.edit('before date change');
    const opening = journal.open('2026-10-11');
    await tick(0);
    journal.edit('latest before leaving');
    expect(journal.getSnapshot().selected).toBe(day);
    response.resolve(json(entry(day, 'before date change', true)));
    await opening;
    expect(puts().length).toBe(2);
    expect(JSON.parse(String(puts()[1][1]?.body)).content).toBe('latest before leaving');
    expect(journal.getSnapshot().selected).toBe('2026-10-11');
  });
  test('an older same-date GET cannot replace analysis metadata committed after it began', async () => {
    let delayed = false;
    const reading = deferred<Response>();
    const analysis = deferred<Response>();
    const { journal } = await setup({
      read: (date) =>
        delayed ? reading.promise : json(entry(date, 'Enough text for an analysis', true)),
      analyse: () => analysis.promise,
    });
    const analysing = journal.analyse();
    await tick(0);
    delayed = true;
    const opening = journal.open(day);
    await tick(0);
    analysis.resolve(
      json({ entry: entry(day, 'Enough text for an analysis', true, [topicSuggestion]) }),
    );
    await analysing;
    reading.resolve(json(entry(day, 'Enough text for an analysis', true)));
    await opening;
    expect(journal.getSnapshot().draft.entry?.suggestions.length).toBe(1);
  });
  test('a delayed topic-options GET cannot replace the newer map returned by suggestion review', async () => {
    let delayed = false;
    const response = deferred<Response>();
    const { journal } = await setup({
      initial: { [day]: entry(day, 'Topic suggestion', true, [topicSuggestion]) },
      topics: () => (delayed ? response.promise : json({ topic_spaces: [] })),
    });
    delayed = true;
    const reading = journal.loadTopics();
    await journal.decide(topicSuggestion.id, { accepted: true });
    response.resolve(json({ topic_spaces: [] }));
    await reading;
    expect(journal.getSnapshot().topics[0].id).toBe('saved-1');
  });
});
