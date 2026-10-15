import { afterEach, expect, test, vi } from 'vitest';
import { resolveApiBase, legacySignInUrl } from '../services/config';
import { validateProductionPublicConfig } from '../../production-config';

afterEach(() => vi.unstubAllEnvs());

test('production uses the configured API and ignores local query/storage overrides', () => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.invalid/api/v1');
  expect(
    resolveApiBase({
      hostname: 'localhost',
      protocol: 'http:',
      origin: 'http://localhost:5173',
      search: '?api_base=https://untrusted.invalid/api/v1',
    }),
  ).toBe('https://api.example.invalid/api/v1');
});

test('production defaults to same-origin API and passes its absolute base to the reference bridge', () => {
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_API_BASE_URL', '');
  expect(resolveApiBase()).toBe('/api/v1');
  const reference = new URL(legacySignInUrl('?api_base=https://untrusted.invalid/api/v1'));
  expect(reference.searchParams.get('api_base')).toBe(`${window.location.origin}/api/v1`);
});

test.each([
  { VITE_API_BASE_URL: 'http://127.0.0.1:8000/api/v1' },
  { VITE_LEGACY_APP_URL: 'http://localhost:5500/' },
  { VITE_OPENAI_API_KEY: 'private-not-for-a-bundle' },
  { VITE_API_BASE_URL: 'https://user:password@api.example.invalid/api/v1' },
])('production build rejects unsafe public configuration', (env) => {
  expect(() => validateProductionPublicConfig(env)).toThrow();
});

test('production permits same-origin and separate HTTPS frontend/API builds', () => {
  expect(() => validateProductionPublicConfig({ VITE_API_BASE_URL: '/api/v1' })).not.toThrow();
  expect(() =>
    validateProductionPublicConfig({
      VITE_API_BASE_URL: 'https://api.example.invalid/api/v1',
    }),
  ).not.toThrow();
});
