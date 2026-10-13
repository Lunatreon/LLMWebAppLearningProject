import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { FeedbackProvider } from '../features/feedback/FeedbackContext';
import { SessionController } from '../services/sessionController';
import type { AccountResponse } from '../types/api';
import { account, deferred, json, jwt, mockBackend, terms } from './backend';

const oldPassword = ' Current password 123 ';
const newPassword = ' New password 456 ';

function mount(
  options: {
    signedIn?: boolean;
    data?: AccountResponse;
    overrides?: Record<string, () => Response | Promise<Response>>;
  } = {},
) {
  if (options.signedIn !== false) localStorage.setItem('feely_token', jwt());
  const data = options.data ?? account;
  const fetch = mockBackend({
    '/users/me/account': () => json(data),
    '/users/me/password': () => json({ ...data, has_password: true, auth_provider: 'password' }),
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
    { initialEntries: ['/account'] },
  );
  const view = render(<RouterProvider router={router} />);
  const changes = () =>
    fetch.mock.calls.filter((call) => String(call[0]).endsWith('/users/me/password'));
  const profiles = () =>
    fetch.mock.calls.filter(
      (call) => String(call[0]).endsWith('/users/me/account') && call[1]?.method === 'PATCH',
    );
  return { ...view, fetch, controller, router, changes, profiles };
}
async function fill(current = oldPassword, next = newPassword, confirmation = next) {
  const form = await screen.findByRole('form', { name: 'Change password' });
  const currentInput = screen.queryByLabelText('Current password');
  if (currentInput) fireEvent.change(currentInput, { target: { value: current } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmation },
  });
  return form;
}

