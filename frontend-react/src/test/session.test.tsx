import { StrictMode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';
import App from '../App';
import { SessionProvider } from '../context/SessionContext';
import { SessionController } from '../services/sessionController';
import { account, deferred, json, jwt, mockBackend, terms } from './backend';

describe('real session foundation', () => {
  test('represents initial loading, then validates the JWT against account/capabilities/terms endpoints', async () => {
    const token = jwt();
    localStorage.setItem('feely_token', token);
    const accountResponse = deferred<Response>();
    const fetch = mockBackend({ '/users/me/account': () => accountResponse.promise });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    expect(controller.getSnapshot().session.status).toBe('loading');
    const loading = controller.reload();
    expect(controller.getSnapshot().session.status).toBe('loading');
    accountResponse.resolve(json(account));
    await loading;
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      account,
      subscription: { my_map_access: true, journal_access: true },
    });
    expect(
      fetch.mock.calls.every(
        (call) => new Headers(call[1]?.headers).get('Authorization') === `Bearer ${token}`,
      ),
    ).toBe(true);
    controller.stop();
  });

  test('absence of a token is unauthenticated, without protected calls', async () => {
    const fetch = mockBackend();
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(fetch).not.toHaveBeenCalled();
    await controller.refreshFeedbackConfig();
    expect(controller.getSnapshot().feedback).toMatchObject({ status: 'ready', enabled: true });
    expect(new Headers(fetch.mock.calls[0][1]?.headers).has('Authorization')).toBe(false);
    controller.stop();
  });

  test.each(['malformed', jwt(Date.now() / 1000 - 1)])(
    'invalid or expired stored tokens are cleared before API calls',
    async (token) => {
      const fetch = mockBackend();
      localStorage.setItem('feely_token', token);
      const controller = new SessionController('http://127.0.0.1:8000/api/v1');
      await controller.reload();
      expect(controller.getSnapshot().session.status).toBe('unauthenticated');
      expect(localStorage.getItem('feely_token')).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
      controller.stop();
    },
  );

  test('account failure is explicit and preserves a valid token; Retry recovers', async () => {
    const token = jwt();
    localStorage.setItem('feely_token', token);
    const fetch = mockBackend({
      '/users/me/account': () => json({ detail: 'Temporarily unavailable' }, 503),
    });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'error',
      error: { status: 503, message: 'Temporarily unavailable' },
    });
    expect(localStorage.getItem('feely_token')).toBe(token);
    fetch.mockRestore();
    mockBackend();
    await controller.reload();
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    controller.stop();
  });

  test('authenticated 401 clears the token, while 403 keeps an explicit error state', async () => {
    const token = jwt();
    localStorage.setItem('feely_token', token);
    mockBackend({ '/users/me/account': () => json({ detail: 'Revoked' }, 401) });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(localStorage.getItem('feely_token')).toBeNull();
    mockBackend({ '/users/me/account': () => json({ detail: 'Verify email' }, 403) });
    localStorage.setItem('feely_token', token);
    await controller.reload();
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'error',
      error: { status: 403 },
    });
    expect(localStorage.getItem('feely_token')).toBe(token);
    controller.stop();
  });

  test('billing failure conservatively uses the existing free fallback and tracks terms requirements', async () => {
    localStorage.setItem('feely_token', jwt());
    mockBackend({
      '/billing/subscription': () => json({ detail: 'Unavailable' }, 503),
      '/terms/me': () => json({ ...terms, current: { ...terms.current, enforced: true } }),
    });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      subscription: { my_map_access: false, journal_access: false },
      termsRequired: true,
    });
    controller.stop();
  });

  test('a late account response cannot overwrite a changed session', async () => {
    localStorage.setItem('feely_token', jwt(undefined, 'old'));
    const old = deferred<Response>();
    mockBackend({ '/users/me/account': () => old.promise });
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    const loading = controller.reload();
    localStorage.setItem('feely_token', jwt(undefined, 'new'));
    mockBackend({ '/users/me/account': () => json({ ...account, id: 2, username: 'new' }) });
    await controller.reload();
    old.resolve(json(account));
    await loading;
    expect(controller.getSnapshot().session).toMatchObject({
      status: 'authenticated',
      account: { id: 2, username: 'new' },
    });
    controller.stop();
  });

  test('expiry timer signs out even without another request', async () => {
    vi.useFakeTimers();
    localStorage.setItem('feely_token', jwt(Date.now() / 1000 + 2));
    mockBackend();
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    await vi.advanceTimersByTimeAsync(2100);
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    expect(localStorage.getItem('feely_token')).toBeNull();
    controller.stop();
  });

  test('a response from a stopped provider cannot erase a session established by a replacement provider', async () => {
    localStorage.setItem('feely_token', jwt(undefined, 'old'));
    const old = deferred<Response>();
    mockBackend({ '/users/me/account': () => old.promise });
    const previous = new SessionController('http://127.0.0.1:8000/api/v1');
    const pending = previous.reload();
    previous.stop();
    const token = jwt(undefined, 'replacement');
    localStorage.setItem('feely_token', token);
    mockBackend();
    const current = new SessionController('http://127.0.0.1:8000/api/v1');
    await current.reload();
    old.resolve(json({ detail: 'Old request rejected' }, 401));
    await pending;
    expect(current.getSnapshot().session.status).toBe('authenticated');
    expect(localStorage.getItem('feely_token')).toBe(token);
    current.stop();
  });

  test('focus revalidation expires revoked sessions but retains sessions during a temporary outage', async () => {
    localStorage.setItem('feely_token', jwt());
    mockBackend();
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    await controller.reload();
    mockBackend({ '/users/me': () => json({ detail: 'Unavailable' }, 500) });
    await controller.validateOnReturn();
    expect(controller.getSnapshot().session.status).toBe('authenticated');
    mockBackend({ '/users/me': () => json({ detail: 'Revoked' }, 401) });
    await controller.validateOnReturn();
    expect(controller.getSnapshot().session.status).toBe('unauthenticated');
    controller.stop();
  });

  test('real provider works in StrictMode and reacts to same-origin reference login/logout storage changes', async () => {
    mockBackend();
    const controller = new SessionController('http://127.0.0.1:8000/api/v1');
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <SessionProvider controller={controller}>
              <App />
            </SessionProvider>
          ),
        },
      ],
      { initialEntries: ['/chat'] },
    );
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    await screen.findByRole('form', { name: 'Login' });
    localStorage.setItem('feely_token', jwt());
    await act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'feely_token' }));
    });
    await screen.findByText('member@example.test');
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    localStorage.removeItem('feely_token');
    await act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'feely_token' }));
    });
    await waitFor(() => expect(controller.getSnapshot().session.status).toBe('unauthenticated'));
    await screen.findByRole('form', { name: 'Login' });
  });
});
