import { legacySignInUrl } from './config';

// Shared delegation only; billing/deletion continue in the reference frontend.
export function referenceAccountUrl() {
  const url = new URL(legacySignInUrl());
  url.searchParams.set('view', 'account');
  return url.href;
}
