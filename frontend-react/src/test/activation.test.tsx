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

const genericResend = 'If that account exists and needs verification, an email has been sent.';
const invalidPin = 'Verification code or link is invalid or expired. Request a new code.';
const published = {
  configured: true,
  enforced: true,
  version: 'activation-v1',
  document_url: 'https://example.com/terms.pdf',
  document_sha256: 'a'.repeat(64),
};

function mount(
  options: {
    entry?: string | { pathname: string; search?: string; state?: unknown };
    stored?: string;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.stored) localStorage.setItem('feely_token', options.stored);
  const fetch = mockBackend({
    '/auth/email-verification/confirm': () => json({ verified: true, detail: 'Email verified.' }),
    '/auth/email-verification/request': () => json({ sent: true, detail: genericResend }),
    '/auth/login': () => json({ access_token: jwt(), token_type: 'bearer' }),
    '/auth/email/config': () => json({ verification_enabled: true }),
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
    { initialEntries: [options.entry ?? '/activate'] },
  );
  const view = render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  const confirms = () =>
    fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/email-verification/confirm'));
  const resends = () =>
    fetch.mock.calls.filter((call) => String(call[0]).endsWith('/auth/email-verification/request'));
  return { ...view, fetch, controller, router, confirms, resends };
}
async function fill(email = 'new@example.com', pin = '001234') {
  const form = await screen.findByRole('form', { name: 'Activate your account' });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Activate account' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Activation PIN'), { target: { value: pin } });
  return form;
}

