const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '../website/js/chat.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('async function pollTopicOnce(');
const code = source.slice(start, source.indexOf('\n}\n', start) + 3);
test('polling continues beyond four attempts until slow analysis finishes', async () => {
  let next;
  let calls = 0;
  const delays = [];
  const context = vm.createContext({
    state: { activeChatId: 'chat', token: 'test' },
    TOPIC_POLL_DELAYS: [700, 1800, 4000, 8000],
    stopPolling() { next = null; },
    setTimeout(fn, delay) { next = fn; delays.push(delay); return 1; },
    pollTopicOnce: async () => ++calls === 7,
  });
  const first = source.indexOf('function pollTopicSoon(');
  vm.runInContext(source.slice(first, source.indexOf('\n}\n', first) + 3), context);
  context.pollTopicSoon();
  while (next) { const fn = next; next = null; await fn(); }
  assert.equal(calls, 7);
  assert.deepEqual(delays, [700, 1800, 4000, 8000, 8000, 8000, 8000]);
  context.state.token = null;
  context.pollTopicSoon();
  assert.equal(next, null);
});
test('polling delivers background observations without a topic and preserves unchanged review edits', async () => {
  const suggestion = { category: 'value', text: 'I value my independence.', reason: 'You said so.' };
  let renders = 0;
  let payload = { suggestion: null, map_suggestion: suggestion, analysis_status: 'analysing' };
  const state = { activeChatId: 'chat', token: 'test', pendingTopic: null, pendingMapSuggestion: null, chats: [{chat_id:'chat'}] };
  const context = vm.createContext({ state, authHeaders: () => ({}), api: async () => payload,
    document: { querySelector: () => ({ classList: { toggle() {} } }) },
    renderTopic: value => { state.pendingTopic = value; },
    renderMapSuggestion: value => { state.pendingMapSuggestion = value; renders++; },
  });
  vm.runInContext(code, context);
  assert.equal(await context.pollTopicOnce(), false);
  assert.equal(renders, 1);
  payload = { ...payload, analysis_status: 'idle' };
  assert.equal(await context.pollTopicOnce(), true);
  assert.equal(renders, 1);
  assert.equal(state.chats[0].pending_map_suggestion, suggestion);
});
