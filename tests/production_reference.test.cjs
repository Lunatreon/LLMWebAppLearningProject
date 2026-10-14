const assert = require('node:assert/strict');
const { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const vm = require('node:vm');

for (const requestedBase of [
  '/api/v1',
  'https://api.example.invalid/api/v1',
  'https://api.example.invalid/api/v1/',
]) {
  const apiBase = requestedBase.replace(/\/$/, '');
  test(`generated production reference locks the API to ${apiBase}`, () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'feely-production-reference-'));
    try {
      mkdirSync(path.join(root, 'website'));
      for (const name of ['index.html', 'app.js']) {
        cpSync(path.join('website', name), path.join(root, 'website', name));
      }
      const original = readFileSync(path.join(root, 'website', 'app.js'), 'utf8');
      const result = spawnSync(process.execPath, ['deployment/configure-reference.mjs', root], {
        encoding: 'utf8',
        env: { ...process.env, VITE_API_BASE_URL: requestedBase },
      });
      assert.equal(result.status, 0, result.stderr);
      const script = readFileSync(path.join(root, 'reference', 'app.js'), 'utf8');
      const start = script.indexOf('function resolveApiBase() {');
      const end = script.indexOf('const API_BASE =', start);
      assert.ok(start >= 0 && end > start);
      const context = {
        window: {
          location: {
            search: '?api_base=https://attacker.example.invalid/api/v1',
            hostname: 'app.example.invalid',
            protocol: 'https:',
          },
        },
        localStorage: { getItem: () => 'https://attacker.example.invalid/api/v1' },
        URLSearchParams,
      };
      assert.equal(
        vm.runInNewContext(`${script.slice(start, end)}\nresolveApiBase()`, context),
        apiBase,
      );
      assert.ok(
        readFileSync(path.join(root, 'reference', 'index.html'), 'utf8').includes(
          `content="${apiBase}"`,
        ),
      );
      assert.equal(readFileSync(path.join(root, 'website', 'app.js'), 'utf8'), original);
    } finally {
      const resolved = path.resolve(root);
      assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
      assert.ok(path.basename(resolved).startsWith('feely-production-reference-'));
      rmSync(resolved, { recursive: true, force: true });
    }
  });
}
