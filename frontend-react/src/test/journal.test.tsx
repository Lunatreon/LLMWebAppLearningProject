import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import { formattedJournalDate, localDateKey, shiftedDateKey } from '../features/journal/dates';
import { account, deferred, json, jwt, subscription, terms } from './backend';
import { entry, journalBackend, topicSuggestion, mapSuggestion } from './journalBackend';
import { setMobileViewport } from './setup';

function mount(
  options: Parameters<typeof journalBackend>[0] & { signedIn?: boolean; access?: boolean } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const backend = journalBackend({
    ...options,
    overrides: {
      '/billing/subscription': () =>
        json({ ...subscription, journal_access: options.access !== false }),
      ...options.overrides,
    },
  });
  const controller = new SessionController('http://127.0.0.1:8000/api/v1');
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <SessionProvider controller={controller}>
            <FeedbackProvider>
              <App />
            </FeedbackProvider>
          </SessionProvider>
        ),
      },
    ],
    { initialEntries: ['/journal'] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return { ...view, ...backend, controller, router };
}
async function editor() {
  const input = (await screen.findByLabelText('Daily journal entry')) as HTMLTextAreaElement;
  await waitFor(() => expect(input.disabled).toBe(false));
  return input;
}

describe('real Journal route/editor/navigation', () => {
  test('renders original paper/header/sidebar/editor/copy/max/word count and real empty day', async () => {
    const { puts } = mount();
    const input = await editor();
    expect(input.id).toBe('journal-text');
    expect(input.maxLength).toBe(100000);
    expect(input.placeholder).toBe('Start writing. This page saves automatically...');
    expect(screen.getByText('What is on your mind?')).toBeDefined();
    expect(screen.getByText('New page')).toBeDefined();
    expect(screen.getByText('0 words')).toBeDefined();
    expect(screen.getByText('Your saved pages will appear here.')).toBeDefined();
    expect(screen.getByText(formattedJournalDate(localDateKey()))).toBeDefined();
    expect(
      screen.queryByText('This journal page is not migrated yet.', { exact: false }),
    ).toBeNull();
    expect(puts().length).toBe(0);
  });
  test('existing content loads and editing updates controlled text/count without waiting for PUT', async () => {
    const today = localDateKey();
    mount({ initial: { [today]: entry(today, 'Two words', true) } });
    const input = await editor();
    expect(input.value).toBe('Two words');
    expect(screen.getByText('2 words')).toBeDefined();
    fireEvent.change(input, { target: { value: '  One  ' } });
    expect(input.value).toBe('  One  ');
    expect(screen.getByText('1 word')).toBeDefined();
    expect(screen.getByText('Unsaved')).toBeDefined();
  });
  test('entry loading is explicit and disables only an unloaded editor until the read completes', async () => {
    const response = deferred<Response>();
    mount({ read: () => response.promise.then((value) => value.clone()) });
    const input = (await screen.findByLabelText('Daily journal entry')) as HTMLTextAreaElement;
    await screen.findByText('Loading...');
    expect(input.disabled).toBe(true);
    await act(() => response.resolve(json(entry(localDateKey(), 'Loaded', true))));
    expect((await editor()).value).toBe('Loaded');
  });
  test('entry failure has retry and never exposes a fabricated editable empty entry', async () => {
    let failed = true;
    mount({
      read: (date) => (failed ? json({ detail: 'Journal unavailable' }, 503) : json(entry(date))),
    });
    await screen.findByRole('button', { name: 'Retry entry' });
    expect((screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement).disabled).toBe(
      true,
    );
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry entry' }));
    await editor();
  });
  test('history failure is independent from the editor and retry loads original history labels', async () => {
    const yesterday = shiftedDateKey(localDateKey(), -1);
    let fail = true;
    mount({
      history: () =>
        fail
          ? json({ detail: 'History unavailable' }, 503)
          : json([
              {
                entry_date: yesterday,
                excerpt: 'Earlier writing',
                word_count: 2,
                suggestion_count: 0,
                updated_at: '2026-10-12T00:00:00Z',
              },
            ]),
    });
    await editor();
    await screen.findByText('History unavailable');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    await screen.findByText('Earlier writing');
  });
  test('unauthenticated access redirects through existing RequireSession without Journal calls', async () => {
    const { fetch, router } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/journal/'))).toBe(false);
  });
  test('capability gate preserves Premium copy and real delegated billing entry without Journal calls', async () => {
    const { fetch } = mount({ access: false });
    await screen.findByText('A private page for every day');
    expect(screen.getByText('Journal is a Premium space')).toBeDefined();
    expect(screen.queryByLabelText('Daily journal entry')).toBeNull();
    expect(
      new URL((screen.getByRole('link', { name: 'View Premium' }) as HTMLAnchorElement).href)
        .pathname,
    ).toBe('/account');
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/journal/'))).toBe(false);
  });
  test('Terms gate prevents loading/editing until existing terms acceptance says access is allowed', async () => {
    const { fetch } = mount({
      overrides: {
        '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
      },
    });
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByLabelText('Daily journal entry')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).includes('/journal/'))).toBe(false);
  });
  test('server 402 is authoritative and can refresh real session access before retrying', async () => {
    let blocked = true;
    const { controller } = mount({
      read: (date) =>
        blocked
          ? json({ detail: 'Premium is required to access Journal.' }, 402)
          : json(entry(date)),
    });
    await screen.findByRole('button', { name: 'Check access again' });
    expect(screen.queryByLabelText('Daily journal entry')).toBeNull();
    blocked = false;
    await act(() => controller.reload({ force: true }));
    await editor();
  });
  test('entry 401 clears the session and returns to Login without private Journal text', async () => {
    const { router } = mount({ read: () => json({ detail: 'Revoked' }, 401) });
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
    expect(localStorage.getItem('feely_token')).toBeNull();
  });
  test('previous/next/today/history work in the sidebar, and Next is disabled at today', async () => {
    const today = localDateKey();
    const older = shiftedDateKey(today, -3);
    mount({ initial: { [older]: entry(older, 'Earlier entry text', true) } });
    await editor();
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await screen.findByText(formattedJournalDate(shiftedDateKey(today, -1)));
    await editor();
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Today Open a fresh page' }));
    await screen.findByText(formattedJournalDate(today));
    fireEvent.click(
      screen.getByRole('button', {
        name: `${formattedJournalDate(older, { month: 'short', day: 'numeric', year: 'numeric' })} Earlier entry text`,
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement).value).toBe(
        'Earlier entry text',
      ),
    );
  });
  test('backend-stored future entries remain selectable in history while Next is disabled there', async () => {
    const future = shiftedDateKey(localDateKey(), 2);
    mount({ initial: { [future]: entry(future, 'Future stored entry', true) } });
    await editor();
    fireEvent.click(
      screen.getByRole('button', {
        name: `${formattedJournalDate(future, { month: 'short', day: 'numeric', year: 'numeric' })} Future stored entry`,
      }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement).value).toBe(
        'Future stored entry',
      ),
    );
    expect((screen.getByRole('button', { name: 'Next day' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  test('mobile history/date selection closes the original drawer after successful loading', async () => {
    setMobileViewport(true);
    const { container } = mount();
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Open journal pages' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await waitFor(() =>
      expect(container.querySelector('#sidebar')?.classList.contains('open')).toBe(false),
    );
  });
  test('navigation during debounce flushes once, then returns to real Journal with the persisted text', async () => {
    const { router, puts } = mount();
    fireEvent.change(await editor(), { target: { value: 'Before leaving Journal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    await screen.findByLabelText('Display name');
    expect(router.state.location.pathname).toBe('/account');
    expect(puts().length).toBe(1);
    await act(() => router.navigate('/journal'));
    expect((await editor()).value).toBe('Before leaving Journal');
  });
  test('failed route-leave save keeps Journal/text/dirty and exposes retry instead of discarding edits', async () => {
    let fail = true;
    const { router } = mount({
      write: (date, text) =>
        fail ? json({ detail: 'Save failed on leave' }, 503) : json(entry(date, text, true)),
    });
    const input = await editor();
    fireEvent.change(input, { target: { value: 'Keep my draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    await screen.findByText('Save failed on leave');
    expect(router.state.location.pathname).toBe('/journal');
    expect(input.value).toBe('Keep my draft');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeDefined();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await screen.findByText('Saved');
  });
  test('hiding the tab uses keepalive, and a failure preserves dirty/editor text', async () => {
    const { puts } = mount({ write: () => json({ detail: 'Visibility save failed' }, 503) });
    fireEvent.change(await editor(), { target: { value: 'Draft while hiding' } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
    await screen.findByText('Visibility save failed');
    expect(puts()[0][1]?.keepalive).toBe(true);
    expect((screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement).value).toBe(
      'Draft while hiding',
    );
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
  });
  test('beforeunload starts keepalive and warns only while dirty', async () => {
    const { puts } = mount();
    await editor();
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText('Daily journal entry'), {
      target: { value: 'Before unload' },
    });
    const dirty = new Event('beforeunload', { cancelable: true });
    await act(() => window.dispatchEvent(dirty));
    expect(dirty.defaultPrevented).toBe(true);
    expect(puts()[0][1]?.keepalive).toBe(true);
  });
  test('analysis displays real suggestion cards with topic categories and exact edited acceptance payload', async () => {
    const today = localDateKey();
    const { posts } = mount({
      initial: { [today]: entry(today, 'Long journal entry that can be analysed', true) },
    });
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Find map insights' }));
    await screen.findByText('Keep only what feels true');
    const card = screen.getByLabelText('Topic title').closest('article')!;
    await within(card).findByRole('option', { name: 'Existing topic' });
    fireEvent.change(within(card).getByLabelText('Topic title'), {
      target: { value: 'Edited topic' },
    });
    fireEvent.change(within(card).getByLabelText('Topic description'), {
      target: { value: 'Edited description' },
    });
    fireEvent.click(within(card).getByRole('radio', { name: 'Experience' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Save topic' }));
    await screen.findByText('Saved to My Map');
    const decision = posts().find((call) => String(call[0]).endsWith('/suggestions/topic-1'));
    expect(JSON.parse(String(decision?.[1]?.body))).toEqual({
      accepted: true,
      title: 'Edited topic',
      text: 'Edited description',
      topic_category: 'experience',
      category: 'own_perception',
      topic_space_id: null,
    });
    expect((within(card).getByLabelText('Topic title') as HTMLInputElement).disabled).toBe(true);
  });
  test('existing topic selection uses its type and allows the original note category selection', async () => {
    const today = localDateKey();
    const { posts } = mount({
      initial: { [today]: entry(today, 'Existing suggestions', true, [topicSuggestion]) },
    });
    await editor();
    await screen.findByRole('option', { name: 'Existing topic' });
    fireEvent.change(screen.getByLabelText('Connect this journal page to a topic'), {
      target: { value: 'existing' },
    });
    expect((screen.getByRole('radio', { name: 'Person' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText('Note category for existing topic'), {
      target: { value: 'practice' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save topic' }));
    await screen.findByText('Saved to My Map');
    expect(JSON.parse(String(posts()[0][1]?.body))).toMatchObject({
      topic_space_id: 'existing',
      topic_category: 'person',
      category: 'practice',
    });
  });
  test('map-entry acceptance/dismissal remain Journal controls and do not navigate to a migrated Map page', async () => {
    const today = localDateKey();
    const { router, posts } = mount({
      initial: { [today]: entry(today, 'Map entry suggestion', true, [mapSuggestion]) },
    });
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Not this' }));
    await screen.findByText('Dismissed');
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({ accepted: false });
    expect(router.state.location.pathname).toBe('/journal');
  });
  test('map-entry edited acceptance sends the exact legacy nullable/category/topic payload', async () => {
    const today = localDateKey();
    const { posts } = mount({
      initial: { [today]: entry(today, 'Map entry suggestion', true, [mapSuggestion]) },
    });
    await editor();
    await screen.findByRole('option', { name: 'Existing topic' });
    fireEvent.change(screen.getByLabelText('Map entry'), { target: { value: 'Edited map text' } });
    fireEvent.change(screen.getByLabelText('Map category'), { target: { value: 'practice' } });
    fireEvent.change(screen.getByLabelText('Connect to topic'), { target: { value: 'existing' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to map' }));
    await screen.findByText('Saved to My Map');
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      accepted: true,
      title: null,
      topic_category: null,
      text: 'Edited map text',
      category: 'practice',
      topic_space_id: 'existing',
    });
  });
  test('analysis failure retains entry content and does not invent suggestions', async () => {
    mount({
      analyse: () =>
        json({ detail: 'Write a little more before asking FeelY to find map insights.' }, 422),
    });
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Find map insights' }));
    await screen.findByText('Write a little more before asking FeelY to find map insights.');
    expect(screen.queryByText('Keep only what feels true')).toBeNull();
    expect((screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement).value).toBe('');
  });
  test('save 423 preserves the in-memory draft through Terms gating and restores it after accepted session refresh', async () => {
    const { controller } = mount({
      write: () => json({ detail: 'Please accept the current FeelY AGB before continuing.' }, 423),
    });
    fireEvent.change(await editor(), { target: { value: 'Draft before the new terms' } });
    // Route-leave forces the PUT now; the real API callback updates Terms gating.
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    await screen.findByRole('link', { name: 'Review terms' });
    journalBackend({
      initial: { [localDateKey()]: entry(localDateKey()) },
      overrides: { '/terms/me': () => json({ ...terms, accepted_current: true }) },
    });
    await act(() => controller.reload({ force: true }));
    expect((await editor()).value).toBe('Draft before the new terms');
  });
  test('selecting the current Journal workspace refreshes its index/day after flushing pending edits', async () => {
    const { puts, fetch } = mount();
    fireEvent.change(await editor(), { target: { value: 'Refresh the active workspace' } });
    const before = fetch.mock.calls.filter((call) =>
      String(call[0]).endsWith('/journal/entries?limit=180'),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: 'Journal' }));
    await screen.findByText('Saved');
    expect(puts().length).toBe(1);
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/journal/entries?limit=180'))
        .length,
    ).toBeGreaterThan(before);
    expect((await editor()).value).toBe('Refresh the active workspace');
  });
  test('save 403 retains the token/draft and permits activation recovery instead of trapping navigation', async () => {
    // A still-unverified account can already hold a JWT when verification was
    // previously disabled; enabling the server gate must not trap its draft.
    const { router } = mount({
      write: () => json({ detail: 'Please verify your email before logging in.' }, 403),
      overrides: { '/users/me/account': () => json({ ...account, is_email_verified: false }) },
    });
    fireEvent.change(await editor(), {
      target: { value: 'Private draft while verification changes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Account settings' }));
    await screen.findByLabelText('Display name');
    expect(router.state.location.pathname).toBe('/account');
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    await act(() => router.navigate('/journal'));
    await screen.findByRole('button', { name: 'Check session again' });
    const input = screen.getByLabelText('Daily journal entry') as HTMLTextAreaElement;
    expect(input.value).toBe('Private draft while verification changes');
    expect(input.readOnly).toBe(true);
    fireEvent.click(screen.getByRole('link', { name: 'Activate account / enter email PIN' }));
    await screen.findByRole('form', { name: 'Activate your account' });
    expect(router.state.location.pathname).toBe('/activate');
  });
});
