export function resolveApiBase(
  location: Pick<Location, 'search' | 'hostname' | 'protocol' | 'origin'> = window.location,
) {
  if (import.meta.env.PROD) {
    // A deployed build must not send a saved JWT to a query/storage-selected API.
    return (import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1').replace(/\/$/, '');
  }
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
