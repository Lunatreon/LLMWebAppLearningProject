import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import { deferred, json, jwt, mockBackend } from './backend';

const resetToken = 'synthetic-reset-token-for-tests-only-12345';
const secret = ' New password 123 ';
const generic = 'If that account exists, a password reset email has been sent.';
const success = 'Your password has been reset. You can now log in.';
const invalid = 'Password reset link is invalid or expired.';

function mount(
  options: {
    entry?: string | { pathname: string; search?: string; state?: unknown };
    stored?: string;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.stored) localStorage.setItem('feely_token', options.stored);
  const fetch = mockBackend({
    '/auth/password-reset/request': () => json({ sent: true, detail: generic }),
    '/auth/password-reset/confirm': () => json({ reset: true, detail: success }),
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
    { initialEntries: [options.entry ?? '/forgot-password'] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  const requests = () =>
    fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/password-reset/request'));
  const resets = () =>
    fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/password-reset/confirm'));
  return { ...view, fetch, controller, router, requests, resets };
}
async function emailForm(value = 'member@example.test') {
  const form = await screen.findByRole('form', { name: 'Request password reset' });
  fireEvent.change(screen.getByLabelText('Email'), { target: { value } });
  return form;
}
async function passwordForm(password = secret, confirmation = password) {
  const form = await screen.findByRole('form', { name: 'Reset password' });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmation },
  });
  return form;
}
function tokenEntry(path = '/reset-password', extra = '') {
  return `${path}?reset_password_token=${resetToken}${extra}`;
}

