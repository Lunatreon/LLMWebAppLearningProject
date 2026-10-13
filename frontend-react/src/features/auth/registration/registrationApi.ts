import { ApiClient, ApiError } from '../../../services/apiClient';
import { isPublishedTerms } from '../../terms/types';
import type { TermsConfiguration } from '../../terms/types';
import type {
  CaptchaConfiguration,
  RegisteredUser,
  RegistrationFields,
  RegistrationPayload,
} from './types';

export async function loadCaptchaConfig(api: ApiClient) {
  const config = await api.request<CaptchaConfiguration>('/auth/captcha/config');
  if (typeof config?.enabled !== 'boolean')
    throw new ApiError(
      'Account verification configuration could not be loaded. Please try again.',
      502,
    );
  return config;
}

export function registrationPayload(
  fields: RegistrationFields,
  captcha: CaptchaConfiguration,
  token: string,
  terms: TermsConfiguration,
  accepted: boolean,
): RegistrationPayload {
  if (terms.configured && (!isPublishedTerms(terms) || !accepted)) {
    throw new ApiError('Please read and accept the FeelY terms before creating an account.', 0);
  }
  if (captcha.enabled && !token)
    throw new ApiError('Please complete the verification before creating an account.', 0);
  return {
    email: fields.email.trim(),
    username: fields.username.trim(),
    password: fields.password,
    website: fields.website.trim(),
    captcha_token: captcha.enabled ? token : null,
    ...(isPublishedTerms(terms)
      ? {
          terms_accepted: true as const,
          terms_version: terms.version,
          terms_document_sha256: terms.document_sha256,
        }
      : {}),
  };
}

export async function register(api: ApiClient, payload: RegistrationPayload, signal?: AbortSignal) {
  const user = await api.request<RegisteredUser>('/auth/register', {
    method: 'POST',
    signal,
    body: JSON.stringify(payload),
  });
  if (
    !user?.id ||
    typeof user.email !== 'string' ||
    typeof user.username !== 'string' ||
    typeof user.is_email_verified !== 'boolean'
  ) {
    throw new ApiError(
      'FeelY returned an invalid registration response. Please check whether your account was created before trying again.',
      502,
    );
  }
  return user;
}
