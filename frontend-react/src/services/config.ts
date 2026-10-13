export const legacyAppUrl = import.meta.env.VITE_LEGACY_APP_URL?.trim() || 'http://127.0.0.1:5500/';

// Vite replaces the reference entry's public meta configuration. Keep the actual
// legacy precedence, including local hosts taking priority over stored/config bases.
export function resolveApiBase(
  location: Pick<Location, 'search' | 'hostname' | 'protocol' | 'origin'> = window.location,
) {
  const queryBase = new URLSearchParams(location.search).get('api_base')?.trim();
  if (queryBase) return queryBase.replace(/\/$/, '');
  if (
    location.protocol === 'file:' ||
    ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'].includes(location.hostname)
  ) {
    return 'http://127.0.0.1:8000/api/v1';
  }
  const configured = import.meta.env.VITE_API_BASE_URL ?? 'https://api.feel-y.com/api/v1';
  if (configured.trim()) return configured.trim().replace(/\/$/, '');
  try {
    const stored = localStorage.getItem('feely_api_base')?.trim();
    if (stored) return stored.replace(/\/$/, '');
  } catch {
    /* A blocked store must not prevent configuration. */
  }
  return `${location.origin}/api/v1`;
}

export function legacySignInUrl(search = window.location.search) {
  // The development proxy runs the unchanged reference login on React's origin.
  const url = new URL(
    import.meta.env.VITE_LEGACY_SIGN_IN_URL || '/reference/',
    window.location.origin,
  );
  const apiBase = new URLSearchParams(search).get('api_base');
  if (apiBase) url.searchParams.set('api_base', apiBase);
  return url.href;
}
