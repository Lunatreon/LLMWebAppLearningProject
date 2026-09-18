const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../website/js/chat.js'), 'utf8').replace(/\r\n/g, '\n');
const start = source.indexOf('function createChatTextPlayer(');
const code = source.slice(start, source.indexOf('\n}\n', start) + 3);

function fixture(reduced = false) {
  const timers = new Map();
  const chunks = [];
  let id = 0;
  let now = 0;
  const reveals = [];
  const context = vm.createContext({
    performance: { now: () => now },
    window: { matchMedia: () => ({ matches: reduced }) }, document: { hidden: false },
    setTimeout(fn, delay) { timers.set(++id, () => { now += delay; fn(); }); return id; },
    clearTimeout(key) { timers.delete(key); },
    appendStreamingText(_bubble, text) { if (text) { chunks.push(text); reveals.push({ text, at: now }); } },
  });
  vm.runInContext(code, context);
  const bubble = { isConnected: true };
  return { context, bubble, chunks, reveals, player: context.createChatTextPlayer(bubble),
    drain() { while (timers.size) { const [key, fn] = timers.entries().next().value; timers.delete(key); fn(); } },
  };
}

test('bursts reveal progressively and finish without losing text or splitting emoji', async () => {
  const f = fixture();
  const text = 'A thoughtful reply 🙂 with a complete final question?\n'.repeat(10);
  f.player.push(text.slice(0, 8));
  f.player.push(text.slice(8));
  assert.equal(f.chunks.length, 0);
  f.drain();
  await f.player.finish();
  assert.ok(f.chunks.length > 1);
  assert.equal(f.chunks.join(''), text);
  assert.ok(f.chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('reduced motion and hidden tabs finish immediately', async () => {
  for (const reduced of [true, false]) {
    const f = fixture(reduced);
    f.context.document.hidden = !reduced;
    f.player.push('The complete reply.');
    await f.player.finish();
    assert.deepEqual(f.chunks, ['The complete reply.']);
    f.drain();
    assert.equal(f.chunks.length, 1);
  }
});

test('network fragments wait for whole words and completion reveals the final word', async () => {
  const f = fixture();
  f.player.push('Under');
  f.drain();
  assert.equal(f.chunks.length, 0);
  f.player.push('standing yourself\n\ncan ');
  f.drain();
  assert.deepEqual(f.chunks, ['Understanding yourself\n\n', 'can ']);
  f.player.push('help.');
  f.drain();
  assert.equal(f.chunks.length, 2);
  const done = f.player.finish();
  f.drain();
  await done;
  assert.equal(f.chunks.join(''), 'Understanding yourself\n\ncan help.');
});

test('sentences without spaces stream at sentence boundaries', async () => {
  const f = fixture();
  f.player.push('你好。你好吗？');
  f.drain();
  assert.deepEqual(f.chunks, ['你好。', '你好吗？']);
  const done = f.player.finish();
  f.drain();
  await done;
});

test('cancel and detached bubbles stop playback and release completion', async () => {
  for (const detach of [true, false]) {
    const f = fixture();
    f.player.push('Pending reply');
    if (detach) f.bubble.isConnected = false;
    else f.player.cancel();
    const done = f.player.finish();
    f.drain();
    await done;
    assert.equal(f.chunks.length, 0);
  }
});

test('phrases pause longer at sentences and paragraphs than commas', async () => {
  const f = fixture();
  f.player.push('We pause, then continue. New thought\n\nMore words ');
  f.drain();
  const done = f.player.finish();
  f.drain();
  await done;
  assert.deepEqual(f.chunks, ['We pause, ', 'then continue. ', 'New thought\n\n', 'More words ']);
  const gaps = f.reveals.slice(1).map((r, i) => r.at - f.reveals[i].at);
  assert.ok(gaps[0] >= 200);
  assert.ok(gaps[1] > gaps[0]);
  assert.ok(gaps[2] > gaps[1]);
});

test('a new packet respects the pause after the preceding sentence', () => {
  const f = fixture();
  f.player.push('Take time. ');
  f.drain();
  f.player.push('Another thought ');
  f.drain();
  assert.ok(f.reveals[1].at - f.reveals[0].at >= 350);
});


test('completion flushes a large backlog and the last word without waiting for timers', async () => {
  const f = fixture();
  const text = 'A complete response. '.repeat(100) + 'Finalword';
  f.player.push(text);
  const done = f.player.finish();
  assert.equal(f.chunks.join(''), text);
  assert.equal(f.reveals[0].at, 0);
  await done;
  await f.player.finish();
  f.player.push('late text');
  f.drain();
  assert.equal(f.chunks.join(''), text);
});
