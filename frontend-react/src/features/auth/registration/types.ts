import type { TermsConfiguration } from '../../terms/types';

export interface TurnstileOptions {
  sitekey: string;
  action: string;
  size: 'flexible';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'error-callback': () => void;
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileOptions) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export interface CaptchaConfiguration {
  enabled: boolean;
  provider: string | null;
  site_key: string | null;
  action: string | null;
}
export interface RegistrationFields {
  email: string;
  username: string;
  password: string;
  website: string;
}
export interface RegistrationPayload {
  email: string;
  username: string;
  password: string;
  website: string;
  captcha_token: string | null;
  terms_accepted?: true;
  terms_version?: string;
  terms_document_sha256?: string;
}
export interface RegisteredUser {
  id: number;
  email: string;
  username: string;
  display_name: string | null;
  is_email_verified: boolean;
  is_active: boolean;
}
export type RegistrationConfig =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; captcha: CaptchaConfiguration; terms: TermsConfiguration };

export function sameConsentDocument(first: TermsConfiguration, second: TermsConfiguration) {
  // Preserve legacy registration's version/hash comparison (URL is still updated).
  return first.version === second.version && first.document_sha256 === second.document_sha256;
}
