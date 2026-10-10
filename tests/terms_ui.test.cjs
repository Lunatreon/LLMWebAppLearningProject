const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('registration requires a check and clears it when the document changes', async () => {
  const fields = new Map();
  const field = key => {
    if (!fields.has(key)) fields.set(key, {checked:false});
    return fields.get(key);
  };
  let config = {configured:true, version:'v1', document_sha256:'a'.repeat(64), document_url:'https://example.com/v1'};
  const context = vm.createContext({ state:{mode:'register'}, api:async()=>config,
    document:{querySelector:field} });
  vm.runInContext(fs.readFileSync('website/js/terms.js','utf8'),context);
  await assert.rejects(context.registrationTermsPayload(),/Please read and accept/);
  field('#registration-terms-accepted').checked = true;
  assert.equal((await context.registrationTermsPayload()).terms_version,'v1');
  config = {...config,version:'v2',document_sha256:'b'.repeat(64)};
  await assert.rejects(context.registrationTermsPayload(),/Please read and accept/);
  assert.equal(field('#registration-terms-accepted').checked,false);
});

function harness(result) {
  const elements = new Map();
  let dialog = null;
  let requests = [];
  let entered = 0;
  function element() {
    return { disabled: false, checked: false, listeners: {},
      addEventListener(name, fn) { this.listeners[name] = fn; },
      setAttribute() {}, focus() {},
      querySelector(key) {
        if (!elements.has(key)) elements.set(key, element());
        return elements.get(key);
      },
      showModal() { this.open = true; }, close() { this.open = false; }, remove() { dialog = null; },
    };
  }
  const context = vm.createContext({
    state: { token: 'session' },
    api: async (path, options) => { requests.push({ path, options }); return path === '/terms/me' ? result : {}; },
    authHeaders: () => ({ Authorization: 'Bearer session' }),
    stopPolling() {}, logout() {},
    showChat: async () => { entered++; },
    document: { querySelector: () => dialog, createElement: element, body: { append(node) { dialog = node; } } },
  });
  vm.runInContext(fs.readFileSync('website/js/terms.js', 'utf8'), context);
  return { context, elements, requests, get entered() { return entered; }, get dialog() { return dialog; } };
}

test('unpublished or already accepted terms do not prompt', async () => {
  for (const result of [{ current: { enforced: false } }, { current: { enforced: true }, accepted_current: true }]) {
    const h = harness(result);
    assert.equal(await h.context.ensureTermsAccepted(), true);
    assert.equal(h.dialog, null);
  }
});

test('requires an explicit check and records displayed version and hash', async () => {
  const h = harness({ current: { enforced: true, version: 'v2', document_url: 'https://example.com/v2', document_sha256: 'a'.repeat(64) }, accepted_current: false });
  assert.equal(await h.context.ensureTermsAccepted(), false);
  const consent = h.elements.get('#terms-consent');
  const submit = h.elements.get('#terms-continue');
  const form = h.elements.get('form');
  const event = { preventDefault() {} };
  await form.listeners.submit(event);
  assert.equal(h.requests.length, 1);
  assert.equal(h.entered, 0);
  consent.checked = true;
  consent.listeners.change();
  await form.listeners.submit(event);
  assert.equal(h.requests[1].path, '/terms/accept');
  assert.deepEqual(JSON.parse(h.requests[1].options.body), { accepted: true, version: 'v2', document_sha256: 'a'.repeat(64), client: 'web' });
  assert.equal(h.entered, 1);
});

test('failed acceptance keeps the review open and allows retry', async () => {
  const h = harness({ current: { enforced: true, version: 'v1' } });
  await h.context.ensureTermsAccepted();
  h.context.api = async () => { throw new Error('Offline'); };
  const consent = h.elements.get('#terms-consent');
  consent.checked = true;
  consent.listeners.change();
  await h.elements.get('form').listeners.submit({ preventDefault() {} });
  assert.equal(h.dialog.open, true);
  assert.equal(h.entered, 0);
  assert.equal(h.elements.get('#terms-error').textContent, 'Offline');
  assert.equal(h.elements.get('#terms-continue').disabled, false);
});
