import { ApiClient, ApiError } from '../../../services/apiClient';
import type { ActivationResponse, ResendActivationResponse } from './types';

export async function confirmActivation(
  api: ApiClient,
  email: string,
  pin: string,
  signal?: AbortSignal,
) {
  const result = await api.request<ActivationResponse>('/auth/email-verification/confirm', {
    method: 'POST',
    signal,
    body: JSON.stringify({ email: email.trim(), pin: pin.trim() }),
  });
  if (result?.verified !== true || typeof result.detail !== 'string') {
    throw new ApiError(
      'FeelY returned an invalid activation response. Please check whether your email was activated before trying again.',
      502,
    );
  }
  return result;
}
export async function resendActivation(api: ApiClient, email: string, signal?: AbortSignal) {
  const result = await api.request<ResendActivationResponse>('/auth/email-verification/request', {
    method: 'POST',
    signal,
    body: JSON.stringify({ email: email.trim() }),
  });
  if (typeof result?.sent !== 'boolean' || typeof result.detail !== 'string') {
    throw new ApiError('FeelY returned an invalid resend response. Please try again.', 502);
  }
  return result;
}
