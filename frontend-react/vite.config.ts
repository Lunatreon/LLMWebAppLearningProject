import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { validateProductionPublicConfig } from './production-config.ts';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, frontendRoot, 'VITE_');
  if (command === 'build') validateProductionPublicConfig(env);
  return {
    plugins: [
      react(),
      {
        name: 'configure-public-tools',
        apply: 'build',
        closeBundle() {
          for (const name of ['admin.html', 'webmail.html']) {
            const file = resolve(frontendRoot, 'dist', name);
            const apiBase = (env.VITE_API_BASE_URL || '/api/v1')
              .replaceAll('&', '&amp;')
              .replaceAll('"', '&quot;')
              .replaceAll('<', '&lt;');
            writeFileSync(
              file,
              readFileSync(file, 'utf8').replace('content="/api/v1"', `content="${apiBase}"`),
            );
          }
        },
      },
    ],
    server: { host: '127.0.0.1', port: 5173, strictPort: true, fs: { allow: [frontendRoot] } },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  };
});
