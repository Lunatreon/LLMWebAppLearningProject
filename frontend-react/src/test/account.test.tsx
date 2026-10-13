import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import type { AccountResponse } from '../types/api';
import { account, deferred, json, jwt, mockBackend, subscription } from './backend';

function mount(
  options: {
    signedIn?: boolean;
    data?: AccountResponse;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const initial = options.data ?? account;
  const fetch = mockBackend({ '/users/me/account': () => json(initial), ...options.overrides });
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
    { initialEntries: ['/account'] },
  );
  render(<RouterProvider router={router} />);
  const patches = () => fetch.mock.calls.filter((call) => call[1]?.method === 'PATCH');
  return { fetch, controller, router, patches };
}

async function edit(label: string, value: string) {
  const input = (await screen.findByLabelText(label)) as HTMLInputElement;
  const user = userEvent.setup();
  await user.clear(input);
  if (value) await user.type(input, value);
  return input;
}

describe('real account/profile feature', () => {
  test('reads verified session values once and renders the original identity/fields and read-only subscription summary', async () => {
    const data = {
      ...account,
      bio: 'My biography',
      avatar_url: 'https://example.com/avatar.png',
      email_verified_at: '2026-10-11T00:00:00Z',
      last_login_at: null,
    };
    const { fetch } = mount({ data });
    expect(((await screen.findByLabelText('Display name')) as HTMLInputElement).value).toBe(
      'Member',
    );
    expect((screen.getByLabelText('Username') as HTMLInputElement).value).toBe('member');
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('member@example.test');
    expect((screen.getByLabelText('Avatar URL') as HTMLInputElement).value).toBe(data.avatar_url);
    expect((screen.getByLabelText('Bio') as HTMLTextAreaElement).value).toBe(data.bio);
    expect(screen.getByText('Email verified')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Current plan: Premium monthly' })).toBeDefined();
    expect(screen.getByText('Your Premium subscription is active.')).toBeDefined();
    const form = screen.getByLabelText('Email').closest('form')!;
    expect(within(form).getAllByRole('textbox').length).toBe(5);
    expect(form.getAttribute('data-dirty')).toBe('false');
    expect(form.querySelectorAll('[name="role"], input[type="password"]').length).toBe(0);
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/users/me/account')).length,
    ).toBe(1);
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/billing/subscription')).length,
    ).toBe(1);
  });

  test('null/empty optionals render as empty controls without an avatar image fetch', async () => {
    mount({ data: { ...account, display_name: null, avatar_url: null, bio: null } });
    expect(((await screen.findByLabelText('Display name')) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Avatar URL') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Bio') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByRole('img')).toBeNull();
  });

  test('loading hides editable data until the account response is validated', async () => {
    const response = deferred<Response>();
    mount({ overrides: { '/users/me/account': () => response.promise } });
    expect(screen.getByText('Loading your session...')).toBeDefined();
    expect(screen.queryByLabelText('Email')).toBeNull();
    await act(() => response.resolve(json(account)));
    await screen.findByLabelText('Email');
  });

  test('account load errors preserve the token and expose the existing session retry', async () => {
    let failed = true;
    mount({
      overrides: {
        '/users/me/account': () =>
          failed ? json({ detail: 'Account temporarily unavailable' }, 503) : json(account),
      },
    });
    await screen.findByText('Account temporarily unavailable');
    expect(screen.queryByLabelText('Email')).toBeNull();
    expect(localStorage.getItem('feely_token')).not.toBeNull();
    failed = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry session' }));
    await screen.findByLabelText('Email');
  });

  test('signed-out users reach React login and cannot edit or invoke sensitive actions', async () => {
    const { patches, fetch } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Delete account' })).toBeNull();
    expect(patches().length).toBe(0);
    expect(
      fetch.mock.calls.every((call) =>
        ['/feedback/config', '/auth/email/config'].some((path) => String(call[0]).endsWith(path)),
      ),
    ).toBe(true);
  });

  test('keeps native validation/lengths and prevents empty username/email or malformed URL submission', async () => {
    const { patches } = mount();
    const username = (await screen.findByLabelText('Username')) as HTMLInputElement;
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const avatar = screen.getByLabelText('Avatar URL') as HTMLInputElement;
    const bio = screen.getByLabelText('Bio') as HTMLTextAreaElement;
    expect(username.required).toBe(true);
    expect(username.minLength).toBe(3);
    expect(username.maxLength).toBe(80);
    expect((screen.getByLabelText('Display name') as HTMLInputElement).maxLength).toBe(120);
    expect(avatar.type).toBe('url');
    expect(avatar.maxLength).toBe(500);
    expect(bio.maxLength).toBe(500);
    fireEvent.change(username, { target: { value: 'ab' } });
    fireEvent.submit(username.closest('form')!);
    fireEvent.change(username, { target: { value: '' } });
    fireEvent.submit(username.closest('form')!);
    fireEvent.change(username, { target: { value: 'member' } });
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.submit(username.closest('form')!);
    fireEvent.change(email, { target: { value: 'member@example.test' } });
    fireEvent.change(avatar, { target: { value: 'not-a-url' } });
    fireEvent.submit(username.closest('form')!);
    fireEvent.change(avatar, { target: { value: '' } });
    fireEvent.change(bio, { target: { value: 'a'.repeat(501) } });
    fireEvent.submit(username.closest('form')!);
    expect(patches().length).toBe(0);
  });

  test('tracks dirty edits, sends exactly five normalized fields and uses persisted response values in form/session/sidebar', async () => {
    const normalized = {
      ...account,
      display_name: 'New Name',
      username: 'new_member',
      email: 'mixed@example.com',
      avatar_url: 'https://example.com/avatar.png',
      bio: 'New bio',
    };
    const { patches, fetch, controller } = mount({
      overrides: { '/users/me/account': () => json(normalized) },
    });
    // Use the initial existing record until the write occurs.
    fetch.mockImplementation(async (input, options) => {
      const path = String(input);
      if (path.endsWith('/users/me/account'))
        return json(options?.method === 'PATCH' ? normalized : account);
      if (path.endsWith('/billing/subscription')) return json(subscription);
      if (path.endsWith('/terms/me'))
        return json({
          current: { configured: false, enforced: false },
          accepted_current: false,
          acceptances: [],
        });
      return json({ enabled: true });
    });
    const name = await edit('Display name', '  New Name  ');
    await edit('Username', 'new_member');
    await edit('Email', 'Mixed@Example.COM');
    await edit('Avatar URL', 'https://example.com/avatar.png');
    await edit('Bio', '  New bio  ');
    const form = name.closest('form')!;
    expect(form.getAttribute('data-dirty')).toBe('true');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Saved.');
    expect(patches().length).toBe(1);
    const options = patches()[0][1]!;
    expect(JSON.parse(String(options.body))).toEqual({
      display_name: 'New Name',
      username: 'new_member',
      email: 'Mixed@Example.COM',
      avatar_url: 'https://example.com/avatar.png',
      bio: 'New bio',
    });
    expect(new Headers(options.headers).get('Authorization')).toBe(
      `Bearer ${localStorage.getItem('feely_token')}`,
    );
    expect(options.credentials).toBeUndefined();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('mixed@example.com');
    expect((screen.getByLabelText('Bio') as HTMLTextAreaElement).value).toBe('New bio');
    expect(form.getAttribute('data-dirty')).toBe('false');
    expect(controller.getSnapshot().session).toMatchObject({ account: normalized });
    expect(within(screen.getByRole('complementary')).getByText('New Name')).toBeDefined();
    expect(within(screen.getByRole('complementary')).getByText('mixed@example.com')).toBeDefined();
    expect(
      fetch.mock.calls.filter(
        (call) => String(call[0]).endsWith('/users/me/account') && call[1]?.method !== 'PATCH',
      ).length,
    ).toBe(1);
  });

  test('blank optional fields PATCH null, and saving an unchanged form stays available like legacy', async () => {
    const { patches } = mount({
      overrides: {
        '/users/me/account': () =>
          json({ ...account, display_name: null, avatar_url: null, bio: null }),
      },
    });
    await screen.findByLabelText('Email');
    const save = screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await userEvent.setup().click(save);
    await screen.findByText('Saved.');
    expect(JSON.parse(String(patches()[0][1]?.body))).toMatchObject({
      display_name: null,
      avatar_url: null,
      bio: null,
    });
    expect(save.disabled).toBe(false);
  });

  test('failed saves retain values and dirty state, display server errors, and allow retry', async () => {
    let failed = true;
    const { controller, patches, fetch } = mount();
    await screen.findByLabelText('Email');
    fetch.mockImplementation(async (_input, options) =>
      options?.method === 'PATCH'
        ? failed
          ? json({ detail: 'A user with this username already exists' }, 409)
          : json({ ...account, username: 'draft_name' })
        : json(account),
    );
    const username = await edit('Username', 'draft_name');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('A user with this username already exists');
    expect(username.value).toBe('draft_name');
    expect(username.closest('form')!.getAttribute('data-dirty')).toBe('true');
    expect(controller.getSnapshot().session).toMatchObject({ account: { username: 'member' } });
    failed = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Saved.');
    expect(username.closest('form')!.getAttribute('data-dirty')).toBe('false');
    expect(patches().length).toBe(2);
  });

  test('pending Save disables only submit, protects against repeated submissions and resets to the response', async () => {
    const response = deferred<Response>();
    const { fetch, patches } = mount();
    const name = await edit('Display name', 'One save');
    fetch.mockImplementation(async (_input, options) =>
      options?.method === 'PATCH' ? response.promise : json(account),
    );
    const user = userEvent.setup();
    const save = screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement;
    await user.click(save);
    expect(save.disabled).toBe(true);
    expect(name.disabled).toBe(false);
    expect(screen.getByText('Saving...')).toBeDefined();
    fireEvent.submit(name.closest('form')!);
    fireEvent.submit(name.closest('form')!);
    expect(patches().length).toBe(1);
    await act(() => response.resolve(json({ ...account, display_name: 'One save' })));
    expect(save.disabled).toBe(false);
    expect(name.closest('form')!.getAttribute('data-dirty')).toBe('false');
  });

  test('failed network writes are not replayed and FastAPI validation errors remain visible', async () => {
    const { fetch, patches } = mount();
    const name = await edit('Display name', 'Keep draft');
    fetch.mockRejectedValue(new TypeError('Offline'));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(patches().length).toBe(1);
    expect(name.value).toBe('Keep draft');
    fetch.mockResolvedValueOnce(json({ detail: [{ msg: 'String should match pattern' }] }, 422));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('String should match pattern');
    expect(name.value).toBe('Keep draft');
  });

  test('uses backend-returned email verification status without introducing an email/password action', async () => {
    const { fetch } = mount();
    await edit('Email', 'changed@example.com');
    fetch.mockResolvedValueOnce(
      json({
        ...account,
        email: 'changed@example.com',
        is_email_verified: false,
        email_verified_at: null,
      }),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Email not verified');
    expect(screen.getByRole('link', { name: 'Verify email' })).toBeDefined();
    expect(
      fetch.mock.calls.every((call) => !String(call[0]).includes('/auth/email-verification')),
    ).toBe(true);
  });

  test('billing/deletion links delegate to reference account, with no privileged mutation', async () => {
    const { fetch } = mount();
    await screen.findByLabelText('Email');
    const user = userEvent.setup();
    for (const name of ['Manage billing in Stripe', 'Delete account']) {
      const link = screen.getByRole('link', { name }) as HTMLAnchorElement;
      expect(new URL(link.href).pathname).toBe('/reference/');
      expect(new URL(link.href).searchParams.get('view')).toBe('account');
      expect(link.target).toBe('_blank');
      const preventNavigation = (event: Event) => event.preventDefault();
      link.addEventListener('click', preventNavigation, { once: true });
      await user.click(link);
    }
    expect(
      screen.getByText('Billing and account deletion open the reference website.'),
    ).toBeDefined();
    expect(fetch.mock.calls.every((call) => !call[1]?.method || call[1].method === 'GET')).toBe(
      true,
    );
  });

  test('account remains terms-exempt without accepting terms or unblocking Feedback', async () => {
    const { controller, router, fetch } = mount({
      overrides: {
        '/terms/me': () =>
          json({
            current: {
              configured: true,
              enforced: true,
              version: 'v1',
              document_url: 'https://example.com/terms',
              document_sha256: 'a'.repeat(64),
            },
            accepted_current: false,
            acceptances: [],
          }),
      },
    });
    await screen.findByLabelText('Email');
    expect(screen.getByRole('link', { name: 'Review terms' })).toBeDefined();
    await edit('Display name', 'Edited without accepting');
    fetch.mockResolvedValueOnce(json({ ...account, display_name: 'Edited without accepting' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('Saved.');
    expect(controller.getSnapshot().session).toMatchObject({ termsRequired: true });
    await act(() => router.navigate('/feedback'));
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
  });

  test('read-only free-test/cancellation status and period metadata match the legacy labels', async () => {
    mount({
      overrides: {
        '/billing/subscription': () =>
          json({
            ...subscription,
            free_test_phase: true,
            cancel_at_period_end: true,
            current_period_end: '2026-12-01T12:00:00Z',
          }),
      },
    });
    await screen.findByLabelText('Email');
    expect(screen.getByRole('heading', { name: 'Current plan: Now for free' })).toBeDefined();
    expect(screen.getByText('Cancellation scheduled')).toBeDefined();
    expect(screen.getByText('Premium access ends')).toBeDefined();
    expect(
      screen.getByText(
        'All features are free during the test phase. Existing subscriptions can still be managed below.',
      ),
    ).toBeDefined();
  });

  test('authenticated 401 clears visible account fields through the unchanged session lifecycle', async () => {
    const { fetch } = mount();
    await edit('Display name', 'Lost session');
    fetch.mockResolvedValueOnce(json({ detail: 'Revoked' }, 401));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByLabelText('Display name')).toBeNull();
    expect(localStorage.getItem('feely_token')).toBeNull();
  });

  test('stale PATCH responses cannot overwrite a newly loaded account', async () => {
    const response = deferred<Response>();
    const { fetch, controller } = mount();
    await edit('Display name', 'Old draft');
    fetch.mockImplementation(async (_input, options) =>
      options?.method === 'PATCH' ? response.promise : json(account),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    localStorage.setItem('feely_token', jwt(undefined, '2'));
    mockBackend({
      '/users/me/account': () => json({ ...account, id: 2, display_name: 'Second account' }),
    });
    await act(() => controller.reload());
    await act(() => response.resolve(json({ ...account, display_name: 'Old saved draft' })));
    expect(((await screen.findByLabelText('Display name')) as HTMLInputElement).value).toBe(
      'Second account',
    );
    expect(controller.getSnapshot().session).toMatchObject({
      account: { id: 2, display_name: 'Second account' },
    });
  });

  test('reopening discards unsaved fields like the legacy reopen, without a new navigation guard', async () => {
    const { router } = mount();
    await edit('Display name', 'Unsaved local name');
    await userEvent.setup().click(screen.getByRole('link', { name: 'Close' }));
    expect(router.state.location.pathname).toBe('/chat');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Account settings' }));
    expect(((await screen.findByLabelText('Display name')) as HTMLInputElement).value).toBe(
      'Member',
    );
  });

  test('closing and reopening cannot start an overlapping save or discard new dirty edits', async () => {
    const response = deferred<Response>();
    const { fetch, patches } = mount();
    await edit('Display name', 'First save');
    fetch.mockImplementation(async (_input, options) =>
      options?.method === 'PATCH' ? response.promise : json(account),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await user.click(screen.getByRole('link', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: 'Account settings' }));
    const name = await edit('Display name', 'New unsaved edit');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText(
      'A profile save is already in progress. Please wait before trying again.',
    );
    expect(patches().length).toBe(1);
    await act(() => response.resolve(json({ ...account, display_name: 'First save' })));
    expect(name.value).toBe('New unsaved edit');
    expect(within(screen.getByRole('complementary')).getByText('First save')).toBeDefined();
    expect(name.closest('form')!.getAttribute('data-dirty')).toBe('true');
  });

  test('a wrong-account PATCH response cannot enter shared session data', async () => {
    const { fetch, controller } = mount();
    await edit('Display name', 'My draft');
    fetch.mockResolvedValueOnce(json({ ...account, id: 9, display_name: 'Wrong account' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText('The FeelY backend returned an account for a different session.');
    expect(controller.getSnapshot().session).toMatchObject({
      account: { id: 1, display_name: 'Member' },
    });
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('My draft');
  });
});
