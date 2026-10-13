import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import type { TurnstileOptions } from '../features/auth/registration/types';
import { account, deferred, json, jwt, mockBackend, terms } from './backend';

const published = {
  configured: true,
  enforced: true,
  version: 'test-registration-v1',
  document_url: 'https://example.com/terms.pdf',
  document_sha256: 'a'.repeat(64),
};
const protectedCaptcha = {
  enabled: true,
  provider: 'turnstile',
  site_key: 'public-site-key',
  action: 'register',
};
const registered = {
  ...account,
  email: 'new@example.com',
  username: 'new_user',
  is_email_verified: false,
};
const secret = 'Registration password 123';

function provider() {
  const render = vi.fn(
    (_container: HTMLElement, _options: TurnstileOptions): string =>
      `widget-${render.mock.calls.length}`,
  );
  const api = { render, reset: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('turnstile', api);
  return { ...api, options: () => render.mock.calls.at(-1)![1] };
}
function mount(
  options: {
    entry?: string;
    stored?: string;
    captcha?: boolean;
    published?: boolean;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.stored) localStorage.setItem('feely_token', options.stored);
  const challenge = provider();
  const token = jwt();
  const fetch = mockBackend({
    '/auth/captcha/config': () =>
      json(
        options.captcha === false
          ? { enabled: false, provider: null, site_key: null, action: null }
          : protectedCaptcha,
      ),
    '/terms/config': () => json(options.published === false ? terms.current : published),
    '/auth/register': () => json(registered, 201),
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
    { initialEntries: [options.entry ?? '/register'] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  const posts = () => fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/register'));
  return { ...view, fetch, token, controller, router, posts, challenge };
}
async function fill(email = 'new@example.com', username = 'new_user', password = secret) {
  const form = await screen.findByRole('form', { name: 'Register' });
  await waitFor(() =>
    expect(
      (within(form).getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  return form;
}
function consent() {
  fireEvent.click(screen.getByRole('checkbox'));
}
async function solved(challenge: ReturnType<typeof provider>) {
  await act(() => challenge.options().callback('challenge-token'));
}

describe('React new-user registration', () => {
  test('renders original fields, honeypot, consent and flexible CAPTCHA with no invented confirmation/display/newsletter fields', async () => {
    const { challenge } = mount();
    await fill();
    expect(screen.getByRole('heading', { name: 'Create your private space' })).toBeDefined();
    expect(screen.getByLabelText('Username').getAttribute('minlength')).toBe('3');
    expect(screen.getByLabelText('Password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('8');
    expect(screen.getByLabelText('Website').getAttribute('tabindex')).toBe('-1');
    expect(screen.queryByLabelText(/confirm password/i)).toBeNull();
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(screen.queryByText(/newsletter/i)).toBeNull();
    expect(screen.queryByRole('link', { name: 'Forgot your password?' })).toBeNull();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.required).toBe(true);
    expect(
      screen.getByText(
        `Unfinished test terms (${published.version}). You will need to accept the finished release terms separately.`,
      ),
    ).toBeDefined();
    expect((within(checkbox.closest('label')!).getByRole('link') as HTMLAnchorElement).href).toBe(
      published.document_url,
    );
    expect(challenge.options()).toMatchObject({
      sitekey: 'public-site-key',
      action: 'register',
      size: 'flexible',
    });
  });

  test.each([
    ['', 'new_user', secret],
    ['invalid', 'new_user', secret],
    ['new@example.com', 'ab', secret],
    ['new@example.com', 'new_user', 'short'],
  ])('client validation rejects invalid form fields %s/%s', async (email, username, password) => {
    const { posts, challenge } = mount();
    const form = await fill(email, username, password);
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    expect(posts().length).toBe(0);
  });

  test('requires explicit consent and challenge token, resetting verification after a failed attempt', async () => {
    const { posts, challenge } = mount();
    const form = await fill();
    await solved(challenge);
    fireEvent.submit(form);
    expect(posts().length).toBe(0);
    consent();
    act(() => challenge.options()['expired-callback']());
    fireEvent.submit(form);
    await screen.findByText('Please complete the verification before creating an account.');
    expect(posts().length).toBe(0);
    await waitFor(() => expect(challenge.reset).toHaveBeenCalled());
  });

  test('sends exact payload/consent/challenge and preserves unverified activation handoff without token/login/verification calls', async () => {
    const { posts, challenge, controller, router, fetch } = mount({
      entry: '/register?api_base=custom',
    });
    const form = await fill('  new@example.com  ', '  new_user  ', ' Password 123 ');
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('We sent your activation PIN. Check your inbox and spam folder.');
    expect(posts().length).toBe(1);
    const options = posts()[0][1]!;
    expect(options.method).toBe('POST');
    expect(options.credentials).toBeUndefined();
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect(JSON.parse(String(options.body))).toEqual({
      email: 'new@example.com',
      username: 'new_user',
      password: ' Password 123 ',
      website: '',
      captcha_token: 'challenge-token',
      terms_accepted: true,
      terms_version: published.version,
      terms_document_sha256: published.document_sha256,
    });
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/terms/config')).length,
    ).toBeGreaterThanOrEqual(2);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('new@example.com');
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(
      fetch.mock.calls.some((call) => /auth\/(login|email-verification)/.test(String(call[0]))),
    ).toBe(false);
    expect(router.state.location.search).toBe('?api_base=custom');
    expect(router.state.location.state).toEqual({
      email: 'new@example.com',
      notice: 'registered',
      afterLogin: '/chat',
      workspace: 'chat',
    });
    expect(new URLSearchParams(router.state.location.search).has('email')).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(router.state.location.pathname).toBe('/activate');
    await userEvent.setup().click(screen.getByRole('link', { name: 'Close' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
  });

  test('unpublished Terms and disabled CAPTCHA omit consent fields and send null challenge', async () => {
    const { posts, challenge } = mount({ published: false, captcha: false });
    const form = await fill();
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.required).toBe(false);
    expect(challenge.render).not.toHaveBeenCalled();
    expect(
      screen.getByText('Terms are still being prepared. No acceptance is recorded for the draft.'),
    ).toBeDefined();
    fireEvent.submit(form);
    await screen.findByText('We sent your activation PIN. Check your inbox and spam folder.');
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      email: 'new@example.com',
      username: 'new_user',
      password: secret,
      website: '',
      captcha_token: null,
    });
  });

  test.each(['version', 'document_sha256'])(
    'fresh changed Terms %s clears consent and prevents registering against old consent',
    async (field) => {
      let current = published;
      const { posts, challenge } = mount({ overrides: { '/terms/config': () => json(current) } });
      const form = await fill();
      consent();
      await solved(challenge);
      current = { ...published, [field]: field === 'version' ? 'release-v2' : 'b'.repeat(64) };
      fireEvent.submit(form);
      await screen.findByText('Please read and accept the FeelY terms before creating an account.');
      expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
      expect(posts().length).toBe(0);
      await waitFor(() => expect(challenge.reset).toHaveBeenCalled());
    },
  );

  test('pending registration disables Create account and duplicate submit events make only one request', async () => {
    const response = deferred<Response>();
    const { posts, challenge } = mount({ overrides: { '/auth/register': () => response.promise } });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(posts().length).toBe(1));
    expect(
      (screen.getByRole('button', { name: 'Creating account...' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(form.getAttribute('aria-busy')).toBe('true');
    await act(() => response.resolve(json(registered, 201)));
    await screen.findByText('We sent your activation PIN. Check your inbox and spam folder.');
  });

  test.each([
    [409, 'A user with this email or username already exists', 'duplicate email'],
    [409, 'A user with this email or username already exists', 'duplicate username'],
    [422, 'String should have at most 128 characters', 'invalid password'],
    [422, 'String should match pattern', 'invalid username'],
    [400, 'Verification failed. Please try again.', 'invalid/expired CAPTCHA'],
    [
      422,
      'Please explicitly accept the FeelY terms before creating an account.',
      'invalid consent',
    ],
    [
      409,
      'The terms changed. Read the current version and check the acceptance box again.',
      'consent conflict',
    ],
    [503, 'Registration temporarily unavailable', 'backend failure'],
  ])(
    'preserves fields, shows backend %s and resets challenge on %s (%s)',
    async (status, detail) => {
      const { challenge, posts } = mount({
        overrides: {
          '/auth/register': () =>
            json({ detail: detail.startsWith('String') ? [{ msg: detail }] : detail }, status),
        },
      });
      const form = await fill();
      consent();
      await solved(challenge);
      fireEvent.submit(form);
      await screen.findByText(detail);
      expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('new@example.com');
      expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('new_user');
      expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(secret);
      expect(localStorage.getItem('feely_token')).toBeNull();
      expect(posts().length).toBe(1);
      await waitFor(() => expect(challenge.reset).toHaveBeenCalled());
    },
  );

  test('CAPTCHA expiration during Terms preflight prevents sending the expired challenge', async () => {
    let pause = false;
    const refresh = deferred<Response>();
    const { posts, challenge } = mount({
      overrides: { '/terms/config': () => (pause ? refresh.promise : json(published)) },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    pause = true;
    fireEvent.submit(form);
    act(() => challenge.options()['expired-callback']());
    await act(() => refresh.resolve(json(published)));
    await screen.findByText('Please complete the verification before creating an account.');
    expect(posts().length).toBe(0);
  });

  test('network error never replays registration and retains inputs', async () => {
    const { posts, challenge } = mount({
      overrides: { '/auth/register': () => Promise.reject(new TypeError('Offline')) },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(posts().length).toBe(1);
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe(secret);
    await waitFor(() => expect(challenge.reset).toHaveBeenCalled());
  });

  test('malformed registration response neither logs in nor stores a token', async () => {
    const { challenge, fetch } = mount({
      overrides: { '/auth/register': () => json({ access_token: jwt() }, 201) },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText(
      'FeelY returned an invalid registration response. Please check whether your account was created before trying again.',
    );
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/auth/login'))).toBe(false);
  });

  test('configuration failure is retryable and never falls back to unprotected registration', async () => {
    let fail = true;
    const { posts } = mount({
      overrides: {
        '/auth/captcha/config': () =>
          fail ? json({ detail: 'Config unavailable' }, 503) : json(protectedCaptcha),
      },
    });
    await screen.findByText('Config unavailable');
    expect(
      (screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.submit(screen.getByRole('form', { name: 'Register' }));
    expect(posts().length).toBe(0);
    fail = false;
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry registration configuration' }));
    await fill();
  });

  test('failed fresh Terms read does not submit or silently drop consent', async () => {
    let fail = false;
    const { posts, challenge } = mount({
      overrides: {
        '/terms/config': () =>
          fail ? json({ detail: 'Terms unavailable' }, 503) : json(published),
      },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fail = true;
    fireEvent.submit(form);
    await screen.findByText('Terms unavailable');
    expect(posts().length).toBe(0);
    await waitFor(() => expect(challenge.reset).toHaveBeenCalled());
  });

  test('verification-disabled registration performs legacy login through the real existing session infrastructure', async () => {
    const { challenge, token, controller, router, fetch } = mount({
      overrides: { '/auth/register': () => json({ ...registered, is_email_verified: true }, 201) },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('member@example.test');
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    expect(router.state.location.pathname).toBe('/chat');
    const calls = fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/login'));
    expect(calls.length).toBe(1);
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      email_or_username: 'new@example.com',
      password: secret,
    });
  });

  test('verified registration respects the existing post-login Terms gate when the publication changes', async () => {
    const { challenge, router } = mount({
      overrides: {
        '/auth/register': () => json({ ...registered, is_email_verified: true }, 201),
        '/terms/me': () => json({ ...terms, current: published, accepted_current: false }),
      },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByRole('checkbox', {
      name: 'I accept this version of the FeelY terms of use (AGB).',
    });
    expect(router.state.location.pathname).toBe('/terms');
  });

  test('login failure after account creation shows created-account/Login handoff instead of allowing registration replay', async () => {
    const { challenge, posts } = mount({
      overrides: {
        '/auth/register': () => json({ ...registered, is_email_verified: true }, 201),
        '/auth/login': () => json({ detail: 'Login temporarily unavailable' }, 503),
      },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('Login temporarily unavailable');
    expect(screen.getByText('Your account was created. You can now log in.')).toBeDefined();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    expect(posts().length).toBe(1);
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('activation-delivery 502 exposes the real resend/PIN reference entry without auto-replay', async () => {
    const { posts, challenge } = mount({
      overrides: {
        '/auth/register': () =>
          json(
            {
              detail:
                'Your account was created, but the activation email could not be sent. Use Activate account to request a new PIN.',
            },
            502,
          ),
      },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByRole('link', { name: 'Activate account / enter email PIN' });
    expect(posts().length).toBe(1);
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('Login -> Register -> Login uses React routes without a loop', async () => {
    const { router } = mount({ entry: '/login' });
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'Register' }));
    await fill();
    expect(router.state.location.pathname).toBe('/register');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'Login' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.pathname).toBe('/login');
  });

  test.each([false, true])(
    'authenticated Register visit reuses existing destination/Terms policy (required %s)',
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
      expect(posts().length).toBe(0);
      expect(screen.queryByRole('form', { name: 'Register' })).toBeNull();
    },
  );

  test('legacy mode=register entry maps to React while preserving API/view hints', async () => {
    const { router } = mount({ entry: '/?mode=register&view=map&api_base=custom' });
    await fill();
    expect(router.state.location.pathname).toBe('/register');
    expect(router.state.location.search).toBe('?view=map&api_base=custom');
  });

  test('1200 ms failed-attempt cooldown is preserved and retry requires a fresh challenge', async () => {
    const time = vi.spyOn(Date, 'now').mockReturnValue(2000);
    let fail = true;
    const { posts, challenge } = mount({
      overrides: {
        '/auth/register': () =>
          fail ? json({ detail: 'Temporary failure' }, 503) : json(registered, 201),
      },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('Temporary failure');
    fireEvent.submit(form);
    await screen.findByText('Please wait a moment before trying again.');
    expect(posts().length).toBe(1);
    time.mockReturnValue(3300);
    fail = false;
    await solved(challenge);
    fireEvent.submit(form);
    await screen.findByText('We sent your activation PIN. Check your inbox and spam folder.');
    expect(posts().length).toBe(2);
  });

  test('unmount/stale responses cannot start login or store a token after leaving Register', async () => {
    const response = deferred<Response>();
    const { challenge, router, posts, fetch } = mount({
      overrides: { '/auth/register': () => response.promise },
    });
    const form = await fill();
    consent();
    await solved(challenge);
    fireEvent.submit(form);
    await waitFor(() => expect(posts().length).toBe(1));
    await act(() => router.navigate('/login'));
    await act(() => response.resolve(json({ ...registered, is_email_verified: true }, 201)));
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/auth/login'))).toBe(false);
  });
});
