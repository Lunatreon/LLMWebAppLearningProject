import { ApiClient, ApiError } from '../../../services/apiClient';
import type { RecoveryResponse, ResetResponse } from './types';

export async function requestPasswordRecovery(api: ApiClient, email: string, signal?: AbortSignal) {
  const result = await api.request<RecoveryResponse>('/auth/password-reset/request', {
    method: 'POST',
    signal,
    body: JSON.stringify({ email: email.trim() }),
  });
  if (typeof result?.sent !== 'boolean' || typeof result.detail !== 'string') {
    throw new ApiError('FeelY returned an invalid recovery response. Please try again.', 502);
  }
  return result;
}
export async function resetPassword(
  api: ApiClient,
  token: string,
  password: string,
  signal?: AbortSignal,
) {
  const result = await api.request<ResetResponse>('/auth/password-reset/confirm', {
    method: 'POST',
    signal,
    body: JSON.stringify({ token, new_password: password }),
  });
  if (result?.reset !== true || typeof result.detail !== 'string') {
    throw new ApiError(
      'FeelY returned an invalid reset response. Please request a new link if this one has already been used.',
      502,
    );
  }
  return result;
}
