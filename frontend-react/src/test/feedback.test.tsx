import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import { account, deferred, json, jwt, mockBackend, terms } from './backend';

const savedMessage = 'Thank you! Your feedback has been saved for the FeelY team.';

function mount(
  options: {
    authenticated?: boolean;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.authenticated !== false) localStorage.setItem('feely_token', jwt());
  const fetch = mockBackend({
    '/feedback': () => json({ id: 1, detail: savedMessage }, 201),
    ...options.overrides,
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
    { initialEntries: ['/feedback'] },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  const posts = () => fetch.mock.calls.filter((call) => String(call[0]).endsWith('/feedback'));
  return { fetch, controller, router, posts };
}

async function fill(message = 'A helpful test message', category = 'bug') {
  const user = userEvent.setup();
  const input = (await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement;
  await user.selectOptions(screen.getByLabelText('What would you like to share?'), category);
  await user.type(input, message);
  return { user, input };
}

describe('real Feedback feature', () => {
  test('renders the original copy, fields, validation and paper panel after session/config loading', async () => {
    mount();
    const input = (await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement;
    expect(
      screen.getByText(
        'Your feedback and account email are shared with the FeelY team. Chat messages are not attached.',
      ),
    ).toBeDefined();
    expect(input.required).toBe(true);
    expect(input.minLength).toBe(3);
    expect(input.maxLength).toBe(5000);
    expect(input.rows).toBe(6);
    expect(input.placeholder).toBe('Tell us what happened or what could be better...');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'General feedback',
      'Something is not working',
      'An idea',
    ]);
    expect(input.closest('section')?.classList.contains('app-dialog')).toBe(true);
    expect(
      screen.queryByText('This feedback page is not migrated yet.', { exact: false }),
    ).toBeNull();
  });

  test('unauthenticated access does not expose the form or call protected endpoints', async () => {
    const { fetch, posts } = mount({ authenticated: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(posts().length).toBe(0);
    expect(
      fetch.mock.calls.every((call) =>
        ['/feedback/config', '/auth/email/config'].some((path) => String(call[0]).endsWith(path)),
      ),
    ).toBe(true);
  });

  test('shows loading and account failure with Retry, without mistaking a valid token for a successful session', async () => {
    const pending = deferred<Response>();
    const { fetch } = mount({
      overrides: {
        '/users/me/account': () => pending.promise.then((response) => response.clone()),
      },
    });
    expect(screen.getByText('Loading your session...')).toBeDefined();
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    await act(() => pending.resolve(json({ detail: 'Session service unavailable' }, 503)));
    await screen.findByText('Session service unavailable');
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    fetch.mockImplementation(async (input, options) => {
      const endpoint = String(input);
      if (endpoint.endsWith('/users/me/account')) return json(account);
      if (endpoint.endsWith('/terms/me')) return json(terms);
      // Billing failures intentionally preserve the legacy conservative fallback.
      if (options?.method === 'POST') return json({ id: 1, detail: savedMessage }, 201);
      return json({ detail: 'Unavailable' }, 503);
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry session' }));
    await screen.findByLabelText('Your feedback');
  });

  test('validation prevents empty/short/overlong submissions', async () => {
    const { posts } = mount();
    const input = await screen.findByLabelText('Your feedback');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await user.type(input, 'ab');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.change(input, { target: { value: 'a'.repeat(5001) } });
    fireEvent.submit(input.closest('form')!);
    expect(posts().length).toBe(0);
  });

  test('submits only trimmed message/category with Bearer/default credentials and resets on success', async () => {
    const { posts } = mount();
    const { user, input } = await fill('  A helpful test message  ');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText(savedMessage);
    expect(posts().length).toBe(1);
    const options = posts()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({
      category: 'bug',
      message: 'A helpful test message',
    });
    expect(new Headers(options.headers).get('Authorization')).toBe(
      `Bearer ${localStorage.getItem('feely_token')}`,
    );
    expect(options.credentials).toBeUndefined();
    expect(input.value).toBe('');
    expect(
      (screen.getByLabelText('What would you like to share?') as HTMLSelectElement).value,
    ).toBe('general');
    expect(
      (screen.getByRole('button', { name: 'Send feedback' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test('a failed submission retains category/message and permits a manual retry without logging out', async () => {
    let failing = true;
    const { posts } = mount({
      overrides: {
        '/feedback': () =>
          failing
            ? json({ detail: 'Please try again later' }, 500)
            : json({ id: 1, detail: savedMessage }, 201),
      },
    });
    const { user, input } = await fill('Keep my failed draft', 'idea');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('Please try again later');
    expect(input.value).toBe('Keep my failed draft');
    expect(
      (screen.getByLabelText('What would you like to share?') as HTMLSelectElement).value,
    ).toBe('idea');
    expect(posts().length).toBe(1);
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText(savedMessage);
    expect(posts().length).toBe(2);
  });

  test('network failure does not replay POST or discard the draft', async () => {
    const { posts } = mount({
      overrides: { '/feedback': () => Promise.reject(new TypeError('Offline')) },
    });
    const { user, input } = await fill('Keep this message');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(input.value).toBe('Keep this message');
    expect(posts().length).toBe(1);
  });

  test('pending requests show loading and reject repeated submits, including direct form submissions', async () => {
    const response = deferred<Response>();
    const { posts } = mount({ overrides: { '/feedback': () => response.promise } });
    const { user, input } = await fill();
    const submit = screen.getByRole('button', { name: 'Send feedback' }) as HTMLButtonElement;
    await user.click(submit);
    expect(submit.disabled).toBe(true);
    expect(screen.getByText('Saving feedback...')).toBeDefined();
    fireEvent.submit(input.closest('form')!);
    fireEvent.submit(input.closest('form')!);
    expect(posts().length).toBe(1);
    await act(() => response.resolve(json({ id: 1, detail: savedMessage }, 201)));
    expect(submit.disabled).toBe(false);
    expect(input.value).toBe('');
  });

  test('server validation retains the original untrimmed input and rate limits preserve Retry-After', async () => {
    let rateLimited = false;
    mount({
      overrides: {
        '/feedback': () =>
          rateLimited
            ? json({ detail: 'Too many requests.' }, 429, { 'Retry-After': '45' })
            : json({ detail: [{ msg: 'String should have at least 3 characters' }] }, 422),
      },
    });
    const { user, input } = await fill('   ');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('String should have at least 3 characters');
    expect(input.value).toBe('   ');
    rateLimited = true;
    await user.clear(input);
    await user.type(input, 'Another message');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('Too many requests. Try again in 45 seconds.');
    expect(input.value).toBe('Another message');
  });

  test('disabled feedback hides the sidebar entry and form, and a config failure can be retried', async () => {
    let configState = 'disabled';
    const { controller } = mount({
      overrides: {
        '/feedback/config': () =>
          configState === 'error'
            ? json({ detail: 'Config unavailable' }, 503)
            : json({ enabled: configState === 'enabled' }),
      },
    });
    await screen.findByText('Test feedback is currently closed.');
    expect(screen.queryByRole('button', { name: 'Share test feedback' })).toBeNull();
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    configState = 'error';
    await act(() => controller.refreshFeedbackConfig());
    await screen.findByText('Config unavailable');
    configState = 'enabled';
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry feedback availability' }));
    await screen.findByLabelText('Your feedback');
    expect(screen.getByRole('button', { name: 'Share test feedback' })).toBeDefined();
  });

  test('a 404 closes feedback immediately and retains the backend closure message', async () => {
    mount({
      overrides: { '/feedback': () => json({ detail: 'Test feedback is currently closed.' }, 404) },
    });
    const { user } = await fill();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByText('Test feedback is currently closed.');
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Share test feedback' })).toBeNull();
  });

  test('a submission 401 expires the session and clears the visible draft', async () => {
    mount({ overrides: { '/feedback': () => json({ detail: 'Revoked' }, 401) } });
    const { user } = await fill();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(screen.getByText('Your session has ended. Please sign in again.')).toBeDefined();
  });

  test('423 blocks further submissions without clearing the session/draft, and rechecking accepted terms restores it', async () => {
    const { controller } = mount({
      overrides: {
        '/feedback': () =>
          json({ detail: 'Please accept the current FeelY AGB before continuing.' }, 423),
      },
    });
    const { user } = await fill('My draft before terms change');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    mockBackend({
      '/terms/me': () =>
        json({ ...terms, current: { ...terms.current, enforced: true }, accepted_current: true }),
    });
    await act(() => controller.reload());
    const input = (await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement;
    expect(input.value).toBe('My draft before terms change');
  });

  test('drafts survive closing/reopening the routed panel and clear on sign-out', async () => {
    const { router, controller } = mount();
    const originalToken = localStorage.getItem('feely_token')!;
    const { user } = await fill('Keep the draft when I close');
    await user.click(screen.getByRole('link', { name: 'Close' }));
    expect(router.state.location.pathname).toBe('/chat');
    expect(await screen.findByLabelText('Message FeelY')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Share test feedback' }));
    expect(((await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement).value).toBe(
      'Keep the draft when I close',
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
    expect(localStorage.getItem('feely_token')).toBeNull();
    localStorage.setItem('feely_token', originalToken);
    await act(() => controller.reload());
    expect(((await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement).value).toBe('');
  });

  test('closing during a submission preserves duplicate protection and applies the eventual success reset', async () => {
    const pending = deferred<Response>();
    const { posts } = mount({ overrides: { '/feedback': () => pending.promise } });
    const { user } = await fill('One submission even if I navigate');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    await user.click(screen.getByRole('link', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Share test feedback' }));
    const input = (await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement;
    expect(
      (screen.getByRole('button', { name: 'Send feedback' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.submit(input.closest('form')!);
    expect(posts().length).toBe(1);
    await act(() => pending.resolve(json({ id: 1, detail: savedMessage }, 201)));
    expect(input.value).toBe('');
    expect(screen.getByText(savedMessage)).toBeDefined();
  });

  test('late responses from a previous account cannot clear another account’s draft or session', async () => {
    const pending = deferred<Response>();
    const { controller } = mount({ overrides: { '/feedback': () => pending.promise } });
    const { user } = await fill('Old user draft');
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    localStorage.setItem('feely_token', jwt(undefined, '2'));
    mockBackend({
      '/users/me/account': () => json({ ...account, id: 2, display_name: 'Second member' }),
    });
    await act(() => controller.reload());
    const input = (await screen.findByLabelText('Your feedback')) as HTMLTextAreaElement;
    expect(input.value).toBe('');
    await user.type(input, 'New user draft');
    await act(() => pending.resolve(json({ detail: 'Old token revoked' }, 401)));
    await waitFor(() => expect(controller.getSnapshot().session.status).toBe('authenticated'));
    expect(input.value).toBe('New user draft');
    expect(screen.getByText('Second member')).toBeDefined();
    expect(localStorage.getItem('feely_token')).not.toBeNull();
  });
});
