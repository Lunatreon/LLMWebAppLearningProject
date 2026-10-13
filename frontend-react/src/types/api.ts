export interface AccountResponse {
  id: number;
  email: string;
  username: string;
  display_name: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  is_active: boolean;
  is_email_verified: boolean;
  role: string;
  auth_provider: string;
  has_password: boolean;
  created_at: string;
  email_verified_at?: string | null;
  last_login_at?: string | null;
}

export interface SubscriptionResponse {
  status: string;
  plan: 'free' | 'monthly' | 'yearly' | 'premium';
  premium: boolean;
  my_map_access: boolean;
  journal_access?: boolean;
  chat_daily_limit: number;
  free_test_phase?: boolean;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  billing_available: boolean;
  available_plans: ('monthly' | 'yearly')[];
  management_available: boolean;
  can_resume: boolean;
}

export interface TermsConfiguration {
  configured: boolean;
  enforced: boolean;
  version: string | null;
  document_url: string | null;
  document_sha256: string | null;
}

export interface TermsAcceptance {
  version: string;
  document_url: string;
  document_sha256: string;
  accepted_at: string;
  client: 'web' | 'android' | 'api';
}

export interface TermsResponse {
  current: TermsConfiguration;
  accepted_current: boolean;
  acceptances: TermsAcceptance[];
}

export interface FeedbackConfigResponse {
  enabled: boolean;
}
