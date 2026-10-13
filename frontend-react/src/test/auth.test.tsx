import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import { account, deferred, json, jwt, mockBackend, terms } from './backend';

const published = {
  configured: true,
  enforced: true,
  version: 'login-v1',
  document_url: 'https://example.com/terms.pdf',
  document_sha256: 'a'.repeat(64),
};
const password = 'Test password 123';

function mount(
  options: {
    entry?: string | { pathname: string; search?: string; state?: unknown };
    stored?: string;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.stored) localStorage.setItem('feely_token', options.stored);
  const token = jwt();
  const fetch = mockBackend({
    '/auth/login': () => json({ access_token: token, token_type: 'bearer' }),
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
    { initialEntries: [options.entry ?? '/login'] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  const posts = () => fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/login'));
  return { ...view, fetch, token, controller, router, posts };
}

async function fill(email = 'member@example.test', enteredPassword = password) {
  const form = await screen.findByRole('form', { name: 'Login' });
  await waitFor(() =>
    expect(
      (within(form).getByRole('button', { name: 'Login' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: enteredPassword } });
  return form;
}

describe('existing-user React sign-in', () => {
  test('renders original login layout, copy, fields, responsive classes and theme control outside the shell', async () => {
    mount();
    await fill();
    expect(screen.getByRole('heading', { name: 'Return to your space' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Become your own creation.' })).toBeDefined();
    expect(screen.getByText('Your private reflection space')).toBeDefined();
    expect(
      screen.getByText('Your conversations remain connected to your private account.'),
    ).toBeDefined();
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByLabelText('Username')).toBeNull();
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const secret = screen.getByLabelText('Password') as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(email.required).toBe(true);
    expect(email.autocomplete).toBe('email');
    expect(secret.type).toBe('password');
    expect(secret.required).toBe(true);
    expect(secret.minLength).toBe(8);
    expect(secret.autocomplete).toBe('current-password');
    expect(screen.getByRole('tab', { name: 'Login' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.setup().click(screen.getByRole('switch', { name: 'Use light appearance' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(screen.getByRole('switch').classList.contains('auth-theme-toggle')).toBe(true);
  });

  test.each([
    ['', password],
    ['invalid-email', password],
    ['member@example.test', 'short'],
  ])('native email/required and password length validation reject %s', async (email, secret) => {
    const { posts } = mount();
    fireEvent.submit(await fill(email, secret));
    expect(posts().length).toBe(0);
  });

  test('submits exact public JSON, persists only feely_token and loads real shared account/capabilities before redirect', async () => {
    const { posts, fetch, token, controller, router } = mount({
      entry: '/login?api_base=http%3A%2F%2F127.0.0.1%3A8000%2Fapi%2Fv1',
    });
    fireEvent.submit(await fill('  member@example.test  ', ' Password 123 '));
    await screen.findByText('member@example.test');
    expect(router.state.location.pathname).toBe('/chat');
    expect(router.state.location.search).toContain('api_base=');
    expect(posts().length).toBe(1);
    const options = posts()[0][1]!;
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      email_or_username: 'member@example.test',
      password: ' Password 123 ',
    });
    expect(new Headers(options.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect(options.credentials).toBeUndefined();
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      account,
      subscription: { my_map_access: true, journal_access: true },
      termsRequired: false,
    });
    for (const path of ['/users/me/account', '/billing/subscription', '/terms/me']) {
      const calls = fetch.mock.calls.filter((call) => String(call[0]).endsWith(path));
      expect(calls.length).toBe(1);
      expect(new Headers(calls[0][1]?.headers).get('Authorization')).toBe(`Bearer ${token}`);
    }
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  test('pending submit is disabled and repeated submit events cannot duplicate the login request', async () => {
    const response = deferred<Response>();
    const { posts, token } = mount({ overrides: { '/auth/login': () => response.promise } });
    const form = await fill();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(
      (screen.getByRole('button', { name: 'Logging in...' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(posts().length).toBe(1);
    await act(() => response.resolve(json({ access_token: token, token_type: 'bearer' })));
    await screen.findByText('member@example.test');
  });

  test.each([
    [401, 'Incorrect email, username, or password'],
    [401, 'Incorrect email, username, or password'], // Disabled users deliberately have the same backend response.
    [503, 'Sign-in temporarily unavailable'],
    [422, 'String should have at least 8 characters'],
  ])(
    'keeps local fields after %s failure, creates no session and shows authoritative detail',
    async (status, detail) => {
      const { posts, controller, router } = mount({
        overrides: {
          '/auth/login': () =>
            json({ detail: status === 422 ? [{ msg: detail }] : detail }, status),
        },
      });
      fireEvent.submit(await fill());
      await screen.findByText(detail);
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(
        'member@example.test',
      );
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(password);
      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
      expect(controller.getSnapshot().session.status).toBe('unauthenticated');
      expect(router.state.location.pathname).toBe('/login');
      expect(posts().length).toBe(1);
      expect(router.state.location.search).toBe('');
    },
  );

  test('unverified login displays the 403 detail and links to React activation', async () => {
    mount({
      overrides: {
        '/auth/login': () => json({ detail: 'Please verify your email before logging in.' }, 403),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Please verify your email before logging in.');
    expect(
      screen.getByText('Enter your PIN or request a new one to activate your account.'),
    ).toBeDefined();
    expect(
      new URL(
        (
          screen.getByRole('link', {
            name: 'Activate account / enter email PIN',
          }) as HTMLAnchorElement
        ).href,
      ).pathname,
    ).toBe('/activate');
    expect(screen.queryByLabelText('PIN')).toBeNull();
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('public verification config controls the original activation entry', async () => {
    mount({ overrides: { '/auth/email/config': () => json({ verification_enabled: true }) } });
    await screen.findByRole('link', { name: 'Activate account / enter email PIN' });
  });

  test.each([
    null,
    {},
    { access_token: '', token_type: 'bearer' },
    { access_token: jwt(), token_type: 'admin' },
  ])('rejects malformed login responses without storing a token', async (payload) => {
    const { posts } = mount({ overrides: { '/auth/login': () => json(payload) } });
    fireEvent.submit(await fill());
    await screen.findByText('FeelY returned an invalid sign-in response. Please try again.');
    expect(posts().length).toBe(1);
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.test');
  });

  test('network failure does not replay credentials or persist them', async () => {
    const { posts } = mount({
      overrides: { '/auth/login': () => Promise.reject(new TypeError('Offline')) },
    });
    fireEvent.submit(await fill());
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(posts().length).toBe(1);
    expect(localStorage.length).toBe(0);
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(password);
  });

  test('keeps the legacy 1200 ms cooldown after a failed attempt and supports a later manual retry', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(2000);
    let fail = true;
    const { posts } = mount({
      overrides: {
        '/auth/login': () =>
          fail
            ? json({ detail: 'Wrong credentials' }, 401)
            : json({ access_token: jwt(), token_type: 'bearer' }),
      },
    });
    const form = await fill();
    fireEvent.submit(form);
    await screen.findByText('Wrong credentials');
    fireEvent.submit(form);
    await screen.findByText('Please wait a moment before trying again.');
    expect(posts().length).toBe(1);
    time.mockReturnValue(3300);
    fail = false;
    fireEvent.submit(form);
    await screen.findByText('member@example.test');
    expect(posts().length).toBe(2);
  });

  test('failed initial account load retains the valid JWT, clears password and retries through the existing controller', async () => {
    let fail = true;
    const { token, posts, controller, router } = mount({
      entry: '/account',
      overrides: {
        '/users/me/account': () =>
          fail ? json({ detail: 'Account load failed' }, 503) : json(account),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Account load failed');
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(controller.getSnapshot().session.status).toBe('error');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.test');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
    expect((screen.getByRole('button', { name: 'Login' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry session' }));
    await screen.findByLabelText('Display name');
    expect(router.state.location.pathname).toBe('/account');
    expect(posts().length).toBe(1);
  });

  test.each(['malformed-token', jwt(Date.now() / 1000 - 10)])(
    'uses the existing invalid/expired JWT lifecycle after login',
    async (token) => {
      const { fetch, router, controller } = mount({
        overrides: { '/auth/login': () => json({ access_token: token, token_type: 'bearer' }) },
      });
      fireEvent.submit(await fill());
      await screen.findByText('Your session has ended. Please sign in again.');
      expect(localStorage.getItem('feely_token')).toBeNull();
      expect(controller.getSnapshot().session.status).toBe('unauthenticated');
      expect(router.state.location.pathname).toBe('/login');
      expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/users/me/account'))).toBe(
        false,
      );
    },
  );

  test('authenticated post-login 401 clears the JWT and stays on login without redirecting to protected content', async () => {
    const { controller } = mount({
      overrides: {
        '/users/me/account': () => json({ detail: 'Could not validate credentials' }, 401),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Your session has ended. Please sign in again.');
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  test.each(['/account', '/feedback'])(
    'unauthenticated %s returns to the real feature after login and can use it',
    async (path) => {
      const { router, fetch } = mount({
        entry: path,
        overrides: { '/feedback': () => json({ id: 4, detail: 'Feedback saved' }, 201) },
      });
      const form = await fill();
      expect(router.state.location.pathname).toBe('/login');
      expect(router.state.location.state.afterLogin).toBe(path);
      fireEvent.submit(form);
      if (path === '/account') await screen.findByLabelText('Display name');
      else {
        const message = await screen.findByLabelText('Your feedback');
        fireEvent.change(message, { target: { value: 'Feedback after real sign-in' } });
        await userEvent.setup().click(screen.getByRole('button', { name: 'Send feedback' }));
        await screen.findByText('Feedback saved');
        expect(
          fetch.mock.calls.some(
            (call) => String(call[0]).endsWith('/feedback') && call[1]?.method === 'POST',
          ),
        ).toBe(true);
      }
      expect(router.state.location.pathname).toBe(path);
    },
  );

  test.each(['/account', '/feedback'])(
    'login to %s checks Terms first, acceptance returns to feature without a loop',
    async (path) => {
      let accepted = false;
      const { router } = mount({
        entry: path,
        overrides: {
          '/terms/me': () =>
            json({ current: published, accepted_current: accepted, acceptances: [] }),
          '/terms/accept': () => {
            accepted = true;
            return json({
              version: published.version,
              document_sha256: published.document_sha256,
              document_url: published.document_url,
              client: 'web',
              accepted_at: '2026-10-11T00:00:00Z',
            });
          },
        },
      });
      fireEvent.submit(await fill());
      await screen.findByRole('checkbox');
      await act(async () => {}); // Finish the Terms page's explicit fresh-entry session read.
      const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
      expect(router.state.location.pathname).toBe('/terms');
      expect(router.state.location.state.afterTerms).toBe(path);
      expect(screen.queryByRole('form', { name: 'Login' })).toBeNull();
      await userEvent.setup().click(checkbox);
      expect(checkbox.checked).toBe(true);
      await userEvent
        .setup()
        .click(
          within(checkbox.closest('form')!).getByRole('button', { name: 'Accept and continue' }),
        );
      if (path === '/account') await screen.findByLabelText('Display name');
      else await screen.findByLabelText('Your feedback');
      expect(router.state.location.pathname).toBe(path);
      await act(() => router.navigate('/login'));
      await waitFor(() => expect(router.state.location.pathname).toBe('/chat'));
    },
  );

  test.each([false, true])(
    'authenticated login visit redirects, honoring Terms requirement %s',
    async (required) => {
      const { router, posts } = mount({
        stored: jwt(),
        overrides: {
          '/terms/me': () => json({ ...terms, current: published, accepted_current: !required }),
        },
      });
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(required ? '/terms' : '/chat'),
      );
      if (required) await screen.findByRole('checkbox');
      else await screen.findByText('member@example.test');
      expect(posts().length).toBe(0);
    },
  );

  test('public Terms -> React login -> required review does not return to login or loop', async () => {
    const { router } = mount({
      entry: '/terms',
      overrides: {
        '/terms/config': () => json(published),
        '/terms/me': () => json({ ...terms, current: published }),
      },
    });
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Sign in' }));
    fireEvent.submit(await fill());
    await screen.findByRole('checkbox');
    expect(router.state.location.pathname).toBe('/terms');
    expect(router.state.location.state.afterTerms).toBe('/chat');
  });

  test.each(['https://example.com/steal', '/login', '/terms', '/unknown', '//account'])(
    'rejects arbitrary/looping redirect destination %s',
    async (destination) => {
      const { router } = mount({
        entry: {
          pathname: '/login',
          search: '?view=journal&api_base=custom',
          state: { afterLogin: destination },
        },
      });
      fireEvent.submit(await fill());
      await screen.findByText('member@example.test');
      expect(router.state.location.pathname).toBe('/chat');
      expect(router.state.location.search).toBe('?api_base=custom');
    },
  );

  test('legacy view=map login lands on map, Register uses React and recovery carries public API configuration', async () => {
    const { router } = mount({ entry: '/login?view=map&api_base=custom' });
    const form = await fill();
    const registration = screen.getByRole('tab', { name: 'Register' }) as HTMLAnchorElement;
    expect(new URL(registration.href).pathname).toBe('/register');
    expect(registration.target).toBe('');
    expect(new URL(registration.href).searchParams.get('api_base')).toBe('custom');
    expect(
      new URL(
        (screen.getByRole('link', { name: 'Forgot your password?' }) as HTMLAnchorElement).href,
      ).pathname,
    ).toBe('/forgot-password');
    fireEvent.submit(form);
    await screen.findByText('member@example.test');
    expect(router.state.location.pathname).toBe('/map');
    expect(router.state.location.search).toBe('?api_base=custom');
  });

  test('unmounted/aborted login responses cannot persist a token or navigate over another page', async () => {
    const response = deferred<Response>();
    const { router, token, controller } = mount({
      overrides: { '/auth/login': () => response.promise },
    });
    fireEvent.submit(await fill());
    await act(() => router.navigate('/terms'));
    await act(() => response.resolve(json({ access_token: token, token_type: 'bearer' })));
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(router.state.location.pathname).toBe('/terms');
  });

  test('late login cannot replace a session changed while the request was in flight', async () => {
    const response = deferred<Response>();
    const { token, controller } = mount({ overrides: { '/auth/login': () => response.promise } });
    fireEvent.submit(await fill());
    await act(() => controller.signOut());
    await act(() => response.resolve(json({ access_token: token, token_type: 'bearer' })));
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
  });

  test('blocked local storage reports a safe error without creating an in-memory-only session', async () => {
    const { controller } = mount();
    const form = await fill();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked');
    });
    fireEvent.submit(form);
    await screen.findByText(
      'FeelY could not save your session. Please allow local storage and try again.',
    );
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });
});
