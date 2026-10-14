// Configure only the image's generated copy; the reference website source stays read-only.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const buildRoot = process.argv[2] || '/build';
const reference = path.join(buildRoot, 'reference');
cpSync(path.join(buildRoot, 'website'), reference, { recursive: true });
const file = path.join(reference, 'index.html');
const html = readFileSync(file, 'utf8');
const publicApiBase = (process.env.VITE_API_BASE_URL?.trim() || '/api/v1').replace(/\/$/, '');
const apiBase = publicApiBase
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

const scriptFile = path.join(reference, 'app.js');
const script = readFileSync(scriptFile, 'utf8');
const entry = 'function resolveApiBase() {';
if (script.split(entry).length !== 2) {
  throw new Error('The generated reference API configuration entry must be reviewed.');
}
// This copy shares the production JWT store. Never let a link/storage override
// send that token to an attacker-selected API; source comparison behavior stays intact.
writeFileSync(
  scriptFile,
  script.replace(entry, `${entry}\n  return ${JSON.stringify(publicApiBase)};\n`),
);