describe('React password recovery request', () => {
  test('preserves original request copy/fields/native email validation and Login email prefill', async () => {
    const { router } = mount({ entry: '/login' });
    await screen.findByRole('form', { name: 'Login' });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'member@example.test' } });
    await userEvent.setup().click(screen.getByRole('link', { name: 'Forgot your password?' }));
    expect(router.state.location.pathname).toBe('/forgot-password');
    expect(
      await screen.findByText('Enter the email address connected to your FeelY account.'),
    ).toBeDefined();
    const input = screen.getByLabelText('Email') as HTMLInputElement;
    expect(input.value).toBe('member@example.test');
    expect(input.type).toBe('email');
    expect(input.required).toBe(true);
    expect(input.autocomplete).toBe('email');
    expect(document.activeElement).toBe(input);
    expect(input.closest('section')!.id).toBe('password-reset-request-view');
    expect(screen.queryByLabelText('Username')).toBeNull();
  });

  test.each(['', 'not-an-email'])('rejects invalid address %s without POST', async (email) => {
    const { requests } = mount();
    fireEvent.submit(await emailForm(email));
    expect(requests().length).toBe(0);
  });

  test.each(['existing@example.test', 'unknown@example.test', 'disabled@example.test'])(
    'displays identical authoritative generic response for %s',
    async (email) => {
      const { requests, controller } = mount();
      fireEvent.submit(await emailForm(` ${email} `));
      await screen.findByText(generic);
      const options = requests()[0][1]!;
      expect(JSON.parse(String(options.body))).toEqual({ email });
      expect(new Headers(options.headers).has('Authorization')).toBe(false);
      expect(options.credentials).toBeUndefined();
      expect((screen.getByLabelText('Email') as HTMLInputElement).value.trim()).toBe(email);
      expect(controller.getSnapshot().session.status).toBe('unauthenticated');
      expect(localStorage.length).toBe(0);
      expect(
        screen.queryByText(/^(?:This |The )?account (?:exists|does not exist)[.!]?$/i),
      ).toBeNull();
    },
  );

  test('pending request shows Sending, disables Submit and rejects repeated events; no invented later cooldown', async () => {
    const response = deferred<Response>();
    let pending = true;
    const { requests } = mount({
      overrides: {
        '/auth/password-reset/request': () =>
          pending ? response.promise : json({ sent: true, detail: generic }),
      },
    });
    const form = await emailForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByText('Sending...')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Send reset link' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(requests().length).toBe(1);
    await act(() => response.resolve(json({ sent: true, detail: generic })));
    pending = false;
    fireEvent.submit(form);
    await waitFor(() => expect(requests().length).toBe(2));
  });

  test.each([
    [422, [{ msg: 'value is not a valid email address' }]],
    [503, 'Password reset email is not configured.'],
    [502, 'Email delivery is temporarily unavailable.'],
  ])('recovery %s errors preserve address and backend semantics', async (status, detail) => {
    mount({ overrides: { '/auth/password-reset/request': () => json({ detail }, status) } });
    fireEvent.submit(await emailForm());
    await screen.findByText(Array.isArray(detail) ? detail[0].msg : detail);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.test');
  });

  test('recovery 429 displays server Retry-After without inventing a timer', async () => {
    mount({
      overrides: {
        '/auth/password-reset/request': () =>
          json({ detail: 'Too many password reset requests. Please try again later.' }, 429, {
            'Retry-After': '60',
          }),
      },
    });
    fireEvent.submit(await emailForm());
    await screen.findByText(
      'Too many password reset requests. Please try again later. Try again in 60 seconds.',
    );
    expect(
      (screen.getByRole('button', { name: 'Send reset link' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test('network failure keeps email and never automatically replays recovery', async () => {
    const { requests } = mount({
      overrides: { '/auth/password-reset/request': () => Promise.reject(new TypeError('Offline')) },
    });
    fireEvent.submit(await emailForm());
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(requests().length).toBe(1);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.test');
  });

  test('malformed recovery response cannot imply that an account exists', async () => {
    mount({ overrides: { '/auth/password-reset/request': () => json({ sent: 'yes' }) } });
    fireEvent.submit(await emailForm());
    await screen.findByText('FeelY returned an invalid recovery response. Please try again.');
    expect(localStorage.length).toBe(0);
  });

  test('Close preserves only email and safe destination, and the public request does not invalidate an existing JWT', async () => {
    const token = jwt();
    const { controller, router } = mount({
      stored: token,
      entry: {
        pathname: '/forgot-password',
        state: { email: 'member@example.test', afterLogin: '/account', password: 'never-copy' },
      },
    });
    fireEvent.submit(await emailForm());
    await screen.findByText(generic);
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    await userEvent.setup().click(screen.getByRole('link', { name: 'Close' }));
    await screen.findByLabelText('Display name');
    expect(router.state.location.pathname).toBe('/account');
    expect(router.state.location.state).toEqual({ workspace: 'chat' });
  });
});

describe('React password reset and token safety', () => {
  test.each(['/reset-password', '/', '/index.html', '/chat.html', '/login'])(
    'existing query link on %s opens reset without shell links and removes token from visible history',
    async (path) => {
      const { router, container } = mount({
        entry: tokenEntry(path, '&api_base=custom&view=map&token=do-not-copy#secret-fragment'),
      });
      await passwordForm();
      expect(router.state.location.pathname).toBe('/reset-password');
      expect(router.state.location.search).toBe('?api_base=custom&view=map');
      expect(router.state.location.hash).toBe('');
      expect(router.state.location.state).toEqual({ afterLogin: '/map', workspace: 'map' });
      expect(container.innerHTML).not.toContain(resetToken);
      expect(container.innerHTML).not.toContain('do-not-copy');
      expect(screen.queryByRole('complementary')).toBeNull();
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      for (const link of Array.from(container.querySelectorAll('a')))
        expect(link.href).not.toContain(resetToken);
    },
  );

  test.each([
    ['/reset-password', 'This reset link is missing its token.'],
    [
      '/reset-password?reset_password_token=short',
      'This reset link is invalid. Please request a new link.',
    ],
    [
      `/reset-password?reset_password_token=${'x'.repeat(513)}`,
      'This reset link is invalid. Please request a new link.',
    ],
  ])('missing/malformed link is recoverable at %s', async (entry, problem) => {
    const { resets } = mount({ entry });
    await screen.findByText(problem);
    fireEvent.submit(await passwordForm());
    expect(resets().length).toBe(0);
    expect(
      (screen.getByRole('button', { name: 'Save new password' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByRole('link', { name: 'Request a new reset link' }).getAttribute('href'),
    ).toBe('/forgot-password');
  });

  test('reset inputs preserve the original labels/native minimum/confirmation and leave backend maximum authoritative', async () => {
    mount({ entry: tokenEntry() });
    await passwordForm();
    for (const label of ['New password', 'Confirm new password']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.required).toBe(true);
      expect(input.minLength).toBe(8);
      expect(input.autocomplete).toBe('new-password');
      expect(input.hasAttribute('maxlength')).toBe(false);
    }
    expect(document.activeElement).toBe(screen.getByLabelText('New password'));
    expect(screen.getByText('Choose a new password')).toBeDefined();
  });

  test.each([
    ['', ''],
    ['short', 'short'],
  ])('rejects empty/short passwords without POST', async (password, confirmation) => {
    const { resets } = mount({ entry: tokenEntry() });
    fireEvent.submit(await passwordForm(password, confirmation));
    expect(resets().length).toBe(0);
  });

  test('confirmation mismatch preserves fields and prevents reset', async () => {
    const { resets } = mount({ entry: tokenEntry() });
    fireEvent.submit(await passwordForm(secret, 'Other password 123'));
    await screen.findByText('The passwords do not match.');
    expect(resets().length).toBe(0);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(secret);
  });

  test('successful reset sends exact public payload, clears secrets and waits 1200ms before a token-free Login handoff', async () => {
    const { resets, router, controller, fetch } = mount({
      entry: tokenEntry('/', '&api_base=custom&view=map'),
    });
    const form = await passwordForm();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(screen.getByText(success)).toBeDefined();
    expect(resets().length).toBe(1);
    const options = resets()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({ token: resetToken, new_password: secret });
    expect(options.method).toBe('POST');
    expect(options.credentials).toBeUndefined();
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    await act(async () => vi.advanceTimersByTimeAsync(1199));
    expect(router.state.location.pathname).toBe('/reset-password');
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?api_base=custom&view=map');
    expect(router.state.location.state).toEqual({
      afterLogin: '/map',
      workspace: 'map',
      notice: 'password-reset',
    });
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(success)).toBeDefined();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/auth/login'))).toBe(false);
  });

  test('pending reset rejects duplicate submits and shows original Saving status', async () => {
    const response = deferred<Response>();
    const { resets, router } = mount({
      entry: tokenEntry(),
      overrides: { '/auth/password-reset/confirm': () => response.promise },
    });
    const form = await passwordForm();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(screen.getByText('Saving...')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Save new password' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(resets().length).toBe(1);
    await act(() => response.resolve(json({ reset: true, detail: success })));
    await screen.findByText(success);
    await act(() => router.navigate('/login')); // Cancels delayed success navigation on unmount.
  });

  test.each(['invalid', 'expired', 'already used', 'replaced/revoked', 'disabled account'])(
    '%s reset token keeps generic backend failure and local fields',
    async () => {
      const { resets } = mount({
        entry: tokenEntry(),
        overrides: { '/auth/password-reset/confirm': () => json({ detail: invalid }, 400) },
      });
      fireEvent.submit(await passwordForm());
      await screen.findByText(invalid);
      expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(secret);
      expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe(
        secret,
      );
      expect(resets().length).toBe(1);
      expect(localStorage.length).toBe(0);
    },
  );

  test('backend maximum-length/validation errors are authoritative and preserve the password', async () => {
    const long = 'p'.repeat(129);
    const { resets } = mount({
      entry: tokenEntry(),
      overrides: {
        '/auth/password-reset/confirm': () =>
          json({ detail: [{ msg: 'String should have at most 128 characters' }] }, 422),
      },
    });
    fireEvent.submit(await passwordForm(long));
    await screen.findByText('String should have at most 128 characters');
    expect(JSON.parse(String(resets()[0][1]?.body)).new_password.length).toBe(129);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(long);
  });

  test.each([503, 429])(
    'reset backend %s preserves fields and uses shared errors',
    async (status) => {
      mount({
        entry: tokenEntry(),
        overrides: {
          '/auth/password-reset/confirm': () =>
            json(
              { detail: 'Reset temporarily unavailable' },
              status,
              status === 429 ? { 'Retry-After': '60' } : {},
            ),
        },
      });
      fireEvent.submit(await passwordForm());
      await screen.findByText(
        status === 429
          ? 'Reset temporarily unavailable Try again in 60 seconds.'
          : 'Reset temporarily unavailable',
      );
      expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(secret);
    },
  );

  test('reset network failure does not replay the token/password POST', async () => {
    const { resets } = mount({
      entry: tokenEntry(),
      overrides: { '/auth/password-reset/confirm': () => Promise.reject(new TypeError('Offline')) },
    });
    fireEvent.submit(await passwordForm());
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(resets().length).toBe(1);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(secret);
  });

  test('malformed reset response never authenticates or navigates to success', async () => {
    const { router } = mount({
      entry: tokenEntry(),
      overrides: { '/auth/password-reset/confirm': () => json({ access_token: jwt() }) },
    });
    fireEvent.submit(await passwordForm());
    await screen.findByText(
      'FeelY returned an invalid reset response. Please request a new link if this one has already been used.',
    );
    expect(router.state.location.pathname).toBe('/reset-password');
    expect(localStorage.length).toBe(0);
  });

  test('reset Close and brand navigation never carry token or passwords into another route/history state', async () => {
    const { router, container } = mount({ entry: tokenEntry('/', '&api_base=custom') });
    await passwordForm();
    expect(container.innerHTML).not.toContain(resetToken);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Close' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.search).toBe('?api_base=custom');
    expect(JSON.stringify(router.state.location.state)).not.toContain(resetToken);
    expect(JSON.stringify(router.state.location.state)).not.toContain(secret);
  });

  test('refresh-style token-free remount cannot restore the consumed in-memory token', async () => {
    const first = mount({ entry: tokenEntry() });
    await passwordForm();
    const clean = first.router.state.location.pathname + first.router.state.location.search;
    first.unmount();
    mount({ entry: clean });
    await screen.findByText('This reset link is missing its token.');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  test('new reset link replaces the previous in-memory token and clears entered fields', async () => {
    const next = 'another-synthetic-token-for-tests-only-67890';
    const { router, resets } = mount({
      entry: tokenEntry(),
      overrides: { '/auth/password-reset/confirm': () => json({ detail: invalid }, 400) },
    });
    await passwordForm();
    await act(() => router.navigate(`/reset-password?reset_password_token=${next}`));
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    fireEvent.submit(await passwordForm());
    await screen.findByText(invalid);
    expect(JSON.parse(String(resets()[0][1]?.body)).token).toBe(next);
  });

  test('leaving during reset prevents late response/timer from navigating over the chosen page', async () => {
    const response = deferred<Response>();
    const { router } = mount({
      entry: tokenEntry(),
      overrides: { '/auth/password-reset/confirm': () => response.promise },
    });
    fireEvent.submit(await passwordForm());
    await act(() => router.navigate('/forgot-password'));
    await act(() => response.resolve(json({ reset: true, detail: success })));
    expect(router.state.location.pathname).toBe('/forgot-password');
    expect(screen.queryByText(success)).toBeNull();
  });

  test('a successful reset preserves the existing JWT/session and applies normal authenticated Login routing', async () => {
    const token = jwt();
    const { router, controller } = mount({ entry: tokenEntry(), stored: token });
    fireEvent.submit(await passwordForm());
    await screen.findByText(success);
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chat'), { timeout: 2500 });
    expect(localStorage.getItem('feely_token')).toBe(token);
  });
});
