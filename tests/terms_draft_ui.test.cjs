const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function load(fetch) {
  const elements = { '#status': { hidden: false }, '#terms-text': { hidden: true } };
  const context = vm.createContext({
    fetch,
    document: { querySelector: selector => elements[selector] },
  });
  await vm.runInContext(fs.readFileSync('frontend-react/public/legal/draft-page.js', 'utf8'), context);
  return elements;
}

test('each page load fetches fresh text and displays HTML characters literally', async () => {
  for (const content of ['First draft', 'Updated\n<script>alert(1)</script>']) {
    const elements = await load(async (url, options) => {
      assert.equal(url, 'agb-draft.txt');
      assert.equal(options.cache, 'no-store');
      return { ok: true, text: async () => content };
    });
    assert.equal(elements['#terms-text'].textContent, content);
    assert.equal(elements['#terms-text'].hidden, false);
    assert.equal(elements['#status'].hidden, true);
  }
});

test('network and HTTP failures show an error instead of empty terms', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: false })]) {
    const elements = await load(fetch);
    assert.match(elements['#status'].textContent, /konnten nicht geladen/);
    assert.equal(elements['#status'].hidden, false);
    assert.equal(elements['#terms-text'].hidden, true);
  }
});
