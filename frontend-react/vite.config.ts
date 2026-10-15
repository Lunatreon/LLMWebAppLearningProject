import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { validateProductionPublicConfig } from './production-config.ts';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const legacyRoot = fileURLToPath(new URL('../website', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, frontendRoot, 'VITE_');
  if (command === 'build') validateProductionPublicConfig(env);
  const proxy = {
    '^/reference/': {
      target: env.VITE_LEGACY_APP_URL || 'http://127.0.0.1:5500',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/reference/, ''),
    },
  };
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy,
      fs: {
        // Only the frontend and the reference CSS/assets need filesystem access.
        allow: [frontendRoot, legacyRoot],
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
      proxy,
    },
  };
});
