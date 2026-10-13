import type { AccountResponse, SubscriptionResponse, TermsResponse } from '../types/api';
import { ApiClient, ApiError, sessionEndedMessage } from './apiClient';
import { loadFeedbackConfig, loadSessionData } from './sessionApi';

export type SessionState =
  | { status: 'loading'; token: string | null }
  | { status: 'unauthenticated'; token: null; message?: string }
  | { status: 'error'; token: string | null; error: ApiError }
  | {
      status: 'authenticated';
      token: string;
      account: AccountResponse;
      subscription: SubscriptionResponse;
      terms: TermsResponse;
      termsRequired: boolean;
    };

type FeedbackState = { status: 'loading' | 'ready' | 'error'; enabled: boolean; error?: ApiError };
export interface SessionSnapshot {
  session: SessionState;
  feedback: FeedbackState;
}

function savedToken() {
  try {
    return localStorage.getItem('feely_token');
  } catch {
    return null;
  }
}

export function tokenExpiry(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp)
      ? payload.exp * 1000
      : null;
  } catch {
    return null;
  }
}

function apiError(error: unknown) {
  return error instanceof ApiError
    ? error
    : new ApiError(error instanceof Error ? error.message : 'Request failed', 0);
}

export class SessionController {
  readonly api: ApiClient;
  private token = savedToken();
  private active = true;
  private revision = 0;
  private configRevision = 0;
  private pending: Promise<void> | null = null;
  private validationPending = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: SessionSnapshot = {
    session: { status: 'loading', token: this.token },
    feedback: { status: 'loading', enabled: false },
  };

  constructor(baseUrl: string) {
    this.api = new ApiClient({
      baseUrl,
      getToken: () => this.getToken(),
      onSessionExpired: (token) => this.expire(token),
      onTermsRequired: () => {
        if (this.snapshot.session.status === 'authenticated') {
          this.update({ session: { ...this.snapshot.session, termsRequired: true } });
        }
      },
    });
  }

  getSnapshot = () => this.snapshot;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  getToken = () => (this.active ? this.token : null);

  establishSession = async (token: string, expected: SessionState) => {
    // A late login must not replace a session changed by sign-out/another tab.
    if (!this.active || this.snapshot.session !== expected || savedToken() !== this.token)
      return false;
    try {
      localStorage.setItem('feely_token', token);
    } catch {
      throw new ApiError(
        'FeelY could not save your session. Please allow local storage and try again.',
        0,
      );
    }
    await this.reload({ force: true });
    return true;
  };

  private update(change: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((notify) => notify());
  }

  private scheduleExpiry(token: string) {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const expiry = tokenExpiry(token);
    if (expiry === null || expiry <= Date.now()) {
      this.expire(token);
      return false;
    }
    this.expiryTimer = setTimeout(
      () => {
        if (this.token === token) this.scheduleExpiry(token);
      },
      Math.min(expiry - Date.now(), 2147483647),
    );
    return true;
  }

  expire(token: string) {
    if (token !== this.token) return;
    this.signOut(sessionEndedMessage);
  }

  signOut = (message?: string) => {
    this.token = null;
    this.revision++;
    this.pending = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    try {
      localStorage.removeItem('feely_token');
    } catch {
      /* Clear in-memory session anyway. */
    }
    this.update({ session: { status: 'unauthenticated', token: null, message } });
  };

  reload = async ({ force = false }: { force?: boolean } = {}) => {
    this.active = true;
    const token = savedToken();
    if (token !== this.token) {
      if (this.expiryTimer) clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
      this.token = token;
      this.revision++;
      this.pending = null;
    }
    // Writes need a read started after their commit, not an older in-flight read.
    if (this.pending && !force) return this.pending;
    if (!token) {
      this.update({ session: { status: 'unauthenticated', token: null } });
      return;
    }
    if (!this.scheduleExpiry(token)) return;
    const revision = ++this.revision;
    this.update({ session: { status: 'loading', token } });
    const request = (async () => {
      try {
        const data = await loadSessionData(this.api);
        if (revision === this.revision && token === this.token)
          this.update({ session: { status: 'authenticated', token, ...data } });
      } catch (error) {
        if (revision === this.revision && token === this.token)
          this.update({ session: { status: 'error', token, error: apiError(error) } });
      }
    })();
    this.pending = request;
    await request;
    if (this.pending === request) this.pending = null;
  };

  refreshFeedbackConfig = async () => {
    const revision = ++this.configRevision;
    this.update({ feedback: { status: 'loading', enabled: false } });
    try {
      const config = await loadFeedbackConfig(this.api);
      if (revision === this.configRevision)
        this.update({ feedback: { status: 'ready', enabled: config.enabled } });
    } catch (error) {
      if (revision === this.configRevision)
        this.update({ feedback: { status: 'error', enabled: false, error: apiError(error) } });
    }
  };

  disableFeedback = () => {
    this.configRevision++;
    this.update({ feedback: { status: 'ready', enabled: false } });
  };

  applyAccountResponse = (account: AccountResponse, requestToken: string) => {
    const session = this.snapshot.session;
    if (
      requestToken !== this.getToken() ||
      session.status !== 'authenticated' ||
      account.id !== session.account.id
    )
      return false;
    // The authenticated PATCH response is the authoritative account refresh.
    // Profile/password edits do not modify terms/subscriptions or require a new JWT.
    this.revision++;
    this.pending = null;
    this.update({ session: { ...session, account } });
    return true;
  };

  validateOnReturn = async () => {
    if (savedToken() !== this.token) {
      await this.reload();
      return;
    }
    if (!this.token || !this.scheduleExpiry(this.token) || this.validationPending) return;
    if (this.snapshot.session.status !== 'authenticated') {
      await this.reload();
      return;
    }
    this.validationPending = true;
    try {
      await this.api.request('/users/me', { authenticated: true });
    } catch {
      /* The API expires revoked sessions; temporary failures keep the session. */
    } finally {
      this.validationPending = false;
    }
  };

  stop = () => {
    this.active = false;
    this.revision++;
    this.configRevision++;
    this.pending = null;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
  };
}
