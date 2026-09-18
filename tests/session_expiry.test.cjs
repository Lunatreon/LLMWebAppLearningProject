const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const core = readFileSync(join(__dirname, "../website/app.js"), "utf8").replace(/\r\n/g, "\n");
const auth = readFileSync(join(__dirname, "../website/js/auth.js"), "utf8");
const jwt = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.signature`;
function sourceFunction(name) {
  const start = core.indexOf(`async function ${name}(`);
  return core.slice(start, core.indexOf("\n}\n", start) + 3);
}

function fixture(status = 200) {
  let now = 100000, timer;
  const removed = [], hidden = new Set(["auth"]);
  const view = name => ({ classList: { add() { hidden.add(name); }, remove() { hidden.delete(name); } } });
  const context = vm.createContext({
    state: { token: jwt(200), chats: ["private"], journalDirty: true }, API_BASE: "http://test",
    ApiError: class extends Error { constructor(message, status) { super(message); this.status = status; } },
    Date: { now: () => now }, atob,
    setTimeout(callback) { timer = callback; return 1; }, clearTimeout() { timer = null; },
    window: { clearTimeout() {} }, journalSaveTimer: null,
    localStorage: { removeItem(key) { removed.push(key); } },
    authView: view("auth"), chatView: view("chat"), authStatus: {}, emailInput: { focus() {} },
    journalText: { value: "private" }, messageInput: { value: "private" }, authForm: { reset() {} },
    document: { visibilityState: "visible", querySelectorAll() { return []; } },
    fetch: async () => new Response(JSON.stringify({ detail: "response" }), {
      status, headers: { "Content-Type": "application/json" },
    }),
  });
  for (const name of ["renderChats", "renderMessages", "renderTopic", "renderMapSuggestion", "renderUser", "closeSidebar", "stopPolling"]) context[name] = () => {};
  vm.runInContext(auth, context);
  context.setMode = mode => { context.state.mode = mode; };
  context.authHeaders = () => ({ Authorization: `Bearer ${context.state.token}` });
  vm.runInContext(sourceFunction("api") + "\n" + sourceFunction("apiStream"), context);
  return { context, removed, hidden, advance(time) { now = time; timer?.(); } };
}

test("expiry logs out without an API request and shows login", () => {
  const app = fixture();
  app.context.scheduleSessionExpiry();
  assert.ok(app.context.state.token);
  app.advance(200000);
  assert.equal(app.context.state.token, null);
  assert.equal(app.context.state.mode, "login");
  assert.equal(app.hidden.has("auth"), false);
  assert.equal(app.hidden.has("chat"), true);
  assert.equal(app.context.journalText.value, "");
  assert.deepEqual(app.removed, ["feely_token"]);
  assert.match(app.context.authStatus.textContent, /sign in again/);
});

for (const method of ["api", "apiStream"]) {
  test(`${method} logs out when the current authenticated request returns 401`, async () => {
    const app = fixture(401);
    await assert.rejects(app.context[method]("/users/me", { headers: app.context.authHeaders() }), { status: 401 });
    assert.equal(app.context.state.token, null);
    assert.equal(app.hidden.has("auth"), false);
  });
}

for (const status of [403, 429, 500]) {
  test(`${status} is not treated as session expiry`, async () => {
    const app = fixture(status);
    const token = app.context.state.token;
    await assert.rejects(app.context.api("/users/me", { headers: app.context.authHeaders() }), { status });
    assert.equal(app.context.state.token, token);
  });
}

test("a rejected public login does not invalidate another session", async () => {
  const app = fixture(401);
  await assert.rejects(app.context.api("/auth/login", { method: "POST" }), { status: 401 });
  assert.ok(app.context.state.token);
});

for (const status of [200, 401]) {
  test(`late ${status} from an old session cannot overwrite or log out a new session`, async () => {
    const app = fixture(status);
    let finish;
    app.context.fetch = () => new Promise(resolve => { finish = resolve; });
    const request = app.context.api("/users/me", { headers: app.context.authHeaders() });
    app.context.state.token = jwt(300);
    finish(new Response("{}", { status }));
    await assert.rejects(request, { status: 401 });
    assert.equal(app.context.state.token, jwt(300));
  });
}

test("returning to a tab checks for a revoked session", async () => {
  const app = fixture(401);
  await app.context.validateSessionOnReturn();
  assert.equal(app.context.state.token, null);
});

test("already expired and malformed stored tokens go straight to login", () => {
  for (const token of [jwt(10), "invalid"]) {
    const app = fixture();
    app.context.state.token = token;
    app.context.scheduleSessionExpiry();
    assert.equal(app.context.state.token, null);
    assert.equal(app.hidden.has("auth"), false);
  }
});
