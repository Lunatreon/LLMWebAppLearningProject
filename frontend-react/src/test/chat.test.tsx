import { renderApp } from './renderApp';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { SessionController } from '../services/sessionController';
import {
  chat,
  chatBackend,
  controlledStream,
  detectedTopic,
  detectedNote,
  generation,
  streamResponse,
} from './chatBackend';
import { account, deferred, json, jwt, subscription, terms } from './backend';
import { mapData, topic } from './mapBackend';
import { setMobileViewport } from './setup';
function mount(
  options: Parameters<typeof chatBackend>[0] & {
    path?: string;
    state?: object;
    signedIn?: boolean;
    premium?: boolean;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const backend = chatBackend({
    ...options,
    overrides: {
      '/billing/subscription': () =>
        json({
          ...subscription,
          my_map_access: options.premium !== false,
          premium: options.premium !== false,
          chat_daily_limit: options.premium === false ? 10 : 400,
        }),
      ...options.overrides,
    },
  });
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  const view = renderApp({ session, path: options.path || '/chat', state: options.state });
  return { ...backend, ...view, session };
}
async function composer() {
  const input = (await screen.findByLabelText('Message FeelY')) as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}
async function select(id = 'a', title = `Conversation ${id}`, count = 0) {
  fireEvent.click(
    await screen.findByRole('button', {
      name: `${title} ${count} ${count === 1 ? 'message' : 'messages'}`,
    }),
  );
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
describe('real Chat shell/composer/history/stream', () => {
  test('empty Chat preserves original copy/classes/controls/plan and no blank conversation POST', async () => {
    const { writes } = mount();
    const input = await composer();
    expect(input.rows).toBe(1);
    expect(input.placeholder).toBe('Write what is on your mind...');
    expect(input.hasAttribute('maxlength')).toBe(false);
    expect(input.title).toContain('Ctrl+Enter');
    await screen.findByText('Your conversations will appear here.');
    expect(screen.getByText('What would you like to understand?')).toBeDefined();
    expect(screen.getByText('Premium - up to 400 messages per day.')).toBeDefined();
    expect(screen.queryByText('Shared shell active')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  test('list loading/error/retry stays explicit independently of composer', async () => {
    let failing = true;
    mount({
      list: () => (failing ? json({ detail: 'History unavailable' }, 503) : json([chat('a')])),
    });
    await composer();
    await screen.findByText('History unavailable');
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry conversations' }));
    await screen.findByRole('button', { name: 'Conversation a 0 messages' });
  });
  test('history selection renders exact order/plain text/line breaks without Markdown or HTML execution', async () => {
    const value = chat('a', 'Server title', '<script>private</script>\n**literal**');
    const { container } = mount({ initial: [value] });
    await composer();
    await select('a', 'Server title', 1);
    expect(screen.getByText('<script>private</script> **literal**')).toBeDefined();
    expect(container.getElementsByTagName('script')).toHaveLength(0);
    expect(document.title).toBe('Server title | FeelY');
    expect(screen.getByRole('button', { name: 'Helpful reply' })).toBeDefined();
  });
  test('prompt suggestions and lenses populate text/focus only, never send', async () => {
    const { writes } = mount();
    const input = await composer();
    fireEvent.click(screen.getByRole('button', { name: 'A feeling I cannot place' }));
    expect(input.value).toBe('A feeling I cannot place');
    expect(document.activeElement).toBe(input);
    fireEvent.click(screen.getByRole('button', { name: 'Three lenses' }));
    fireEvent.click(screen.getByRole('button', { name: 'Body What do I sense?' }));
    expect(input.value).toBe(
      'A feeling I cannot place\n\nWhat do I notice in my body as I think about this?',
    );
    expect(screen.queryByRole('region', { name: 'Reflection lenses' })).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  test('whitespace/Enter/Shift+Enter/IME do not send; Ctrl+Enter sends exact trimmed context', async () => {
    const { writes } = mount();
    const input = await composer();
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    expect(writes()).toHaveLength(0);
    fireEvent.change(input, { target: { value: ' Hello\nworld ' } });
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })).toBe(true);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(writes()).toHaveLength(0);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await screen.findByText('A complete reply');
    expect(JSON.parse(String(writes()[1][1]?.body))).toEqual({
      chat_id: 'created-1',
      context: 'Hello\nworld',
    });
  });
  test('Command+Enter sends and resulting user/assistant pair appears exactly once', async () => {
    const { container, writes } = mount();
    fireEvent.change(await composer(), { target: { value: 'Hello' } });
    fireEvent.keyDown(screen.getByLabelText('Message FeelY'), { key: 'Enter', metaKey: true });
    await screen.findByText('A complete reply');
    expect(container.getElementsByClassName('message user')).toHaveLength(1);
    expect(writes()).toHaveLength(2);
  });
  test('waiting/delta/Stop preserve exact original controls and no optimistic history persistence', async () => {
    let pieces!: ReturnType<typeof controlledStream>;
    const { writes } = mount({
      initial: [chat('a')],
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('status', { name: 'FeelY - Weaving a reply' });
    await act(async () => {
      pieces.event({ type: 'text_delta', text: 'Partial words ' });
    });
    await screen.findByText('Partial words');
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Next draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
    await screen.findByRole('button', { name: 'Send message' });
    expect((screen.getByLabelText('Message FeelY') as HTMLTextAreaElement).value).toBe(
      'Next draft',
    );
    expect(screen.queryByText('Partial words')).toBeNull();
    expect(writes()).toHaveLength(1);
  });
  test('stream continues across A -> B selection and return restores A partial with stop control', async () => {
    let pieces!: ReturnType<typeof controlledStream>;
    mount({
      initial: [chat('a'), chat('b')],
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('button', { name: 'Stop response' });
    fireEvent.click(screen.getByRole('button', { name: 'Conversation b 0 messages' }));
    await screen.findByRole('heading', { name: 'Conversation b' });
    expect(
      (screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => pieces.event({ type: 'text_delta', text: 'A partial reply' }));
    expect(screen.queryByText('A partial reply')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Conversation a 0 messages' }));
    await screen.findByText('A partial reply');
    await screen.findByRole('button', { name: 'Stop response' });
    await act(async () => {
      pieces.event({ type: 'result', data: generation(chat('a'), 'Hello', 'A final reply') });
      pieces.close();
    });
    await screen.findByText('A final reply');
  });
  test('network/error partial failure keeps sent text and supports explicit same-chat retry', async () => {
    let fail = true;
    const { writes } = mount({
      initial: [chat('a')],
      stream: (id, text) =>
        fail
          ? streamResponse([
              { type: 'text_delta', text: 'Partial' },
              { type: 'error', status: 503, message: 'Model unavailable' },
            ])
          : streamResponse([{ type: 'result', data: generation(chat(id), text) }]),
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('Model unavailable');
    expect((screen.getByLabelText('Message FeelY') as HTMLTextAreaElement).value).toBe('Hello');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByText('A complete reply');
    expect(writes()).toHaveLength(2);
    expect(screen.queryByText('Model unavailable')).toBeNull();
  });
  test('New conversation is local and preserves existing composer draft', async () => {
    const { writes } = mount({ initial: [chat('a', 'A', 'Earlier')] });
    await composer();
    await select('a', 'A', 1);
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'New conversation' }));
    await screen.findByRole('heading', { name: 'New conversation' });
    expect((screen.getByLabelText('Message FeelY') as HTMLTextAreaElement).value).toBe('Draft');
    expect(writes()).toHaveLength(0);
  });
  test('delete menu/confirmation/cancel and active fallback preserve supported CRUD without rename', async () => {
    const { writes } = mount({ initial: [chat('a'), chat('b')] });
    await composer();
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'More options for Conversation a' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await screen.findByText('Delete "Conversation a"? This cannot be undone.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'More options for Conversation a' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('heading', { name: 'Conversation b' });
    expect(screen.queryByRole('button', { name: 'Conversation a 0 messages' })).toBeNull();
    expect(writes()[0][1]?.method).toBe('DELETE');
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
  });
  test('reactions toggle using created_at and preserve the source conversation', async () => {
    const { writes } = mount({ initial: [chat('a', 'A', 'Hello')] });
    await composer();
    await select('a', 'A', 1);
    fireEvent.click(screen.getByRole('button', { name: 'Helpful reply' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Helpful reply' }).getAttribute('aria-pressed'),
      ).toBe('true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Helpful reply' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(String(writes()[1][1]?.body))).toEqual({
      created_at: '2026-10-12T12:00:00Z',
      reaction: null,
    });
  });
  test('free/test phase copy comes from session and billing remains a real reference action', async () => {
    mount({ premium: false });
    await composer();
    expect(screen.getByText('Free plan - 10 messages per day.')).toBeDefined();
    expect(
      new URL(
        (screen.getByRole('link', { name: 'Want more? Click here.' }) as HTMLAnchorElement).href,
      ).pathname,
    ).toBe('/reference/');
  });
  test('free quota handling retains message and original upgrade text without fake usage permissions', async () => {
    mount({
      premium: false,
      initial: [chat('a')],
      stream: () =>
        streamResponse([
          { type: 'error', status: 429, message: "You have reached today's 10 free messages." },
        ]),
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('link', { name: 'Subscribe with Stripe' });
    expect((screen.getByLabelText('Message FeelY') as HTMLTextAreaElement).value).toBe('Hello');
  });
  test('unauthenticated and Terms gates make no protected Chat list/generation call', async () => {
    const { fetch } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/llm/'))).toBe(false);
  });
  test('Terms gate keeps composer unavailable until actual session requirements are fulfilled', async () => {
    const { fetch } = mount({
      overrides: {
        '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
      },
    });
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByLabelText('Message FeelY')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/llm/'))).toBe(false);
  });
  test('in-band stream 401 uses shared logout and clears private draft/history', async () => {
    const { router } = mount({
      initial: [chat('a')],
      stream: () => streamResponse([{ type: 'error', status: 401, message: 'Revoked' }]),
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Private' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(screen.queryByText('Private')).toBeNull();
  });
  test('403 preserves JWT/draft and existing verification recovery', async () => {
    const { session } = mount({
      initial: [chat('a')],
      stream: () =>
        new Response(JSON.stringify({ detail: 'Please verify your email before logging in.' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }),
      overrides: { '/users/me/account': () => json({ ...account, is_email_verified: false }) },
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Retained' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('link', { name: 'Activate account / enter email PIN' });
    expect(session.getToken()).not.toBeNull();
    expect((screen.getByLabelText('Message FeelY') as HTMLTextAreaElement).value).toBe('Retained');
  });
  test('topic review sends original fields/type/routing and feeds the single Map cache', async () => {
    const value = {
      ...chat('a'),
      pending_topic: detectedTopic('a'),
      pending_topics: [detectedTopic('a')],
    };
    const { writes, router } = mount({ initial: [value] });
    await composer();
    await select();
    fireEvent.click(await screen.findByRole('button', { name: 'Review topic: Family' }));
    const dialog = await screen.findByRole('dialog', { name: 'A possible thread' });
    fireEvent.change(within(dialog).getByLabelText('New topic name'), {
      target: { value: '  Edited family  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: '  Edited description  ' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Experience' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save topic' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      chat_id: 'a',
      require_map_access: true,
      suggestion_id: 'suggestion-a',
      entry_category: 'own_perception',
      topic: 'Edited family',
      description: 'Edited description',
      category: 'experience',
      related_topic_ids: [],
      accepted: true,
      existing_topic_space_id: null,
      parent_topic_space_id: null,
    });
    await act(() => router.navigate('/map'));
    await screen.findByRole('button', { name: 'Open Edited family' });
  });
  test('unchanged polling retains edited review fields and failed acceptance stays retryable', async () => {
    const topic = detectedTopic('a');
    const { session } = mount({
      initial: [{ ...chat('a'), pending_topic: topic, pending_topics: [topic] }],
      action: () => json({ detail: 'Try again' }, 503),
    });
    await composer();
    await select();
    fireEvent.click(await screen.findByRole('button', { name: 'Review topic: Family' }));
    const dialog = await screen.findByRole('dialog', { name: 'A possible thread' });
    const input = within(dialog).getByLabelText('Description') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Keep review edits' } });
    await act(() => session.reload({ force: true }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save topic' }));
    await within(dialog).findByText('Try again');
    expect(input.value).toBe('Keep review edits');
  });
  test('recommended existing topic changes category/note field and preserves exact target payload', async () => {
    const suggestion = { ...detectedTopic('a'), existing_topic_id: 'existing' };
    const { setMap, writes } = mount({
      initial: [{ ...chat('a'), pending_topic: suggestion, pending_topics: [suggestion] }],
      overrides: {
        '/users/me/map': () =>
          json(
            mapData([
              topic('existing', 'Existing', {
                category: 'trait',
                chat_ids: ['older'],
                journal_dates: ['2026-10-12'],
              }),
            ]),
          ),
      },
    });
    setMap(mapData([topic('existing', 'Existing', { category: 'trait' })]));
    await composer();
    await select();
    fireEvent.click(await screen.findByRole('button', { name: 'Review topic: Family' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Recommended match');
    expect((within(dialog).getByRole('radio', { name: 'Trait' }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.change(within(dialog).getByLabelText('Note category for existing topic'), {
      target: { value: 'evidence' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to topic' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
      existing_topic_space_id: 'existing',
      parent_topic_space_id: null,
      category: 'trait',
      entry_category: 'evidence',
    });
  });
  test('map-note review edits category/text and saves correct conversation source', async () => {
    const { writes } = mount({
      initial: [{ ...chat('a'), pending_map_suggestion: detectedNote('a') }],
    });
    await composer();
    await select();
    fireEvent.click(await screen.findByRole('button', { name: 'Review map note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Keep this in your map?' });
    fireEvent.change(within(dialog).getByLabelText('Edit map suggestion'), {
      target: { value: '  Edited note  ' },
    });
    fireEvent.change(within(dialog).getByLabelText('Note category'), {
      target: { value: 'practice' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save to map' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      chat_id: 'a',
      accepted: true,
      category: 'practice',
      text: 'Edited note',
      reason: 'A recurring value',
      topic_space_id: null,
    });
  });
  test('analysis retry never resends the conversation', async () => {
    const { writes } = mount({
      initial: [chat('a')],
      analysis: () => json({ analysis_status: 'error', suggestion: null, suggestions: [] }),
    });
    await composer();
    await select();
    fireEvent.click(await screen.findByRole('button', { name: 'Map suggestions failed. Retry' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(String(writes()[0][0])).toContain('/topic-suggestion/retry');
    expect(writes()[0][1]?.body).toBeUndefined();
  });
  test('Map source label resolves server conversation title and opens its real ordered history', async () => {
    const { router, setMap } = mount({
      path: '/map',
      initial: [chat('a', 'A title', 'Original history')],
    });
    setMap(mapData([topic('t', 'Topic', { chat_ids: ['a'] })]));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Topic' }));
    fireEvent.click(await screen.findByRole('link', { name: 'A title' }));
    await screen.findByText('Original history');
    expect(router.state.location.pathname).toBe('/chat');
    expect(router.state.location.state.chatId).toBe('a');
    expect(screen.getByRole('heading', { name: 'A title' })).toBeDefined();
  });
  test('mobile selecting conversation closes original drawer and retains selected active state', async () => {
    setMobileViewport(true);
    mount({ initial: [chat('a')] });
    await composer();
    fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Conversation a 0 messages' }));
    await screen.findByRole('heading', { name: 'Conversation a' });
    expect(
      screen.getByRole('button', { name: 'Open conversations' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
  test('manual upward scroll prevents partial stream auto-scroll', async () => {
    const scrolling = vi.spyOn(HTMLElement.prototype, 'scrollTo');
    let pieces!: ReturnType<typeof controlledStream>;
    mount({
      initial: [chat('a')],
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    await composer();
    await select();
    fireEvent.change(screen.getByLabelText('Message FeelY'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('button', { name: 'Stop response' });
    const messages = document.getElementById('messages')!;
    Object.defineProperties(messages, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 100 },
    });
    fireEvent.scroll(messages);
    const before = scrolling.mock.calls.length;
    await act(async () => pieces.event({ type: 'text_delta', text: 'Some streamed text ' }));
    await waitFor(() =>
      expect(messages.querySelector('.streaming-content')?.textContent?.trim()).toBe(
        'Some streamed text',
      ),
    );
    expect(scrolling.mock.calls.length).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: 'Stop response' }));
  });
  test('session refresh retains composer draft and no private answer enters browser storage', async () => {
    const { session } = mount();
    const input = await composer();
    fireEvent.change(input, { target: { value: 'Private composer' } });
    await act(() => session.reload({ force: true }));
    expect((await composer()).value).toBe('Private composer');
    expect(Object.values(localStorage)).not.toContain('Private composer');
  });
  test('Map link to a deleted source retains the source ID and shows its error instead of another chat', async () => {
    const { setMap, router, writes } = mount({
      path: '/map',
      initial: [chat('a', 'Current', 'Current history')],
    });
    setMap(mapData([topic('topic-a', 'Family', { chat_ids: ['deleted-source'] })]));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Family' }));
    const link = await screen.findByRole('link', { name: 'Conversation' });
    fireEvent.click(link);
    await screen.findByRole('alert');
    expect(router.state.location.pathname).toBe('/chat');
    expect(router.state.location.state.chatId).toBe('deleted-source');
    expect(screen.getByRole('alert').textContent).toContain('Chat not found');
    expect(screen.queryByText('Current history')).toBeNull();
    expect(writes()).toHaveLength(0);
  });
  test('returning to an active generation keeps Stop available while history loads', async () => {
    const pending = deferred<Response>();
    let hold = false;
    let pieces!: ReturnType<typeof controlledStream>;
    mount({
      initial: [chat('a'), chat('b')],
      read: (id) => (hold && id === 'a' ? pending.promise : json(chat(id))),
      stream: (_id, _text, init) => {
        pieces = controlledStream(init.signal as AbortSignal);
        return pieces.response;
      },
    });
    const input = await composer();
    await select('a');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('button', { name: 'Stop response' });
    fireEvent.click(screen.getByRole('button', { name: 'Conversation b 0 messages' }));
    await waitFor(() => expect(screen.queryByText('Loading conversation...')).toBeNull());
    hold = true;
    fireEvent.click(screen.getByRole('button', { name: 'Conversation a 0 messages' }));
    const stop = await screen.findByRole('button', { name: 'Stop response' });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stop);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop response' })).toBeNull());
    await act(async () => pending.resolve(json(chat('a'))));
    expect(pieces).toBeDefined();
  });
});
