import { describe, expect, test, vi } from 'vitest';
import { chat, controlledStream, streamResponse, generation, detectedNote } from './chatBackend';
import { deferred, json } from './backend';
import { mapData } from './mapBackend';
import { setup, tick } from './chatControllerHarness';

describe('Chat retry/mutation/playback ownership', () => {
  test('late A analysis-retry failure cannot change the selected B retry notice', async () => {
    const pending = deferred<Response>();
    const { controller } = await setup({
      initial: [chat('a'), chat('b')],
      action: () => pending.promise,
    });
    await controller.select('a');
    const retry = controller.retryAnalysis();
    await tick();
    await controller.select('b');
    pending.resolve(json({ detail: 'A analysis retry failed' }, 503));
    await retry;
    expect(controller.getSnapshot().active).toBe('b');
    expect(controller.getSnapshot().retryError).toBe(false);
  });
  const notePayload = {
    chat_id: 'a',
    accepted: false,
    category: 'value' as const,
    text: 'Honesty matters',
    reason: 'A recurring value',
    topic_space_id: null,
  };
  test('a genuinely different message bypasses identical retry reconciliation and sends once', async () => {
    let fail = true;
    let reads = 0;
    const { controller, writes } = await setup({
      initial: [chat('a')],
      read: () => {
        reads++;
        return json(chat('a'));
      },
      stream: (_id, text) =>
        fail
          ? streamResponse([])
          : streamResponse([{ type: 'result', data: generation(chat('a'), text) }]),
    });
    await controller.select('a');
    controller.edit('Hello');
    await controller.send();
    fail = false;
    const before = reads;
    controller.edit('A different new message');
    expect(await controller.send()).toBe(true);
    expect(reads).toBe(before);
    expect(writes()).toHaveLength(2);
    expect(JSON.parse(String(writes()[1][1]?.body)).context).toBe('A different new message');
  });
  test('two identical retries during history preflight reconcile once without duplicate generation', async () => {
    const pending = deferred<Response>();
    let hold = false;
    const { controller, writes } = await setup({
      initial: [chat('a')],
      read: () => (hold ? pending.promise : json(chat('a'))),
      stream: () => streamResponse([]),
    });
    await controller.select('a');
    controller.edit('Hello');
    await controller.send();
    hold = true;
    const retry = controller.send();
    await tick();
    expect(controller.getSnapshot().preflight).toBe(true);
    expect(await controller.send()).toBe(false);
    pending.resolve(json({ ...generation(chat('a')).chat_info, chat_id: 'a' }));
    expect(await retry).toBe(true);
    expect(writes()).toHaveLength(1);
  });
  test('new typing during successful retry reconciliation is retained without posting it', async () => {
    const pending = deferred<Response>();
    let hold = false;
    const { controller, writes } = await setup({
      initial: [chat('a')],
      read: () => (hold ? pending.promise : json(chat('a'))),
      stream: () => streamResponse([]),
    });
    await controller.select('a');
    controller.edit('Hello');
    await controller.send();
    hold = true;
    const retry = controller.send();
    await tick();
    controller.edit('Newer thought');
    pending.resolve(json({ ...generation(chat('a')).chat_info, chat_id: 'a' }));
    await retry;
    expect(controller.getSnapshot().draft).toBe('Newer thought');
    expect(writes()).toHaveLength(1);
  });
  test('failed A retry preflight cannot place its error in subsequently selected B', async () => {
    const pending = deferred<Response>();
    let hold = false;
    const { controller } = await setup({
      initial: [chat('a'), chat('b')],
      read: (id) => (hold && id === 'a' ? pending.promise : json(chat(id))),
      stream: () => streamResponse([]),
    });
    await controller.select('a');
    controller.edit('Hello');
    await controller.send();
    hold = true;
    const retry = controller.send();
    await tick();
    await controller.select('b');
    pending.resolve(json({ detail: 'A is unavailable' }, 503));
    await retry;
    expect(controller.getSnapshot().active).toBe('b');
    expect(controller.getSnapshot().error).toBe('');
  });
  test('late reaction affects its originating conversation only and duplicate pending clicks are ignored', async () => {
    const pending = deferred<Response>();
    const { controller, writes } = await setup({
      initial: [chat('a', 'A', 'Hello'), chat('b', 'B', 'Other')],
      action: () => pending.promise,
    });
    await controller.select('a');
    const reacting = controller.react('2026-10-12T12:00:00Z', 'like');
    await tick();
    await controller.react('2026-10-12T12:00:00Z', 'dislike');
    await controller.select('b');
    pending.resolve(json({ reaction: 'like' }));
    await reacting;
    expect(writes()).toHaveLength(1);
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'a')?.messages[1].reaction,
    ).toBe('like');
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'b')?.messages[1].reaction,
    ).toBeUndefined();
    expect(controller.getSnapshot().active).toBe('b');
  });
  test('failed reaction leaves authoritative old value and supports explicit retry', async () => {
    let fail = true;
    const original = chat('a', 'A', 'Hello');
    original.messages[1].reaction = 'like';
    const { controller, writes } = await setup({
      initial: [original],
      action: () => (fail ? json({ detail: 'Reaction failed' }, 503) : json({ reaction: null })),
    });
    await controller.select('a');
    await controller.react('2026-10-12T12:00:00Z', null);
    expect(controller.getSnapshot().chats[0].messages[1].reaction).toBe('like');
    expect(controller.getSnapshot().error).toBe('Reaction failed');
    fail = false;
    await controller.react('2026-10-12T12:00:00Z', null);
    expect(controller.getSnapshot().chats[0].messages[1].reaction).toBeNull();
    expect(writes()).toHaveLength(2);
  });
  test('pending review completion consumes A only and leaves the selected B review intact', async () => {
    const pending = deferred<Response>();
    const { controller, writes } = await setup({
      initial: ['a', 'b'].map((id) => ({ ...chat(id), pending_map_suggestion: detectedNote(id) })),
      action: () => pending.promise,
    });
    await controller.select('a');
    await controller.openReview('note');
    const saving = controller.decideNote(notePayload);
    await tick();
    expect(await controller.decideNote(notePayload)).toBe(false);
    await controller.select('b');
    await controller.openReview('note');
    pending.resolve(json({ accepted: false, entry: null, map: mapData() }));
    await saving;
    expect(writes()).toHaveLength(1);
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'a')?.pending_map_suggestion,
    ).toBeNull();
    expect(
      controller.getSnapshot().chats.find((value) => value.chat_id === 'b')?.pending_map_suggestion,
    ).toBeDefined();
    expect(controller.getSnapshot().review).toBe('note');
  });
  test('late failed review and reaction do not leak A errors into B', async () => {
    const pending = deferred<Response>();
    const { controller } = await setup({
      initial: [
        { ...chat('a', 'A', 'Hello'), pending_map_suggestion: detectedNote('a') },
        chat('b'),
      ],
      action: () => pending.promise,
    });
    await controller.select('a');
    const saving = controller.decideNote(notePayload),
      reacting = controller.react('2026-10-12T12:00:00Z', 'like');
    await tick();
    await controller.select('b');
    pending.resolve(json({ detail: 'A mutation failed' }, 503));
    await Promise.all([saving, reacting]);
    expect(controller.getSnapshot().error).toBe('');
  });
  test('revoking Map capability closes a note review so no invisible modal leaves the shell inert', async () => {
    const { controller, session } = await setup({
      initial: [{ ...chat('a'), pending_map_suggestion: detectedNote('a') }],
    });
    await controller.select('a');
    await controller.openReview('note');
    expect(controller.getSnapshot().review).toBe('note');
    controller.configure(session.getToken(), true, false);
    expect(controller.getSnapshot().enabled).toBe(true);
    expect(controller.getSnapshot().review).toBeNull();
  });
  test('unmount while reaction/review are pending suppresses notifications and external Map updates', async () => {
    const pending = deferred<Response>();
    const { controller } = await setup({
      initial: [chat('a', 'A', 'Hello')],
      action: () => pending.promise,
    });
    await controller.select('a');
    const reacting = controller.react('2026-10-12T12:00:00Z', 'like'),
      saving = controller.decideNote(notePayload);
    await tick();
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.stop();
    pending.resolve(json({ reaction: 'like', accepted: false, entry: null, map: mapData() }));
    await Promise.all([reacting, saving]);
    expect(notify).not.toHaveBeenCalled();
    expect(controller.getSnapshot().chats[0].messages[1].reaction).toBeUndefined();
  });
  test('deleted conversation ignores its late detail and uncooperative late stream results', async () => {
    let pieces!: ReturnType<typeof controlledStream>;
    const pending = deferred<Response>();
    let hold = false;
    const { controller } = await setup({
      initial: [chat('a'), chat('b')],
      read: (id) => (hold && id === 'a' ? pending.promise : json(chat(id))),
      stream: () => {
        pieces = controlledStream();
        return pieces.response;
      },
    });
    await controller.select('a');
    controller.edit('Hello');
    const sending = controller.send();
    await tick();
    hold = true;
    const loading = controller.select('a');
    await tick();
    await controller.remove('a');
    pending.resolve(json(chat('a', 'Late A')));
    pieces.event({ type: 'text_delta', text: 'Late chunk' });
    pieces.event({ type: 'result', data: generation(chat('a')) });
    pieces.close();
    await Promise.all([loading, sending]);
    expect(controller.getSnapshot().active).toBe('b');
    expect(controller.getSnapshot().chats.map((value) => value.chat_id)).toEqual(['b']);
    expect(controller.getSnapshot().generation).toBeNull();
  });
  test('Stop while B is selected cannot abort A; returning to A resumes owned playback only', async () => {
    vi.useFakeTimers();
    let pieces!: ReturnType<typeof controlledStream>;
    let signal!: AbortSignal;
    const { controller } = await setup({
      initial: [chat('a'), chat('b')],
      stream: (_id, _text, init) => {
        signal = init.signal as AbortSignal;
        pieces = controlledStream(signal);
        return pieces.response;
      },
    });
    controller.setVisible(true, false);
    await controller.select('a');
    controller.edit('Hello');
    const sending = controller.send();
    await tick();
    pieces.event({ type: 'text_delta', text: 'First phrase continuing ' });
    await tick();
    await controller.select('b');
    controller.stopResponse();
    await vi.advanceTimersByTimeAsync(1000);
    expect(signal.aborted).toBe(false);
    expect(controller.getSnapshot().generation?.shown).toBe('');
    await controller.select('a');
    expect(controller.getSnapshot().generation?.shown).toBe('First phrase continuing ');
    pieces.event({ type: 'text_delta', text: 'New phrase ' });
    await vi.advanceTimersByTimeAsync(500);
    expect(controller.getSnapshot().generation?.shown).toContain('New phrase');
    controller.stopResponse();
    await sending;
  });
  test.each([402, 429])(
    'in-band %s remains a canonical error with preserved draft and no replay',
    async (status) => {
      const { controller, session, writes } = await setup({
        initial: [chat('a')],
        stream: () =>
          streamResponse([
            {
              type: 'error',
              message: status === 402 ? 'Premium required' : 'Daily limit reached',
              status,
            },
          ]),
      });
      await controller.select('a');
      controller.edit('Hello');
      await controller.send();
      expect(controller.getSnapshot().errorStatus).toBe(status);
      expect(controller.getSnapshot().draft).toBe('Hello');
      expect(session.getToken()).toBeTruthy();
      expect(writes()).toHaveLength(1);
    },
  );
});