describe('authenticated Account password change', () => {
  test('renders original Security copy/grid/current requirement/new minimum and requested confirmation in its own form', async () => {
    mount();
    const form = await fill();
    expect(form.id).toBe('password-form');
    expect(form.classList.contains('account-section')).toBe(true);
    expect(
      within(form).getByText('Use at least eight characters and avoid reused passwords.'),
    ).toBeDefined();
    const current = screen.getByLabelText('Current password') as HTMLInputElement;
    expect(current.type).toBe('password');
    expect(current.required).toBe(true);
    expect(current.autocomplete).toBe('current-password');
    for (const label of ['New password', 'Confirm new password']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.type).toBe('password');
      expect(input.minLength).toBe(8);
      expect(input.autocomplete).toBe('new-password');
      expect(input.hasAttribute('maxlength')).toBe(false);
    }
    expect(screen.queryByRole('link', { name: 'Update password' })).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Update password' })
        .classList.contains('secondary-button'),
    ).toBe(true);
  });

  test.each([
    ['', newPassword, newPassword],
    [oldPassword, 'short', 'short'],
    [oldPassword, '', ''],
  ])('required/minimum input validation rejects %s/%s', async (current, next, confirmation) => {
    const { changes } = mount();
    fireEvent.submit(await fill(current, next, confirmation));
    expect(changes().length).toBe(0);
  });

  test('whitespace-only new password keeps the exact legacy blank-password error without PATCH', async () => {
    const { changes } = mount();
    fireEvent.submit(await fill(oldPassword, '        '));
    await screen.findByText('Enter a new password.');
    expect(changes().length).toBe(0);
  });

  test('requested client-only mismatch validation retains local fields and prevents PATCH', async () => {
    const { changes } = mount();
    fireEvent.submit(await fill(oldPassword, newPassword, 'different-password'));
    await screen.findByText('The passwords do not match.');
    expect(changes().length).toBe(0);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(newPassword);
  });

  test('success sends exact raw credentials/Bearer, applies full Account DTO, clears all fields and preserves token/capabilities/route', async () => {
    const normalized = { ...account, display_name: 'Persisted Member' };
    const { changes, fetch, controller, router, container } = mount({
      overrides: { '/users/me/password': () => json(normalized) },
    });
    const token = localStorage.getItem('feely_token');
    const form = await fill();
    const before = controller.getSnapshot().session;
    fireEvent.submit(form);
    await screen.findByText('Password updated.');
    expect(changes().length).toBe(1);
    const options = changes()[0][1]!;
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(String(options.body))).toEqual({
      current_password: oldPassword,
      new_password: newPassword,
    });
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(options.credentials).toBeUndefined();
    for (const label of ['Current password', 'New password', 'Confirm new password'])
      expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      account: normalized,
    });
    if (
      before.status === 'authenticated' &&
      controller.getSnapshot().session.status === 'authenticated'
    ) {
      const after = controller.getSnapshot().session;
      if (after.status === 'authenticated') {
        expect(after.subscription).toBe(before.subscription);
        expect(after.terms).toBe(before.terms);
      }
    }
    expect(router.state.location.pathname).toBe('/account');
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
    expect(JSON.stringify(router.state.location.state)).not.toContain(newPassword);
    expect(container.textContent).not.toContain(oldPassword);
    expect(container.textContent).not.toContain(newPassword);
    expect(
      fetch.mock.calls.filter((call) => String(call[0]).endsWith('/users/me/account')).length,
    ).toBe(1);
    expect(fetch.mock.calls.some((call) => String(call[0]).endsWith('/auth/login'))).toBe(false);
  });

  test('passwordless provider accounts omit current field/send null and become password accounts from response without a new JWT', async () => {
    const { changes, controller } = mount({
      data: { ...account, has_password: false, auth_provider: 'external' },
    });
    const token = localStorage.getItem('feely_token');
    const form = await fill();
    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.submit(form);
    await screen.findByText('Password updated.');
    expect(JSON.parse(String(changes()[0][1]?.body))).toEqual({
      current_password: null,
      new_password: newPassword,
    });
    expect((screen.getByLabelText('Current password') as HTMLInputElement).required).toBe(true);
    expect(controller.getSnapshot().session).toMatchObject({
      account: { has_password: true, auth_provider: 'password' },
    });
    expect(localStorage.getItem('feely_token')).toBe(token);
  });

  test('identical current/new passwords are accepted because the backend has no reuse restriction', async () => {
    const { changes } = mount();
    fireEvent.submit(await fill(oldPassword, oldPassword));
    await screen.findByText('Password updated.');
    expect(JSON.parse(String(changes()[0][1]?.body))).toEqual({
      current_password: oldPassword,
      new_password: oldPassword,
    });
  });

  test('pending mutation disables Update, shows exact status and prevents repeated submit', async () => {
    const response = deferred<Response>();
    const { changes } = mount({ overrides: { '/users/me/password': () => response.promise } });
    const form = await fill();
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(form.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByText('Updating password...')).toBeDefined();
    expect(
      (screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(changes().length).toBe(1);
    await act(() => response.resolve(json(account)));
    await screen.findByText('Password updated.');
  });

  test('incorrect-current-password 403 retains fields and authenticated session without account leakage', async () => {
    const { changes, controller, container } = mount({
      overrides: {
        '/users/me/password': () => json({ detail: 'Current password is incorrect' }, 403),
      },
    });
    const token = localStorage.getItem('feely_token');
    fireEvent.submit(await fill());
    await screen.findByText('Current password is incorrect');
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe(oldPassword);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(newPassword);
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    expect(localStorage.getItem('feely_token')).toBe(token);
    expect(changes().length).toBe(1);
    expect(container.textContent).not.toContain(oldPassword);
    expect(container.textContent).not.toContain(newPassword);
  });

  test.each([
    ['new_password', 129],
    ['current_password', 129],
  ])('backend max length for %s remains authoritative', async (field, length) => {
    const { changes, container } = mount({
      overrides: {
        '/users/me/password': () =>
          json(
            { detail: [{ msg: 'String should have at most 128 characters', input: newPassword }] },
            422,
          ),
      },
    });
    const long = 'p'.repeat(length);
    fireEvent.submit(
      await fill(
        field === 'current_password' ? long : oldPassword,
        field === 'new_password' ? long : newPassword,
      ),
    );
    await screen.findByText('String should have at most 128 characters');
    expect(JSON.parse(String(changes()[0][1]?.body))[field].length).toBe(length);
    expect(container.textContent).not.toContain(newPassword);
  });

  test('429 displays existing Retry-After semantics without erasing fields or adding a client timer', async () => {
    mount({
      overrides: {
        '/users/me/password': () =>
          json({ detail: 'Too many requests.' }, 429, { 'Retry-After': '60' }),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Too many requests. Try again in 60 seconds.');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(newPassword);
    expect(
      (screen.getByRole('button', { name: 'Update password' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  test('network failure never replays credentials and keeps only the local fields', async () => {
    const { changes } = mount({
      overrides: { '/users/me/password': () => Promise.reject(new TypeError('Offline')) },
    });
    fireEvent.submit(await fill());
    await screen.findByText('FeelY temporarily lost its connection. Please try again in a moment.');
    expect(changes().length).toBe(1);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(newPassword);
    expect(localStorage.length).toBe(1);
    expect(sessionStorage.length).toBe(0);
  });

  test('generic backend failure preserves current/new/confirmation without fake success', async () => {
    mount({
      overrides: {
        '/users/me/password': () => json({ detail: 'Password update unavailable' }, 503),
      },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Password update unavailable');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe(
      newPassword,
    );
    expect(screen.queryByText('Password updated.')).toBeNull();
  });

  test('malformed or wrong-account success cannot overwrite shared Account', async () => {
    let wrong = false;
    const { controller } = mount({
      overrides: {
        '/users/me/password': () => json(wrong ? { ...account, id: 2 } : { access_token: jwt() }),
      },
    });
    const form = await fill();
    fireEvent.submit(form);
    await screen.findByText('The FeelY backend returned an invalid password-change response.');
    wrong = true;
    fireEvent.submit(form);
    await screen.findByText('The FeelY backend returned an account for a different session.');
    expect(controller.getSnapshot().session).toMatchObject({ account: { id: 1 } });
  });

  test('authenticated 401 uses existing expiration/route guard and clears visible password state', async () => {
    const { controller, router } = mount({
      overrides: { '/users/me/password': () => json({ detail: 'Revoked' }, 401) },
    });
    fireEvent.submit(await fill());
    await screen.findByRole('form', { name: 'Login' });
    expect(localStorage.getItem('feely_token')).toBeNull();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  test('signed-out Account cannot render or submit password-change inputs', async () => {
    const { changes } = mount({ signedIn: false });
    await screen.findByRole('form', { name: 'Login' });
    expect(screen.queryByRole('form', { name: 'Change password' })).toBeNull();
    expect(changes().length).toBe(0);
  });

  test('password change stays Terms-exempt and never marks Terms accepted or changes capabilities', async () => {
    const current = {
      configured: true,
      enforced: true,
      version: 'v1',
      document_url: 'https://example.com/terms.pdf',
      document_sha256: 'a'.repeat(64),
    };
    const { controller, router } = mount({
      overrides: { '/terms/me': () => json({ ...terms, current }) },
    });
    fireEvent.submit(await fill());
    await screen.findByText('Password updated.');
    expect(controller.getSnapshot().session).toMatchObject({ termsRequired: true });
    await act(() => router.navigate('/feedback'));
    await screen.findByRole('link', { name: 'Review terms' });
    expect(screen.queryByLabelText('Your feedback')).toBeNull();
  });

  test('Profile and password writes are coordinated, and a password success preserves an unsaved profile draft', async () => {
    const response = deferred<Response>();
    const { changes, profiles } = mount({
      overrides: { '/users/me/password': () => response.promise },
    });
    fireEvent.change(await screen.findByLabelText('Display name'), {
      target: { value: 'Unsaved profile name' },
    });
    fireEvent.submit(await fill());
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    await screen.findByText(
      'A password change is already in progress. Please wait before trying again.',
    );
    expect(profiles().length).toBe(0);
    await act(() => response.resolve(json(account)));
    await screen.findByText('Password updated.');
    expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe(
      'Unsaved profile name',
    );
    expect(changes().length).toBe(1);
  });

  test('pending Profile save blocks a password PATCH without losing password fields', async () => {
    const response = deferred<Response>();
    const { fetch, changes } = mount();
    await fill();
    fetch.mockImplementationOnce(() => response.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Change password' }));
    await screen.findByText(
      'A profile save is already in progress. Please wait before trying again.',
    );
    expect(changes().length).toBe(0);
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe(newPassword);
    await act(() => response.resolve(json(account)));
    await screen.findByText('Saved.');
  });

  test('closing/reopening clears local passwords and retains in-flight duplicate protection', async () => {
    const response = deferred<Response>();
    const { router, changes } = mount({
      overrides: { '/users/me/password': () => response.promise },
    });
    fireEvent.submit(await fill());
    await act(() => router.navigate('/chat'));
    await act(() => router.navigate('/account'));
    expect(((await screen.findByLabelText('New password')) as HTMLInputElement).value).toBe('');
    fireEvent.submit(await fill());
    await screen.findByText(
      'A password change is already in progress. Please wait before trying again.',
    );
    expect(changes().length).toBe(1);
    await act(() => response.resolve(json(account)));
  });

  test('late response cannot overwrite a different authenticated account or expose old passwords', async () => {
    const response = deferred<Response>();
    const { controller } = mount({ overrides: { '/users/me/password': () => response.promise } });
    fireEvent.submit(await fill());
    localStorage.setItem('feely_token', jwt(undefined, '2'));
    mockBackend({
      '/users/me/account': () => json({ ...account, id: 2, email: 'other@example.test' }),
    });
    await act(() => controller.reload());
    await screen.findByText('other@example.test');
    await act(() => response.resolve(json(account)));
    expect(controller.getSnapshot().session).toMatchObject({ account: { id: 2 } });
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
  });
});
