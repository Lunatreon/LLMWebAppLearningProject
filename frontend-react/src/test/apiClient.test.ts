import { describe, expect, test, vi } from 'vitest';
import { ApiClient } from '../services/apiClient';
import { resolveApiBase } from '../services/config';
import { deferred, json } from './backend';

describe('legacy-compatible API client', () => {
  test('uses JSON/Bearer and default credentials without public authorization', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(json({ enabled: true })));
    vi.stubGlobal('fetch', fetch);
    const api = new ApiClient({
      baseUrl: 'https://api.example.test/api/v1',
      getToken: () => 'jwt-value',
    });
    await api.request('/feedback/config');
    await api.request('/feedback', {
      authenticated: true,
      method: 'POST',
      body: JSON.stringify({ category: 'bug', message: 'Example' }),
    });
    const first = fetch.mock.calls[0][1] as RequestInit;
    const second = fetch.mock.calls[1][1] as RequestInit;
    expect(new Headers(first.headers).has('Authorization')).toBe(false);
    expect(new Headers(second.headers).get('Authorization')).toBe('Bearer jwt-value');
    expect(new Headers(second.headers).get('Content-Type')).toBe('application/json');
    expect(first.credentials).toBeUndefined();
    expect(second.credentials).toBeUndefined();
  });

  test('retries GET network failures once, and never retries a write', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Offline'))
      .mockResolvedValueOnce(json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    const api = new ApiClient({ baseUrl: 'https://api.example.test', getToken: () => 'token' });
    await expect(api.request('/config')).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockRejectedValue(new TypeError('Offline'));
    await expect(
      api.request('/feedback', { method: 'POST', authenticated: true }),
    ).rejects.toMatchObject({ status: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('keeps FastAPI validation and rate-limit errors and does not expire on 403/429/500', async () => {
    const expired = vi.fn();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ detail: [{ msg: 'Too short' }] }, 422))
      .mockResolvedValueOnce(json({ detail: 'Too many requests.' }, 429, { 'Retry-After': '60' }))
      .mockResolvedValueOnce(json({ detail: 'Email verification required' }, 403))
      .mockResolvedValueOnce(json({ detail: 'Unavailable' }, 500));
    vi.stubGlobal('fetch', fetch);
    const api = new ApiClient({ baseUrl: '', getToken: () => 'token', onSessionExpired: expired });
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      message: 'Too short',
      status: 422,
    });
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      message: 'Too many requests. Try again in 60 seconds.',
      status: 429,
      retryAfter: '60',
    });
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      status: 403,
    });
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      status: 500,
    });
    expect(expired).not.toHaveBeenCalled();
  });

  test('authenticated 401 expires only the current token; public 401 never expires a session', async () => {
    let token: string | null = 'current';
    const expired = vi.fn(() => {
      token = null;
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ detail: 'Rejected' }, 401)));
    const api = new ApiClient({ baseUrl: '', getToken: () => token, onSessionExpired: expired });
    await expect(api.request('/auth/login', { method: 'POST' })).rejects.toMatchObject({
      message: 'Rejected',
    });
    expect(expired).not.toHaveBeenCalled();
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(expired).toHaveBeenCalledWith('current');
  });

  test.each([200, 401])(
    'late HTTP %s from an old token cannot affect a new session',
    async (status) => {
      let token = 'old';
      const response = deferred<Response>();
      const expired = vi.fn();
      vi.stubGlobal(
        'fetch',
        vi.fn(() => response.promise),
      );
      const api = new ApiClient({ baseUrl: '', getToken: () => token, onSessionExpired: expired });
      const request = api.request('/feedback', { authenticated: true });
      token = 'new';
      response.resolve(json({ detail: 'Old response' }, status));
      await expect(request).rejects.toMatchObject({ status: 401 });
      expect(expired).not.toHaveBeenCalled();
    },
  );

  test('checks for changed sessions again after reading a delayed response body', async () => {
    let token = 'old';
    const body = deferred<string>();
    const response = json({ ok: true });
    vi.spyOn(response, 'text').mockReturnValue(body.promise);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const api = new ApiClient({ baseUrl: '', getToken: () => token });
    const request = api.request('/feedback', { authenticated: true });
    await Promise.resolve();
    token = 'new';
    body.resolve('{"ok":true}');
    await expect(request).rejects.toMatchObject({ status: 401 });
  });

  test('423 reports terms-required without logging out, and HTML errors retain the legacy diagnostic', async () => {
    const required = vi.fn();
    const expired = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ detail: 'Accept terms' }, 423))
        .mockResolvedValueOnce(
          new Response('<html>file server</html>', {
            status: 404,
            headers: { 'Content-Type': 'text/html' },
          }),
        ),
    );
    const api = new ApiClient({
      baseUrl: '',
      getToken: () => 'token',
      onTermsRequired: required,
      onSessionExpired: expired,
    });
    await expect(api.request('/feedback', { authenticated: true })).rejects.toMatchObject({
      status: 423,
    });
    expect(required).toHaveBeenCalledTimes(1);
    expect(expired).not.toHaveBeenCalled();
    await expect(api.request('/missing')).rejects.toMatchObject({
      message: 'The FeelY page reached a file server instead of the backend. Check the API URL.',
    });
  });

  test('preserves API-base precedence across local, public and stored configuration', () => {
    const local = {
      protocol: 'http:',
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5173',
      search: '',
    };
    localStorage.setItem('feely_api_base', 'https://stored.example.test/api/v1/');
    expect(resolveApiBase(local)).toBe('http://127.0.0.1:8000/api/v1');
    expect(resolveApiBase({ ...local, search: '?api_base=http://127.0.0.1:8001/api/v1/' })).toBe(
      'http://127.0.0.1:8001/api/v1',
    );
    vi.stubEnv('VITE_API_BASE_URL', 'https://configured.example.test/api/v1/');
    const publicLocation = {
      ...local,
      hostname: 'app.example.test',
      origin: 'https://app.example.test',
    };
    expect(resolveApiBase(publicLocation)).toBe('https://configured.example.test/api/v1');
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(resolveApiBase(publicLocation)).toBe('https://stored.example.test/api/v1');
    localStorage.removeItem('feely_api_base');
    expect(resolveApiBase(publicLocation)).toBe('https://app.example.test/api/v1');
    vi.unstubAllEnvs();
  });
});
