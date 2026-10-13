import { ApiError, sessionEndedMessage } from './apiError';
import { readNdjson } from './ndjson';
export { ApiError, sessionEndedMessage } from './apiError';

interface ClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  onSessionExpired?: (token: string) => void;
  onTermsRequired?: () => void;
}

export interface ApiRequestOptions extends RequestInit {
  authenticated?: boolean;
}

export class ApiClient {
  constructor(private readonly options: ClientOptions) {}

  // Capture request ownership before a feature mutation waits in a queue.
  getSessionToken() {
    return this.options.getToken();
  }

  private checkSession(response: Response, token: string | null) {
    if (!token) return;
    if (response.status === 401 && token === this.options.getToken())
      this.options.onSessionExpired?.(token);
    if (token !== this.options.getToken()) throw new ApiError(sessionEndedMessage, 401);
  }

  // Chat's existing fetch/NDJSON protocol. Writes are never replayed.
  async stream(
    path: string,
    options: ApiRequestOptions,
    onEvent: (event: unknown) => void,
  ): Promise<void> {
    const token = options.authenticated ? this.options.getToken() : null;
    if (options.authenticated && !token) throw new ApiError(sessionEndedMessage, 401);
    const { authenticated: _authenticated, ...init } = options;
    const headers = new Headers({ 'Content-Type': 'application/json' });
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    if (token) headers.set('Authorization', `Bearer ${token}`);
    let response: Response;
    try {
      response = await fetch(`${this.options.baseUrl}${path}`, { ...init, headers });
    } catch (error) {
      if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
        throw error;
      throw new ApiError(
        'FeelY temporarily lost its connection. Your message is still in the input box so you can retry.',
        0,
      );
    }
    this.checkSession(response, token);
    if (!response.ok || !response.body) {
      if (response.status === 423 && token === this.options.getToken())
        this.options.onTermsRequired?.();
      let detail: unknown = 'Request failed';
      try {
        detail = (await response.json()).detail || detail;
      } catch {
        /* Legacy fallback. */
      }
      this.checkSession(response, token);
      let message = 'Request failed';
      if (typeof detail === 'string') {
        message = detail;
      } else if (Array.isArray(detail)) {
        message = detail[0]?.msg || 'Request failed';
      }
      throw new ApiError(message, response.status);
    }
    const decode = (value: unknown) => {
      const error = value as { type?: string; status?: number } | null;
      if (error?.type === 'error' && token === this.options.getToken()) {
        if (error.status === 401 && token) this.options.onSessionExpired?.(token);
        if (error.status === 423 && token) this.options.onTermsRequired?.();
      }
      onEvent(value);
    };
    try {
      await readNdjson(response.body, {
        signal: init.signal,
        checkOwnership: () => this.checkSession(response, token),
        onEvent: decode,
      });
    } catch (error) {
      if (
        error instanceof ApiError ||
        init.signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      )
        throw error;
      throw new ApiError(
        'FeelY temporarily lost its connection. Your message is still in the input box so you can retry.',
        0,
      );
    }
  }

  async request<T>(
    path: string,
    { authenticated = false, ...options }: ApiRequestOptions = {},
  ): Promise<T> {
    const token = authenticated ? this.options.getToken() : null;
    if (authenticated && !token) throw new ApiError(sessionEndedMessage, 401);
    const headers = new Headers({ 'Content-Type': 'application/json' });
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const attempts = !options.method || options.method.toUpperCase() === 'GET' ? 2 : 1;
    let response: Response | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (token && token !== this.options.getToken()) throw new ApiError(sessionEndedMessage, 401);
      try {
        // Deliberately leave credentials unset: the legacy uses fetch's default
        // same-origin behavior. Cross-origin auth is Bearer, not cookies.
        response = await fetch(`${this.options.baseUrl}${path}`, { ...options, headers });
        break;
      } catch (error) {
        if (options.signal?.aborted || (error instanceof Error && error.name === 'AbortError'))
          throw error;
        if (attempt + 1 < attempts) {
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        throw new ApiError(
          'FeelY temporarily lost its connection. Please try again in a moment.',
          0,
        );
      }
    }
    if (!response) throw new ApiError('Request failed', 0);
    this.checkSession(response, token);
    const text = await response.text();
    this.checkSession(response, token);
    const contentType = response.headers.get('Content-Type') || '';
    let payload: { detail?: string | { msg?: string }[] } | null = null;
    if (text && contentType.includes('application/json')) {
      try {
        payload = JSON.parse(text);
      } catch {
        /* Match the reference fallback. */
      }
    }
    if (!response.ok) {
      if (response.status === 423 && token && token === this.options.getToken())
        this.options.onTermsRequired?.();
      const detail =
        payload?.detail ||
        (contentType.includes('text/html') || text.includes('trusted folder')
          ? 'The FeelY page reached a file server instead of the backend. Check the API URL.'
          : 'Request failed');
      let message = Array.isArray(detail) ? detail[0]?.msg : detail;
      const retryAfter = response.headers.get('Retry-After');
      if (response.status === 429 && retryAfter)
        message = `${message || 'Too many requests.'} Try again in ${retryAfter} seconds.`;
      throw new ApiError(message || 'Request failed', response.status, retryAfter);
    }
    return payload as T;
  }
}
