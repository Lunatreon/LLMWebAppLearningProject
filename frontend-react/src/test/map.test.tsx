import { renderApp } from './renderApp';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SessionController } from '../services/sessionController';
import { mapBackend, mapData, topic, mapEntry } from './mapBackend';
import { account, deferred, json, jwt, subscription, terms } from './backend';
import { localDateKey, formattedJournalDate } from '../features/journal/dates';
import { entry, topicSuggestion } from './journalBackend';
import { setMobileViewport } from './setup';
const family = () =>
  topic('family', 'Family', {
    category: 'person',
    description: 'A relationship',
    journal_dates: ['2026-10-10'],
    entries: [mapEntry('note', 'I value honesty.', 'value')],
  });
const rest = () => topic('rest', 'Rest', { category: 'experience' });
function mount(
  options: Parameters<typeof mapBackend>[0] & {
    signedIn?: boolean;
    access?: boolean;
    path?: string;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const backend = mapBackend({
    ...options,
    overrides: {
      '/billing/subscription': () =>
        json({ ...subscription, my_map_access: options.access !== false }),
      ...options.overrides,
    },
  });
  const session = new SessionController('http://127.0.0.1:8000/api/v1');
  const view = renderApp({ session, path: options.path || '/map', state: undefined });
  return { ...backend, ...view, session };
}
const loaded = () => screen.findByRole('button', { name: 'Open Overall' });
async function select(name = 'Family') {
  fireEvent.click(await screen.findByRole('button', { name: `Open ${name}` }));
  return screen.findByRole('complementary', { name: `${name} details` });
}
describe('real My Map route/graph/forms', () => {
  test('empty graph includes permanent Overall and original toolbar/header/sidebar/CSS classes', async () => {
    mount();
    const overall = await loaded();
    expect(overall.classList.contains('overall')).toBe(true);
    expect(overall.style.left).toBe('50%');
    expect(overall.style.top).toBe('56%');
    expect(screen.getByRole('group', { name: 'Filter map topics' })).toBeDefined();
    expect(
      screen.getByText('The people, qualities, and experiences that make up your life.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: '+ Add topic' })).toBeDefined();
    expect(screen.queryByText('This map page is not migrated yet.', { exact: false })).toBeNull();
    expect(document.getElementById('map-topic-count')?.textContent).toBe('1');
  });
  test('explicit pending/error/retry never fabricates graph data', async () => {
    const pending = deferred<Response>();
    let read = () => pending.promise;
    mount({ read: () => read() });
    await screen.findByText('Loading My Map...');
    expect(screen.queryByRole('button', { name: 'Open Overall' })).toBeNull();
    await act(() => pending.resolve(json({ detail: 'Map unavailable' }, 503)));
    await screen.findByText('Map unavailable');
    read = () => Promise.resolve(json(mapData()));
    fireEvent.click(screen.getByRole('button', { name: 'Retry map' }));
    await loaded();
    expect(screen.queryByText('Map unavailable')).toBeNull();
  });
  test('nodes, category summary and directed/dashed deduplicated SVG lines use real data', async () => {
    mount({
      initial: mapData([
        topic('parent', 'Parent', { category: 'person', related_topic_ids: ['child'] }),
        topic('child', 'Child', {
          category: 'trait',
          parent_topic_id: 'parent',
          related_topic_ids: ['parent'],
        }),
      ]),
    });
    await loaded();
    expect(screen.getByText('1 person · 1 trait')).toBeDefined();
    const svg = document.getElementsByClassName('map-connection-layer')[0];
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100');
    expect(svg.getElementsByTagName('line')).toHaveLength(2);
    expect(svg.getElementsByClassName('map-topic-link-related')).toHaveLength(1);
    expect(svg.getElementsByClassName('map-topic-link-parent')).toHaveLength(1);
  });
  test('select, close, reopen, filters and empty type preserve selection semantics', async () => {
    mount({ initial: mapData([family(), rest()]) });
    const detail = await select();
    expect(within(detail).getByText('A relationship')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Close thread details' }));
    expect(screen.queryByRole('complementary', { name: 'Family details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open Family' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Traits' }));
    expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull();
    await screen.findByText('No topics of this type yet. You can choose a type in Edit & connect.');
    fireEvent.click(screen.getByRole('button', { name: 'Everything' }));
    expect(screen.getByRole('button', { name: 'Open Family' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });
  test('contextual sidebar uses hierarchy/counts and reveals filtered selected topic', async () => {
    mount({ initial: mapData([topic('child', 'Child', { parent_topic_id: 'family' }), family()]) });
    await loaded();
    const sidebar = screen.getByRole('navigation', { name: 'Map topics' });
    expect(
      within(sidebar)
        .getAllByRole('button')
        .map((button) => button.firstElementChild?.textContent),
    ).toEqual(['Overall', 'Family', 'Child']);
    expect(
      within(sidebar)
        .getByRole('button', { name: 'Child 0 chats · 0 journals · 0 entries' })
        .style.getPropertyValue('--topic-indent'),
    ).toBe('14px');
    fireEvent.click(screen.getByRole('button', { name: 'Traits' }));
    fireEvent.click(
      within(sidebar).getByRole('button', { name: 'Family 0 chats · 1 journal · 1 entry' }),
    );
    await screen.findByRole('complementary', { name: 'Family details' });
    expect(screen.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });
  test('mobile layout uses original growing two-column positions and selection closes drawer', async () => {
    setMobileViewport(true);
    mount({ initial: mapData([family(), rest()]) });
    await loaded();
    const overall = screen.getByRole('button', { name: 'Open Overall' });
    expect(overall.parentElement?.style.height).toBe('430px');
    expect(screen.getByRole('button', { name: 'Open Family' }).style.left).toBe('26%');
    fireEvent.click(screen.getByRole('button', { name: 'Open conversations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Family 0 chats · 1 journal · 1 entry' }));
    await screen.findByRole('complementary', { name: 'Family details' });
    expect(
      screen.getByRole('button', { name: 'Open conversations' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });
  test('node clicks/pointer/wheel do not invent drag/zoom/pan or position writes', async () => {
    const { writes } = mount({ initial: mapData([family()]) });
    const button = await screen.findByRole('button', { name: 'Open Family' });
    const before = button.style.cssText;
    fireEvent.pointerDown(button, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(button, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(button);
    fireEvent.wheel(button, { deltaY: 100 });
    expect(button.style.cssText).toBe(before);
    expect(writes()).toHaveLength(0);
  });
  test('signed-out/Terms/capability gates make no protected Map call', async () => {
    const { fetch } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('Terms gate blocks graph without fake access', async () => {
    const { fetch } = mount({
      overrides: {
        '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
      },
    });
    await screen.findByRole('link', { name: 'Review terms' });
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('locked Map preserves premium copy and delegates actual billing to reference Account', async () => {
    const { fetch } = mount({ access: false });
    await screen.findByText('Turn conversations into your personal map');
    expect(screen.getByText('My Map is a Premium space')).toBeDefined();
    const url = new URL(
      (screen.getByRole('link', { name: 'Unlock My Map' }) as HTMLAnchorElement).href,
    );
    expect(url.pathname).toBe('/reference/');
    expect(url.searchParams.get('view')).toBe('account');
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/map'))).toBe(false);
  });
  test('backend 402 is authoritative and verified refresh restores graph', async () => {
    let denied = true;
    const { session } = mount({
      read: () =>
        denied ? json({ detail: 'Premium is required to access My Map.' }, 402) : json(mapData()),
    });
    await screen.findByRole('button', { name: 'Check access again' });
    denied = false;
    await act(() => session.reload({ force: true }));
    await loaded();
  });
  test('401 clears session/private data and returns to Login', async () => {
    const { router } = mount({ read: () => json({ detail: 'Revoked' }, 401) });
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('feely_token')).toBeNull();
  });
  test('topic create uses original fields/radios/trimming/default parent and exact payload', async () => {
    const { writes } = mount({ initial: mapData([family()]) });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    const input = within(dialog).getByLabelText('Topic name') as HTMLInputElement;
    expect(input.maxLength).toBe(120);
    expect(input.placeholder).toBe('Dad, Curious, Healing...');
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  Healing  ' } });
    fireEvent.change(within(dialog).getByLabelText('Topic description'), {
      target: { value: '  A short note  ' },
    });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Experience' }));
    fireEvent.change(within(dialog).getByLabelText('Broader topic'), {
      target: { value: 'family' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Family' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create topic' }));
    await screen.findByRole('complementary', { name: 'Healing details' });
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      title: 'Healing',
      category: 'experience',
      description: 'A short note',
      parent_topic_id: 'family',
      related_topic_ids: ['family'],
      chat_id: null,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  test('failed topic form retains draft, rejects blank title and closes with Escape/focus restore', async () => {
    const { writes } = mount({ write: () => json({ detail: 'Topic title is required' }, 400) });
    await loaded();
    const opener = screen.getByRole('button', { name: '+ Add topic' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    const input = within(dialog).getByLabelText('Topic name');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(writes()).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.submit(input.closest('form')!);
    await within(dialog).findByText('Topic title is required');
    expect((input as HTMLInputElement).value).toBe('Keep this draft');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  test('pending form prevents duplicate saves, close/backdrop/Escape while input remains local', async () => {
    const response = deferred<Response>();
    const { writes } = mount({ write: () => response.promise });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    const input = within(dialog).getByLabelText('Topic name');
    fireEvent.change(input, { target: { value: 'Pending' } });
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(
      (within(dialog).getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeDefined();
    await act(() =>
      response.resolve(
        json({ topic: topic('pending', 'Pending'), map: mapData([topic('pending', 'Pending')]) }),
      ),
    );
    await screen.findByRole('complementary', { name: 'Pending details' });
  });
  test('edit topic changes fields and links with PATCH; full backend response changes graph', async () => {
    const { writes } = mount({ initial: mapData([family(), rest()]) });
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Edit & connect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit topic' });
    expect(
      (within(dialog).getByLabelText('Topic description') as HTMLTextAreaElement).maxLength,
    ).toBe(2000);
    fireEvent.change(within(dialog).getByLabelText('Topic name'), {
      target: { value: 'Family bonds' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Rest' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save topic' }));
    await screen.findByRole('complementary', { name: 'Family bonds details' });
    expect(writes()[0][1]?.method).toBe('PATCH');
    expect(JSON.parse(String(writes()[0][1]?.body))).toMatchObject({
      related_topic_ids: ['rest'],
      category: 'person',
    });
  });
  test('delete topic requires confirmation, cancellation sends nothing, entries move to Overall', async () => {
    const { writes } = mount({ initial: mapData([family()]) });
    const detail = await select();
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    await screen.findByRole('dialog', { name: 'Confirm action' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(detail).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull());
    await select('Overall');
    await screen.findByText('I value honesty.');
    expect(writes()[0][1]?.method).toBe('DELETE');
  });
  test('merge confirms source/target, keeps target and preserves original topic as entry', async () => {
    const { writes } = mount({ initial: mapData([family(), rest()]) });
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Edit & connect' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit topic' });
    fireEvent.change(within(dialog).getByLabelText('Topic to merge into'), {
      target: { value: 'rest' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge into selected topic' }));
    await screen.findByText('Merge “Family” into “Rest”? The second topic will be kept.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await screen.findByRole('complementary', { name: 'Rest details' });
    expect(String(writes()[0][0])).toContain('/topics/family/merge');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ target_topic_space_id: 'rest' });
    expect(screen.queryByRole('button', { name: 'Open Family' })).toBeNull();
    expect(screen.getByText('Merged topic')).toBeDefined();
  });
  test('disconnect Related asks confirmation and removes only that relation', async () => {
    const { writes } = mount({
      initial: mapData([
        topic('family', 'Family', { related_topic_ids: ['rest'] }),
        topic('rest', 'Rest', { related_topic_ids: ['family'] }),
      ]),
    });
    await select();
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect from Rest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Disconnect from Rest' })).toBeNull(),
    );
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({ related_topic_ids: [] });
    expect(screen.getByRole('button', { name: 'Open Rest' })).toBeDefined();
  });
  test('entry create/edit/move/delete preserve payload, confirmation and contextual rendering', async () => {
    const { writes } = mount({ initial: mapData([family(), rest()]) });
    await select();
    fireEvent.click(screen.getByRole('button', { name: '+ Entry' }));
    let dialog = await screen.findByRole('dialog', { name: 'Add entry' });
    fireEvent.change(within(dialog).getByLabelText('Entry type'), {
      target: { value: 'evidence' },
    });
    fireEvent.change(within(dialog).getByLabelText('Entry text'), {
      target: { value: '  I paused  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));
    await screen.findByText('I paused');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      category: 'evidence',
      text: 'I paused',
      topic_space_id: 'family',
      source_chat_id: null,
    });
    const item = screen.getByText('I paused').closest('article')!;
    fireEvent.click(within(item).getByRole('button', { name: 'Entry actions' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Edit' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit entry' });
    fireEvent.change(within(dialog).getByLabelText('Entry text'), {
      target: { value: 'I rested' },
    });
    fireEvent.change(within(dialog).getByLabelText('Topic for this entry'), {
      target: { value: 'rest' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await select('Rest');
    const moved = (await screen.findByText('I rested')).closest('article')!;
    expect(JSON.parse(String(writes()[1][1]?.body))).toEqual({
      category: 'evidence',
      text: 'I rested',
      topic_space_id: 'rest',
    });
    fireEvent.click(within(moved).getByRole('button', { name: 'Entry actions' }));
    fireEvent.click(within(moved).getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(screen.queryByText('I rested')).toBeNull());
    expect(writes()[2][1]?.method).toBe('DELETE');
  });
  test('practice create, pause, resume and reactivation remain Map actions; completion opens Reflection', async () => {
    const { writes, router } = mount();
    await loaded();
    await select('Overall');
    fireEvent.click(screen.getByRole('button', { name: '+ Practice' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add practice' });
    expect(within(dialog).queryByLabelText('Entry type')).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Entry text'), {
      target: { value: 'Pause before reacting' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save practice' }));
    await screen.findByText('Pause before reacting');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await screen.findByText('Paused');
    expect(JSON.parse(String(writes()[1][1]?.body))).toEqual({
      status: 'paused',
      reflection: null,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByText('Active');
    fireEvent.click(screen.getByRole('link', { name: 'Complete' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/reflection'));
    expect(router.state.location.state.practiceId).toBe('entry-1');
    expect(writes()).toHaveLength(3);
  });
  test('latest three entries reverse order, preview more/less, menus Escape/outside close', async () => {
    mount({
      initial: mapData(
        [],
        [
          mapEntry('one', 'Hidden first'),
          mapEntry('two', 'Second'),
          mapEntry('three', 'Third'),
          mapEntry('four', 'x'.repeat(100)),
        ],
      ),
    });
    const detail = await select('Overall');
    expect(within(detail).queryByText('Hidden first')).toBeNull();
    expect(detail.getElementsByTagName('article')).toHaveLength(3);
    fireEvent.click(within(detail).getByRole('button', { name: 'more' }));
    expect(within(detail).getByText('x'.repeat(100))).toBeDefined();
    fireEvent.click(within(detail).getByRole('button', { name: 'less' }));
    const menu = within(detail).getAllByRole('button', { name: 'Entry actions' })[0];
    fireEvent.click(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });
  test('connected Journal date opens real entry; connected Chat retains ID without migrating Chat', async () => {
    const { router } = mount({
      initial: mapData([
        topic('family', 'Family', { journal_dates: ['2026-10-10'], chat_ids: ['chat-one'] }),
      ]),
    });
    await select();
    fireEvent.click(
      screen.getByRole('button', {
        name: formattedJournalDate('2026-10-10', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
      }),
    );
    await screen.findByLabelText('Daily journal entry');
    expect(router.state.location.pathname).toBe('/journal');
    expect(screen.getByText(formattedJournalDate('2026-10-10'))).toBeDefined();
    await act(() => router.navigate('/map'));
    await select();
    fireEvent.click(screen.getByRole('link', { name: 'Conversation' }));
    expect(router.state.location.pathname).toBe('/chat');
    expect(router.state.location.state.chatId).toBe('chat-one');
  });
  test('Journal accepted suggestion invalidates Map; navigation shows new topic without page reload', async () => {
    const today = localDateKey();
    let accepted = false;
    const newTopic = topic('from-journal', 'From Journal', {
      journal_dates: [today],
      category: 'experience',
    });
    mount({
      path: '/journal',
      read: () => json(mapData(accepted ? [newTopic] : [])),
      overrides: {
        [`/journal/entries/${today}`]: () =>
          json(
            entry(today, 'An analysed journal page', true, [
              { ...topicSuggestion, title: 'From Journal' },
            ]),
          ),
        [`/journal/entries/${today}/suggestions/topic-1`]: () => {
          accepted = true;
          return json({
            suggestion: {
              ...topicSuggestion,
              title: 'From Journal',
              status: 'saved',
              saved_item_id: newTopic.id,
            },
            map: mapData([newTopic]),
          });
        },
      },
    });
    await screen.findByLabelText('Daily journal entry');
    fireEvent.click(await screen.findByRole('button', { name: 'Save topic' }));
    await screen.findByText('Saved to My Map');
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    await screen.findByRole('button', { name: 'Open From Journal' });
    await select('From Journal');
    expect(
      screen.getByRole('button', {
        name: formattedJournalDate(today, { month: 'long', day: 'numeric', year: 'numeric' }),
      }),
    ).toBeDefined();
  });
  test('403 mutation preserves JWT and local form, 423 activates existing Terms gate', async () => {
    const { session } = mount({
      write: () => json({ detail: 'Please verify your email before logging in.' }, 403),
      overrides: { '/users/me/account': () => json({ ...account, is_email_verified: false }) },
    });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    fireEvent.change(within(dialog).getByLabelText('Topic name'), {
      target: { value: 'Keep on failure' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create topic' }));
    await within(dialog).findByText('Please verify your email before logging in.');
    expect(session.getToken()).not.toBeNull();
    expect((within(dialog).getByLabelText('Topic name') as HTMLInputElement).value).toBe(
      'Keep on failure',
    );
  });
  test('server Terms 423 switches to existing gate and never applies a fabricated topic', async () => {
    mount({
      write: () => json({ detail: 'Please accept the current FeelY AGB before continuing.' }, 423),
    });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    fireEvent.change(within(dialog).getByLabelText('Topic name'), {
      target: { value: 'Pending consent' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create topic' }));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByRole('button', { name: 'Open Pending consent' })).toBeNull();
  });
  test('failed entry save keeps its draft and server length validation without a new textarea limit', async () => {
    const { writes } = mount({
      write: () => json({ detail: [{ msg: 'String should have at most 1000 characters' }] }, 422),
    });
    await loaded();
    await select('Overall');
    fireEvent.click(screen.getByRole('button', { name: '+ Entry' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add entry' });
    const input = within(dialog).getByLabelText('Entry text') as HTMLTextAreaElement;
    expect(input.hasAttribute('maxlength')).toBe(false);
    fireEvent.change(input, { target: { value: 'x'.repeat(1001) } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save entry' }));
    await within(dialog).findByText('String should have at most 1000 characters');
    expect(input.value).toHaveLength(1001);
    expect(writes()).toHaveLength(1);
  });
  test('modal Tab boundaries trap focus and background becomes inert', async () => {
    mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add topic' });
    const close = within(dialog).getByRole('button', { name: 'Close' }),
      last = within(dialog).getByRole('button', { name: 'Create topic' });
    expect(document.getElementsByTagName('main')[0].hasAttribute('inert')).toBe(true);
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
  test('completed practice shows original reflection, reactivates and clears reflection with exact payload', async () => {
    const { writes } = mount({
      initial: mapData(
        [],
        [
          mapEntry('p', 'Take a walk', 'practice', {
            status: 'completed',
            reflection: 'It helped',
          }),
        ],
      ),
    });
    await select('Overall');
    await screen.findByText('It helped');
    fireEvent.click(screen.getByRole('button', { name: 'Practice again' }));
    await screen.findByText('Active');
    expect(JSON.parse(String(writes()[0][1]?.body))).toEqual({
      status: 'active',
      reflection: null,
    });
    expect(screen.queryByText('It helped')).toBeNull();
  });
  test('linked Journal load error is shown on its real route rather than leaving a silent Map click', async () => {
    const { router } = mount({
      initial: mapData([family()]),
      overrides: {
        '/journal/entries/2026-10-10': () => json({ detail: 'Journal page unavailable' }, 503),
      },
    });
    await select();
    fireEvent.click(
      screen.getByRole('button', {
        name: formattedJournalDate('2026-10-10', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        }),
      }),
    );
    await screen.findByRole('button', { name: 'Retry entry' });
    expect(router.state.location.pathname).toBe('/journal');
    await screen.findByText('Journal page unavailable');
  });
  test('same-owner Terms/session refresh preserves hidden popup draft and returns it after acceptance', async () => {
    const { session } = mount();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Add topic' }));
    fireEvent.change(await screen.findByLabelText('Topic name'), {
      target: { value: 'Draft through consent' },
    });
    mapBackend({
      overrides: {
        '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
      },
    });
    await act(() => session.reload({ force: true }));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByRole('dialog')).toBeNull();
    mapBackend({ overrides: { '/terms/me': () => json({ ...terms, accepted_current: true }) } });
    await act(() => session.reload({ force: true }));
    await screen.findByRole('dialog', { name: 'Add topic' });
    expect((screen.getByLabelText('Topic name') as HTMLInputElement).value).toBe(
      'Draft through consent',
    );
  });
  test('clicking current Map refreshes and resets details without adding history or losing filter', async () => {
    const { router, fetch } = mount({ initial: mapData([family()]) });
    await select();
    const before = fetch.mock.calls.filter((call) =>
      String(call[0]).endsWith('/users/me/map'),
    ).length;
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Family details' })).toBeNull(),
    );
    await waitFor(() =>
      expect(
        fetch.mock.calls.filter((call) => String(call[0]).endsWith('/users/me/map')).length,
      ).toBeGreaterThan(before),
    );
    expect(router.state.historyAction).toBe('REPLACE');
  });
});
