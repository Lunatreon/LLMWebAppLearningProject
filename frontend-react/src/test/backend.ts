import { vi } from 'vitest';
import type { AccountResponse, SubscriptionResponse, TermsResponse } from '../types/api';

export const account: AccountResponse = {
  id: 1,
  email: 'member@example.test',
  username: 'member',
  display_name: 'Member',
  is_active: true,
  is_email_verified: true,
  role: 'member',
  auth_provider: 'password',
  has_password: true,
  created_at: '2026-10-11T00:00:00Z',
};
export const subscription: SubscriptionResponse = {
  status: 'active',
  plan: 'monthly',
  premium: true,
  my_map_access: true,
  journal_access: true,
  chat_daily_limit: 400,
  cancel_at_period_end: false,
  current_period_end: null,
  billing_available: true,
  available_plans: ['monthly', 'yearly'],
  management_available: true,
  can_resume: false,
};
export const terms: TermsResponse = {
  current: {
    configured: false,
    enforced: false,
    version: null,
    document_url: null,
    document_sha256: null,
  },
  accepted_current: false,
  acceptances: [],
};

export function jwt(exp = Date.now() / 1000 + 3600, subject = '1') {
  return `header.${btoa(JSON.stringify({ sub: subject, exp }))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')}.signature`;
}
export function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function mockBackend(overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const fetch = vi.fn(async (input: RequestInfo | URL, _options?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace('/api/v1', '');
    if (overrides[path]) return overrides[path]();
    const payloads: Record<string, unknown> = {
      '/users/me/account': account,
      '/users/me': account,
      '/billing/subscription': subscription,
      '/terms/me': terms,
      '/terms/config': terms.current,
      '/feedback/config': { enabled: true },
      '/auth/email/config': { verification_enabled: false, password_reset_enabled: true },
      '/auth/captcha/config': { enabled: false, provider: null, site_key: null, action: null },
      '/journal/entries': [],
      '/users/me/map': { topic_spaces: [], unassigned_entries: [] },
      '/llm/chats': [],
    };
    if (/^\/journal\/entries\/\d{4}-\d{2}-\d{2}$/.test(path))
      return json({
        entry_date: path.slice(-10),
        content: '',
        word_count: 0,
        suggestions: [],
        analysis_stale: false,
        analysed_at: null,
        created_at: null,
        updated_at: null,
      });
    if (!Object.hasOwn(payloads, path)) throw new Error(`Unexpected endpoint: ${path}`);
    return json(payloads[path]);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
