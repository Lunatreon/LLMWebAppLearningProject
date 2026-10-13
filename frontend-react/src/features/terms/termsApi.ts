import { ApiClient, ApiError } from '../../services/apiClient';
import type { TermsAcceptance, TermsConfiguration } from '../../types/api';
import type { PublishedTerms } from './types';

export async function loadCurrentTerms(api: ApiClient) {
  const current = await api.request<TermsConfiguration>('/terms/config');
  if (typeof current?.configured !== 'boolean' || typeof current.enforced !== 'boolean') {
    throw new ApiError('The terms could not be loaded. Please try again.', 502);
  }
  return current;
}

export function acceptTerms(api: ApiClient, displayed: PublishedTerms) {
  return api.request<TermsAcceptance>('/terms/accept', {
    authenticated: true,
    method: 'POST',
    body: JSON.stringify({
      accepted: true,
      version: displayed.version,
      document_sha256: displayed.document_sha256,
      client: 'web',
    }),
  });
}
