import { describe, expect, test, vi } from 'vitest';
import { ApiClient } from '../services/apiClient';
import { createTextPlayer } from '../features/chat/textPlayer';
import { chat, controlledStream, streamResponse, generation } from './chatBackend';
import { setup, tick } from './chatControllerHarness';
import * as api from '../features/chat/chatApi';

describe('Chat parser/cadence contracts', () => {
  test('aborting inside an event suppresses subsequent records from the same network packet', async () => {
    const abort = new AbortController();
    const seen: unknown[] = [];
    const response = streamResponse([
      { type: 'status' },
      { type: 'text_delta', text: 'Must not be delivered' },
    ]);
    vi.stubGlobal('fetch', async () => response);
    const client = new ApiClient({ baseUrl: 'http://api.test', getToken: () => 'owner' });
    await expect(
      client.stream(
        '/stream',
        { authenticated: true, method: 'POST', signal: abort.signal },
        (event) => {
          seen.push(event);
          abort.abort();
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toEqual([{ type: 'status' }]);
    expect(response.body?.locked).toBe(false);
  });
  test('malformed stream cleanup cancels its reader and releases the stream lock', async () => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{bad}\n'));
        },
        cancel,
      }),
    );
    vi.stubGlobal('fetch', async () => response);
    const client = new ApiClient({ baseUrl: 'http://api.test', getToken: () => 'owner' });
    await expect(
      client.stream('/stream', { authenticated: true, method: 'POST' }, () => {}),
    ).rejects.toMatchObject({ status: 502 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
  test('NDJSON UTF8 splits/newlines/unterminated final record preserve ordered deltas and exact payload', async () => {
    const pieces = controlledStream();
    const { session, writes } = await setup({ stream: () => pieces.response });
    const deltas: string[] = [];
    const sending = api.generate(session.api, 'a', 'Hello', new AbortController().signal, (text) =>
      deltas.push(text),
    );
    await tick();
    const bytes = new TextEncoder().encode(
      '\n' +
        JSON.stringify({ type: 'text_delta', text: 'Héllo 🌍' }) +
        '\n' +
        JSON.stringify({ type: 'text_delta', text: ' next' }) +
        '\n' +
        JSON.stringify({ type: 'result', data: generation(chat('a')) }),
    );
    for (let i = 0; i < bytes.length; i += 3) pieces.bytes(bytes.slice(i, i + 3));
    pieces.close();
    expect((await sending).chat_id).toBe('a');
    expect(deltas).toEqual(['Héllo 🌍', ' next']);
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ chat_id: 'a', context: 'Hello' });
    expect(writes()[0][1]?.credentials).toBeUndefined();
    expect(new Headers(writes()[0][1]?.headers).get('Authorization')).toBe(
      `Bearer ${session.getToken()}`,
    );
  });
  test.each(['bad-json', 'no-result', 'wrong-id', 'unknown-event'])(
    '%s cannot claim a persisted exchange',
    async (kind) => {
      const { session } = await setup({
        stream: () =>
          kind === 'bad-json'
            ? new Response('{bad}\n')
            : streamResponse(
                kind === 'no-result'
                  ? [{ type: 'text_delta', text: 'Partial' }]
                  : kind === 'wrong-id'
                    ? [{ type: 'result', data: generation(chat('wrong')) }]
                    : [{ type: 'mystery' }],
              ),
      });
      await expect(
        api.generate(session.api, 'a', 'Hello', new AbortController().signal, () => {}),
      ).rejects.toMatchObject({ status: 502 });
    },
  );
  test('in-band 401 expires through shared client; late old-token stream cannot log out another user', async () => {
    let token: string | null = 'old';
    let expired = 0;
    const pieces = controlledStream();
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      getToken: () => token,
      onSessionExpired: () => {
        expired++;
        token = null;
      },
    });
    vi.stubGlobal('fetch', async () => pieces.response);
    const sending = client.stream('/stream', { method: 'POST', authenticated: true }, () => {});
    const rejection = expect(sending).rejects.toMatchObject({ status: 401 });
    await tick();
    token = 'new';
    pieces.event({ type: 'error', status: 401 });
    pieces.close();
    await rejection;
    expect(expired).toBe(0);
    expect(token).toBe('new');
  });
  test('cadence preserves punctuation pauses and flushes unfinished final word', async () => {
    vi.useFakeTimers();
    const words: string[] = [];
    const player = createTextPlayer(
      (text) => words.push(text),
      () => false,
    );
    player.push('Hello, world. Ending');
    await vi.advanceTimersByTimeAsync(24);
    expect(words).toEqual(['Hello, ']);
    await vi.advanceTimersByTimeAsync(160);
    expect(words).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(words.join('')).toContain('world.');
    player.finish();
    expect(words.join('')).toBe('Hello, world. Ending');
  });
  test('reduced/hidden instant and cancellation have no lost/late text', async () => {
    vi.useFakeTimers();
    let text = '';
    const player = createTextPlayer(
      (value) => {
        text += value;
      },
      () => true,
    );
    player.push('瞬間 🌍');
    await vi.advanceTimersByTimeAsync(24);
    expect(text).toBe('瞬間 🌍');
    player.push('Late');
    player.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(text).toBe('瞬間 🌍');
  });
});
