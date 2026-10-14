// These values are public build inputs. Backend credentials never belong in VITE_*.
export function validateProductionPublicConfig(env: Record<string, string | undefined>) {
  const supported = new Set([
    'VITE_API_BASE_URL',
    'VITE_LEGACY_APP_URL',
    'VITE_LEGACY_SIGN_IN_URL',
  ]);
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('VITE_')) continue;
    if (!supported.has(name)) throw new Error(`Unsupported public build setting: ${name}`);
    if (!value?.trim()) continue;
    if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
      const relative = new URL(value, 'https://build.example.invalid');
      if (relative.search || relative.hash || /[\r\n]/.test(value)) {
        throw new Error(`${name} must not contain a query, fragment or newline.`);
      }
      continue;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a same-origin path or a public HTTPS URL.`);
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname) ||
      url.hostname.endsWith('.localhost') ||
      value.includes('<') ||
      value.includes('>')
    ) {
      throw new Error(`${name} must use a public HTTPS URL without credentials, query or port.`);
    }
  }
}
