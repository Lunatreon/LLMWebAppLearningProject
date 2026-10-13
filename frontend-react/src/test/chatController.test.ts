import { describe, expect, test, vi } from 'vitest';
import {
  chat,
  chatBackend,
  controlledStream,
  streamResponse,
  generation,
  detectedTopic,
  detectedNote,
} from './chatBackend';
import { deferred, json } from './backend';
import { setup, tick } from './chatControllerHarness';
import * as api from '../features/chat/chatApi';

describe('Chat ownership/history/send/races', () => {
  test('initial list order is server-authoritative; blank new conversation makes no POST', async () => {
    const { controller, writes } = await setup({ initial: [chat('b'), chat('a')] });
    expect(controller.getSnapshot().chats.map((value) => value.chat_id)).toEqual(['b', 'a']);
    expect(controller.getSnapshot().active).toBeNull();
    controller.newConversation();
    expect(writes()).toHaveLength(0);
  });
  test('first send creates exactly {} then streams; canonical exchange appears once', async () => {
    const { controller, writes } = await setup();
    controller.edit('  Hello  ');
    expect(await controller.send()).toBe(true);
    expect(writes().map((call) => call[1]?.method)).toEqual(['POST', 'POST']);
    expect(writes()[0][1]?.body).toBe('{}');
    expect(controller.getSnapshot().active).toBe('created-1');
    expect(controller.getSnapshot().chats[0].messages).toHaveLength(2);
    expect(controller.getSnapshot().draft).toBe('');
  });
  test('A late history read cannot replace B; array ordering is retained', async () => {
    const pending = deferred<Response>();
    const { controller } = await setup({
      initial: [chat('a'), chat('b', 'B', 'B history')],
      read: (id) => (id === 'a' ? pending.promise : json(chat('b', 'B', 'B history'))),
    });
    const first = controller.select('a');
    await tick();
    await controller.select('b');
    pending.resolve(json(chat('a', 'Late A', 'A history')));
    await first;
    expect(controller.getSnapshot().active).toBe('b');
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'b')?.messages[0].content,
    ).toBe('B history');
  });
  test('generation in A continues while B is selected and never changes B messages/title', async () => {
    let pieces!: ReturnType<typeof controlledStream>;
    const { controller } = await setup({
      initial: [chat('a'), chat('b', 'B')],
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    await controller.select('a');
    controller.edit('Hello');
    const sending = controller.send();
    await tick();
    await controller.select('b');
    pieces.event({ type: 'text_delta', text: 'A partial' });
    pieces.event({ type: 'result', data: generation(chat('a', 'A saved')) });
    pieces.close();
    await sending;
    expect(controller.getSnapshot().active).toBe('b');
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'a')?.messages,
    ).toHaveLength(2);
    expect(controller.getSnapshot().chats.find((value) => value.chat_id === 'b')?.messages).toEqual(
      [],
    );
  });
  test('Stop aborts once, removes partial/optimistic exchange and preserves newer composer typing', async () => {
    let pieces!: ReturnType<typeof controlledStream>;
    const { controller, writes } = await setup({
      initial: [chat('a')],
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    await controller.select('a');
    controller.edit('Hello');
    const sending = controller.send();
    await tick();
    pieces.event({ type: 'text_delta', text: 'Partial' });
    await tick();
    controller.edit('Newer draft');
    controller.stopResponse();
    await sending;
    expect(writes()).toHaveLength(1);
    expect(controller.getSnapshot().generation).toBeNull();
    expect(controller.getSnapshot().draft).toBe('Newer draft');
    expect(controller.getSnapshot().chats[0].messages).toEqual([]);
  });
  test('rapid Send/Stop does not post another message', async () => {
    const { controller, writes } = await setup({
      initial: [chat('a')],
      stream: (_id, _text, init) => controlledStream(init.signal as AbortSignal).response,
    });
    await controller.select('a');
    controller.edit('Hello');
    const one = controller.send();
    await tick();
    await controller.send();
    await one;
    expect(writes()).toHaveLength(1);
    expect(controller.getSnapshot().draft).toBe('Hello');
  });
  test('generation failure after partial output restores draft, not a fake persisted assistant', async () => {
    const { controller } = await setup({
      initial: [chat('a')],
      stream: () =>
        streamResponse([
          { type: 'text_delta', text: 'Partial' },
          { type: 'error', status: 503, message: 'Model unavailable' },
        ]),
    });
    await controller.select('a');
    controller.edit('Hello');
    expect(await controller.send()).toBe(false);
    expect(controller.getSnapshot().error).toBe('Model unavailable');
    expect(controller.getSnapshot().draft).toBe('Hello');
    expect(controller.getSnapshot().chats[0].messages).toEqual([]);
  });
  test('explicit resend checks persisted history and cannot duplicate an already committed exchange', async () => {
    let failed = true;
    const saved = generation(chat('a'));
    const { controller, setRecords, writes } = await setup({
      initial: [chat('a')],
      stream: () => {
        if (failed) return streamResponse([{ type: 'text_delta', text: 'Incomplete' }]);
        return streamResponse([{ type: 'result', data: saved }]);
      },
    });
    await controller.select('a');
    controller.edit('Hello');
    expect(await controller.send()).toBe(false);
    setRecords([{ ...saved.chat_info, chat_id: 'a' } as unknown as ReturnType<typeof chat>]);
    failed = false;
    expect(await controller.send()).toBe(true);
    expect(writes()).toHaveLength(1);
    expect(controller.getSnapshot().chats[0].messages).toHaveLength(2);
  });
  test('resend of uncommitted attempt posts only stream again, never another user/conversation create', async () => {
    let failed = true;
    const { controller, writes } = await setup({
      initial: [chat('a')],
      stream: () =>
        failed
          ? streamResponse([{ type: 'error', message: 'Failed' }])
          : streamResponse([{ type: 'result', data: generation(chat('a')) }]),
    });
    await controller.select('a');
    controller.edit('Hello');
    await controller.send();
    failed = false;
    expect(await controller.send()).toBe(true);
    expect(writes()).toHaveLength(2);
    expect(writes().every((call) => String(call[0]).endsWith('/message/stream'))).toBe(true);
  });
  test('deleted active conversation selects first remaining and stale list cannot resurrect it', async () => {
    const pending = deferred<Response>();
    let held = false;
    const { controller } = await setup({
      initial: [chat('a'), chat('b')],
      list: () => (held ? pending.promise : json([chat('a'), chat('b')])),
    });
    await controller.select('a');
    held = true;
    const listing = controller.loadList();
    await tick();
    await controller.remove('a');
    pending.resolve(json([chat('a'), chat('b')]));
    await listing;
    expect(controller.getSnapshot().active).toBe('b');
    expect(controller.getSnapshot().chats.map((value) => value.chat_id)).toEqual(['b']);
  });
  test('deletion during generation aborts and late result cannot resurrect deleted cache', async () => {
    const { controller } = await setup({
      initial: [chat('a')],
      stream: (_id, _text, init) => controlledStream(init.signal as AbortSignal).response,
    });
    await controller.select('a');
    controller.edit('Hello');
    const sending = controller.send();
    await tick();
    await controller.remove('a');
    await sending;
    expect(controller.getSnapshot().chats).toEqual([]);
    expect(controller.getSnapshot().active).toBeNull();
  });
  test('old list finishing after successful stream cannot roll back title/messages/order', async () => {
    const pending = deferred<Response>();
    let hold = false;
    const { controller } = await setup({
      initial: [chat('a')],
      list: () => (hold ? pending.promise : json([chat('a')])),
    });
    await controller.select('a');
    hold = true;
    const listing = controller.loadList();
    controller.edit('Hello');
    await controller.send();
    pending.resolve(json([chat('a', 'Old')]));
    await listing;
    expect(controller.getSnapshot().chats[0].messages).toHaveLength(2);
    expect(controller.getSnapshot().chats[0].title).not.toBe('Old');
  });
  test('reaction uses backend timestamp and returned toggle, not an invented message ID', async () => {
    const { controller, writes } = await setup({ initial: [chat('a', 'A', 'Hello')] });
    await controller.select('a');
    await controller.react('2026-10-12T12:00:00Z', 'like');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      created_at: '2026-10-12T12:00:00Z',
      reaction: 'like',
    });
    expect(controller.getSnapshot().chats[0].messages[1].reaction).toBe('like');
  });
  test('analysis changes authoritative title without replacing unchanged review fields', async () => {
    const topic = detectedTopic('a');
    const { controller } = await setup({
      initial: [{ ...chat('a'), pending_topic: topic }],
      analysis: () =>
        json({
          suggestion: topic,
          suggestions: [topic],
          chat_title: 'Server topic title',
          analysis_status: 'idle',
        }),
    });
    await controller.select('a');
    await tick();
    controller.openReview('topic');
    await controller.poll();
    expect(controller.getSnapshot().review).toBe('topic');
    expect(controller.getSnapshot().chats[0].title).toBe('Server topic title');
  });
  test('poll delays continue at 8000 after four attempts until completed analysis', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const { controller } = await setup({
      initial: [chat('a')],
      analysis: () =>
        json({
          analysis_status: ++calls > 6 ? 'idle' : 'analysing',
          chat_title: 'A',
          suggestions: [],
        }),
    });
    await controller.select('a');
    await tick();
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(699);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toBe(2);
    for (const delay of [1800, 4000, 8000, 8000, 8000]) await vi.advanceTimersByTimeAsync(delay);
    expect(calls).toBeGreaterThan(6);
    const last = calls;
    await vi.advanceTimersByTimeAsync(16000);
    expect(calls).toBe(last);
  });
  test('analysis retry is only no-body POST and never resends generation', async () => {
    const { controller, writes } = await setup({
      initial: [chat('a')],
      analysis: () => json({ analysis_status: 'error', suggestions: [] }),
    });
    await controller.select('a');
    await controller.retryAnalysis();
    expect(writes()).toHaveLength(1);
    expect(String(writes()[0][0])).toContain('/topic-suggestion/retry');
    expect(writes()[0][1]?.body).toBeUndefined();
  });
  test('malformed nested suggestion cannot route another chat source', async () => {
    const { session } = await setup();
    await expect(api.loadAnalysis(session.api, 'a')).resolves.toBeDefined();
    const backend = chatBackend({ initial: [{ ...chat('a'), pending_topic: detectedTopic('b') }] });
    await expect(api.loadConversation(session.api, 'a')).rejects.toMatchObject({ status: 502 });
    expect(backend.writes()).toHaveLength(0);
  });
  test('logout during stream clears private cache and aborts current owner', async () => {
    const { controller, session } = await setup({
      initial: [chat('a')],
      stream: (_id, _text, init) => controlledStream(init.signal as AbortSignal).response,
    });
    await controller.select('a');
    controller.edit('Private');
    const sending = controller.send();
    await tick();
    session.signOut();
    controller.configure(null, false, false);
    await sending;
    expect(controller.getSnapshot().chats).toEqual([]);
    expect(controller.getSnapshot().draft).toBe('');
    expect(controller.getSnapshot().generation).toBeNull();
  });
  test('HTTP/in-band Terms and quotas preserve draft and distinguish shared gate/error semantics', async () => {
    const { controller, session } = await setup({
      initial: [chat('a')],
      stream: () =>
        streamResponse([{ type: 'error', message: 'Please accept current terms', status: 423 }]),
    });
    await controller.select('a');
    controller.edit('Retained');
    await controller.send();
    const state = session.getSnapshot().session;
    expect(controller.getSnapshot().draft).toBe('Retained');
    expect(state.status).toBe('authenticated');
    if (state.status === 'authenticated') expect(state.termsRequired).toBe(true);
  });
  test('stop/restart lifecycle does not strand preloaded session list loading', async () => {
    const { controller, session } = await setup({ initial: [chat('a')] });
    controller.stop();
    controller.configure(session.getToken(), true, true);
    await tick();
    expect(controller.getSnapshot().chats).toHaveLength(1);
    expect(controller.getSnapshot().listLoading).toBe(false);
  });
  test('topic and map-note review send unchanged accept/dismiss DTOs with source identifiers', async () => {
    const { controller, writes } = await setup({
      initial: [
        {
          ...chat('a'),
          pending_topic: detectedTopic('a'),
          pending_map_suggestion: detectedNote('a'),
        },
      ],
    });
    await controller.select('a');
    const payload = {
      chat_id: 'a',
      require_map_access: true as const,
      suggestion_id: 'suggestion-a',
      entry_category: 'own_perception' as const,
      topic: 'Family',
      description: 'A possible thread',
      category: 'person' as const,
      related_topic_ids: [],
      accepted: false,
      existing_topic_space_id: null,
      parent_topic_space_id: null,
    };
    await controller.decideTopic(payload);
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual(payload);
    await controller.decideNote({
      chat_id: 'a',
      accepted: false,
      category: 'value',
      text: 'Honesty matters',
      reason: 'A recurring value',
      topic_space_id: null,
    });
    expect(JSON.parse(String(writes()[1][1]?.body))).toMatchObject({
      chat_id: 'a',
      accepted: false,
      topic_space_id: null,
    });
  });
});
