import type {
  AccountResponse,
  FeedbackConfigResponse,
  SubscriptionResponse,
  TermsResponse,
} from '../types/api';
import { ApiClient, ApiError } from './apiClient';

export function freeSubscription(): SubscriptionResponse {
  return {
    status: 'none',
    plan: 'free',
    premium: false,
    my_map_access: false,
    journal_access: false,
    chat_daily_limit: 10,
    cancel_at_period_end: false,
    current_period_end: null,
    billing_available: false,
    available_plans: [],
    management_available: false,
    can_resume: false,
  };
}

export async function loadSessionData(api: ApiClient) {
  const [account, subscription, terms] = await Promise.all([
    api.request<AccountResponse>('/users/me/account', { authenticated: true }),
    api
      .request<SubscriptionResponse>('/billing/subscription', { authenticated: true })
      .catch((error) => {
        // The existing frontend falls back to free capabilities on temporary billing
        // failures, but propagates denied/expired sessions.
        if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
        return freeSubscription();
      }),
    api.request<TermsResponse>('/terms/me', { authenticated: true }),
  ]);
  if (
    !account?.id ||
    !account.email ||
    typeof subscription?.my_map_access !== 'boolean' ||
    !terms?.current
  ) {
    throw new ApiError('The FeelY backend returned an invalid session response.', 502);
  }
  return {
    account,
    subscription,
    terms,
    termsRequired: terms.current.enforced && !terms.accepted_current,
  };
}

export async function loadFeedbackConfig(api: ApiClient) {
  const config = await api.request<FeedbackConfigResponse>('/feedback/config');
  if (typeof config?.enabled !== 'boolean')
    throw new ApiError('Could not load feedback configuration.', 502);
  return config;
}
