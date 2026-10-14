// Configure only the image's generated copy; the reference website source stays read-only.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';

cpSync('/build/website', '/build/reference', { recursive: true });
const file = '/build/reference/index.html';
const html = readFileSync(file, 'utf8');
const apiBase = (process.env.VITE_API_BASE_URL || '/api/v1')
  .replaceAll('&', '&amp;')
  .replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;');
const configured = html.replace(
  /(<meta name="feely-api-base" content=")[^"]*("\s*\/>)/,
  (_match, before, after) => `${before}${apiBase}${after}`,
);
if (configured === html && !html.includes(`content="${apiBase}"`)) {
  throw new Error('The generated reference HTML needs its public API configuration.');
}
writeFileSync(file, configured);