describe('React email activation and resend', () => {
  test('direct route preserves original copy, email/single PIN validation, IDs, classes and keyboard focus', async () => {
    mount();
    await screen.findByRole('form', { name: 'Activate your account' });
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const pin = screen.getByLabelText('Activation PIN') as HTMLInputElement;
    expect(email.type).toBe('email');
    expect(email.required).toBe(true);
    expect(email.autocomplete).toBe('email');
    expect(document.activeElement).toBe(email);
    expect(pin.type).toBe('text');
    expect(pin.inputMode).toBe('numeric');
    expect(pin.autocomplete).toBe('one-time-code');
    expect(pin.pattern).toBe('[0-9]{6}');
    expect(pin.minLength).toBe(6);
    expect(pin.maxLength).toBe(6);
    expect(pin.required).toBe(true);
    expect(pin.closest('section')!.id).toBe('email-verification-dialog');
    expect(pin.closest('.auth-panel')!.getAttribute('aria-labelledby')).toBe('activation-heading');
    expect(
      screen.getByText(
        'Enter the six-digit PIN from your FeelY email. You only need to activate your email once.',
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  test('prefills only email/fixed notice from Router state, focuses PIN and ignores arbitrary secret/message fields', async () => {
    const { router } = mount({
      entry: {
        pathname: '/activate',
        state: {
          email: 'new@example.com',
          notice: 'registered',
          password: 'never-copy',
          pin: '999999',
          message: 'Untrusted message',
        },
      },
    });
    await fill();
    expect(document.activeElement).toBe(screen.getByLabelText('Activation PIN'));
    expect(
      screen.getByText('We sent your activation PIN. Check your inbox and spam folder.'),
    ).toBeDefined();
    expect(screen.queryByText('Untrusted message')).toBeNull();
    await userEvent.setup().click(screen.getByRole('link', { name: 'Close' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(router.state.location.state).toEqual({
      email: 'new@example.com',
      afterLogin: '/chat',
      workspace: 'chat',
    });
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  test('ordinary typing/paste/backspace preserve single-field behavior and leading zeroes without filtering', async () => {
    mount();
    await fill();
    const input = screen.getByLabelText('Activation PIN') as HTMLInputElement;
    const user = userEvent.setup();
    await user.clear(input);
    await user.click(input);
    await user.paste('001234');
    expect(input.value).toBe('001234');
    await user.keyboard('{Backspace}');
    expect(input.value).toBe('00123');
    await user.clear(input);
    await user.type(input, 'ab1234');
    expect(input.value).toBe('ab1234');
    expect(input.checkValidity()).toBe(false);
    await user.type(input, '7');
    expect(input.value.length).toBe(6);
  });

  test.each([
    ['', '001234'],
    ['not-an-email', '001234'],
    ['new@example.com', ''],
    ['new@example.com', '12345'],
    ['new@example.com', '1234567'],
    ['new@example.com', 'ab1234'],
  ])('client validation rejects email/PIN %s/%s without a request', async (email, pin) => {
    const { confirms } = mount();
    fireEvent.submit(await fill(email, pin));
    expect(confirms().length).toBe(0);
  });

  test('activation sends exact public JSON, grants no token and returns to Login with only email/fixed success/destination', async () => {
    const { confirms, fetch, controller, router } = mount({
      entry: {
        pathname: '/activate',
        search: '?api_base=custom',
        state: { afterLogin: '/feedback', workspace: 'map' },
      },
    });
    fireEvent.submit(await fill('  New@Example.COM  ', '001234'));
    await screen.findByText('Email activated. You can now log in.');
    const options = confirms()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({ email: 'New@Example.COM', pin: '001234' });
    expect(options.method).toBe('POST');
    expect(options.credentials).toBeUndefined();
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toBe('?api_base=custom');
    expect(router.state.location.state).toEqual({
      email: 'New@Example.COM',
      notice: 'activated',
      afterLogin: '/feedback',
      workspace: 'map',
    });
    expect(((await screen.findByLabelText('Email')) as HTMLInputElement).value).toBe(
      'New@Example.COM',
    );
    expect(document.activeElement).toBe(screen.getByLabelText('Password'));
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/auth/login'))).toBe(false);
  });

  test('pending confirm disables both mutations and repeated submit/resend events make only one POST', async () => {
    const response = deferred<Response>();
    const { confirms, resends } = mount({
      overrides: { '/auth/email-verification/confirm': () => response.promise },
    });
    const form = await fill();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole('button', { name: 'Send a new PIN' }));
    expect(screen.getByText('Activating...', { selector: '#verification-status' })).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Activating...' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(confirms().length).toBe(1);
    expect(resends().length).toBe(0);
    await act(() => response.resolve(json({ verified: true, detail: 'Email verified.' })));
    await screen.findByText('Email activated. You can now log in.');
  });

  test.each([
    'invalid',
    'expired',
    'unknown email',
    'already verified',
    'disabled account',
    'attempts exhausted',
  ])('backend %s remains generic and retains the entered fields', async () => {
    const { confirms, controller } = mount({
      overrides: { '/auth/email-verification/confirm': () => json({ detail: invalidPin }, 400) },
    });
    fireEvent.submit(await fill());
    await screen.findByText(invalidPin);
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('new@example.com');
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('001234');
    expect(confirms().length).toBe(1);
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
  });

  test.each([
    [422, [{ msg: 'Enter your email and six-digit PIN.' }]],
    [503, 'Activation temporarily unavailable'],
  ])('backend activation %s uses the existing error parser', async (status, detail) => {
    mount({ overrides: { '/auth/email-verification/confirm': () => json({ detail }, status) } });
    fireEvent.submit(await fill());
    await screen.findByText(Array.isArray(detail) ? detail[0].msg : detail);
  });

  test('malformed activation response never navigates or creates authentication', async () => {
    const { router, controller } = mount({
      overrides: { '/auth/email-verification/confirm': () => json({ access_token: jwt() }) },
    });
    fireEvent.submit(await fill());
    await screen.findByText(
      'FeelY returned an invalid activation response. Please check whether your email was activated before trying again.',
    );
    expect(router.state.location.pathname).toBe('/activate');
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('activation network failure keeps PIN and never replays the write', async () => {
    const { confirms } = mount({
      overrides: {
        '/auth/email-verification/confirm': () => Promise.reject(new TypeError('Offline')),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(confirms().length).toBe(1);
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('001234');
  });

  test('resend validates only email, sends its exact public payload, clears PIN and shows generic backend copy', async () => {
    const { resends } = mount();
    await fill(' New@Example.COM ', 'bad');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send a new PIN' }));
    await screen.findByText(genericResend);
    const options = resends()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({ email: 'New@Example.COM' });
    expect(new Headers(options.headers).has('Authorization')).toBe(false);
    expect(options.credentials).toBeUndefined();
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText(/account (does not|doesn't) exist/i)).toBeNull();
  });

  test.each(['', 'invalid-email'])(
    'resend refuses invalid email %s without requiring a valid PIN',
    async (email) => {
      const { resends } = mount();
      await fill(email, 'bad');
      fireEvent.click(screen.getByRole('button', { name: 'Send a new PIN' }));
      expect(resends().length).toBe(0);
    },
  );

  test('pending resend blocks repeated/cross requests; no invented countdown prevents a later backend-authoritative resend', async () => {
    const response = deferred<Response>();
    let pending = true;
    const { resends, confirms } = mount({
      overrides: {
        '/auth/email-verification/request': () =>
          pending ? response.promise : json({ sent: true, detail: genericResend }),
      },
    });
    const form = await fill();
    const button = screen.getByRole('button', { name: 'Send a new PIN' });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.submit(form);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Sending a new PIN...')).toBeDefined();
    expect(resends().length).toBe(1);
    expect(confirms().length).toBe(0);
    await act(() => response.resolve(json({ sent: true, detail: genericResend })));
    pending = false;
    await screen.findByText(genericResend);
    fireEvent.click(button);
    await waitFor(() => expect(resends().length).toBe(2));
  });

  test('disabled verification uses authoritative sent:false detail and also clears PIN', async () => {
    mount({
      overrides: {
        '/auth/email-verification/request': () =>
          json({ sent: false, detail: 'Email verification is not enabled.' }),
      },
    });
    await fill();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Send a new PIN' }));
    await screen.findByText('Email verification is not enabled.');
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('');
  });

  test.each(['confirm', 'request'])(
    '%s rate limit retains fields and uses Retry-After without a fake client timer',
    async (path) => {
      mount({
        overrides: {
          [`/auth/email-verification/${path}`]: () =>
            json({ detail: 'Too many requests.' }, 429, { 'Retry-After': '60' }),
        },
      });
      const form = await fill();
      if (path === 'confirm') fireEvent.submit(form);
      else fireEvent.click(screen.getByRole('button', { name: 'Send a new PIN' }));
      await screen.findByText('Too many requests. Try again in 60 seconds.');
      expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('001234');
      expect(
        (screen.getByRole('button', { name: 'Send a new PIN' }) as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  test('resend network failure preserves fields and makes only one POST', async () => {
    const { resends } = mount({
      overrides: {
        '/auth/email-verification/request': () => Promise.reject(new TypeError('Offline')),
      },
    });
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new PIN' }));
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(resends().length).toBe(1);
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('001234');
  });

  test('malformed resend response does not clear the PIN', async () => {
    mount({ overrides: { '/auth/email-verification/request': () => json({ sent: true }) } });
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new PIN' }));
    await screen.findByText('FeelY returned an invalid resend response. Please try again.');
    expect((screen.getByLabelText('Activation PIN') as HTMLInputElement).value).toBe('001234');
  });

  test.each([false, true])(
    'activation -> separate Login -> Terms/app (required %s) has no loops',
    async (required) => {
      const { router, controller } = mount({
        overrides: {
          '/terms/me': () => json({ ...terms, current: published, accepted_current: !required }),
        },
      });
      fireEvent.submit(await fill());
      await screen.findByText('Email activated. You can now log in.');
      expect(controller.getSnapshot().session.status).toBe('unauthenticated');
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'Login password 123' },
      });
      await userEvent.setup().click(screen.getByRole('button', { name: 'Login' }));
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(required ? '/terms' : '/chat'),
      );
      if (required) await screen.findByRole('checkbox');
      else await screen.findByText('member@example.test');
    },
  );

  test.each([false, true])(
    'verified authenticated Activate visit returns through existing Terms/app policy (required %s)',
    async (required) => {
      const { router, confirms } = mount({
        stored: jwt(),
        overrides: {
          '/terms/me': () => json({ ...terms, current: published, accepted_current: !required }),
        },
      });
      await waitFor(() =>
        expect(router.state.location.pathname).toBe(required ? '/terms' : '/chat'),
      );
      expect(confirms().length).toBe(0);
    },
  );

  test('authenticated unverified activation refreshes the existing account/session and returns to Account with unchanged JWT', async () => {
    let verified = false;
    const token = jwt();
    const { router, controller, confirms } = mount({
      stored: token,
      entry: { pathname: '/activate', state: { email: account.email, afterLogin: '/account' } },
      overrides: {
        '/users/me/account': () => json({ ...account, is_email_verified: verified }),
        '/auth/email-verification/confirm': () => {
          verified = true;
          return json({ verified: true, detail: 'Email verified.' });
        },
      },
    });
    fireEvent.submit(await fill(account.email));
    await screen.findByText('Email verified');
    expect(router.state.location.pathname).toBe('/account');
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      account: { is_email_verified: true },
    });
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(confirms().length).toBe(1);
  });

  test('successful activation followed by failed existing-session load retries only the shared read, never the consumed PIN', async () => {
    let verified = false;
    let fail = true;
    const { controller, confirms } = mount({
      stored: jwt(),
      overrides: {
        '/users/me/account': () =>
          verified && fail
            ? json({ detail: 'Account refresh failed' }, 503)
            : json({ ...account, is_email_verified: verified }),
        '/auth/email-verification/confirm': () => {
          verified = true;
          return json({ verified: true, detail: 'Email verified.' });
        },
      },
    });
    fireEvent.submit(await fill(account.email));
    await screen.findByText('Account refresh failed');
    expect(screen.getByText('Email verified.')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Activate account' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    expect(controller.getSnapshot().session.status).toBe('error');
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry session' }));
    await screen.findByText('member@example.test');
    expect(confirms().length).toBe(1);
  });

  test('existing verification-denied session can activate publicly and recover via the unchanged session load', async () => {
    let verified = false;
    mount({
      stored: jwt(),
      overrides: {
        '/users/me/account': () =>
          verified
            ? json(account)
            : json({ detail: 'Please verify your email before logging in.' }, 403),
        '/auth/email-verification/confirm': () => {
          verified = true;
          return json({ verified: true, detail: 'Email verified.' });
        },
      },
    });
    await screen.findByText('Please verify your email before logging in.');
    fireEvent.submit(await fill());
    await screen.findByText('member@example.test');
  });

  test('a revoked existing token during post-activation refresh uses normal clearing and returns to Login', async () => {
    let activated = false;
    const { controller, router, confirms } = mount({
      stored: jwt(),
      overrides: {
        '/users/me/account': () =>
          activated
            ? json({ detail: 'Revoked' }, 401)
            : json({ ...account, is_email_verified: false }),
        '/auth/email-verification/confirm': () => {
          activated = true;
          return json({ verified: true, detail: 'Email verified.' });
        },
      },
    });
    fireEvent.submit(await fill(account.email));
    await screen.findByRole('form', { name: 'Login' });
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(router.state.location.pathname).toBe('/login');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe(account.email);
    expect(confirms().length).toBe(1);
  });

  test('unmounted activation response cannot navigate or refresh after leaving', async () => {
    const response = deferred<Response>();
    const { router } = mount({
      overrides: { '/auth/email-verification/confirm': () => response.promise },
    });
    fireEvent.submit(await fill());
    await act(() => router.navigate('/login'));
    await act(() => response.resolve(json({ verified: true, detail: 'Email verified.' })));
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByText('Email activated. You can now log in.')).toBeNull();
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('late activation cannot overwrite a session that changed during the request', async () => {
    const response = deferred<Response>();
    const { controller, router } = mount({
      overrides: { '/auth/email-verification/confirm': () => response.promise },
    });
    fireEvent.submit(await fill());
    localStorage.setItem('feely_token', jwt(undefined, '2'));
    mockBackend({
      '/users/me/account': () => json({ ...account, id: 2, email: 'other@example.test' }),
    });
    await act(() => controller.reload());
    await screen.findByText('other@example.test');
    await act(() => response.resolve(json({ verified: true, detail: 'Email verified.' })));
    expect(controller.getSnapshot().session).toMatchObject({ account: { id: 2 } });
    expect(router.state.location.pathname).toBe('/chat');
  });
});

test('old verification links remove the token and require explicit confirmation in React', async () => {
  const { router, confirms } = mount({
    entry: '/?verify_email_token=private-token&api_base=custom',
  });
  await screen.findByRole('button', { name: 'Confirm email address' });
  expect(router.state.location.pathname).toBe('/activate-link');
  expect(router.state.location.search).toBe('?api_base=custom');
  expect(confirms()).toHaveLength(0);
  for (const link of screen.getAllByRole('link'))
    expect((link as HTMLAnchorElement).href).not.toContain('private-token');
  await userEvent.setup().click(screen.getByRole('button', { name: 'Confirm email address' }));
  await screen.findByText('Email verified.');
  expect(confirms()).toHaveLength(1);
  expect(JSON.parse(String(confirms()[0][1]?.body))).toEqual({ token: 'private-token' });
  expect(screen.queryByRole('button', { name: 'Confirm email address' })).toBeNull();
});
