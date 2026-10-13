import { ApiClient, ApiError } from '../../services/apiClient';
import type { LoginCredentials, LoginResponse } from './types';

export async function verificationEnabled(api: ApiClient) {
  const config = await api.request<{ verification_enabled: boolean }>('/auth/email/config');
  return config?.verification_enabled === true;
}

export async function login(api: ApiClient, credentials: LoginCredentials, signal?: AbortSignal) {
  const payload = await api.request<LoginResponse>('/auth/login', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      email_or_username: credentials.email.trim(),
      password: credentials.password,
    }),
  });
  if (
    !payload ||
    typeof payload.access_token !== 'string' ||
    !payload.access_token.trim() ||
    payload.token_type !== 'bearer'
  ) {
    throw new ApiError('FeelY returned an invalid sign-in response. Please try again.', 502);
  }
  return payload;
}
