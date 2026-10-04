const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const auth = readFileSync("website/js/auth.js", "utf8");
const feedback = readFileSync("website/js/feedback.js", "utf8");

function element() {
  const classes = new Set();
  return {
    value: "", textContent: "", disabled: false, open: false,
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force) { force ? classes.add(name) : classes.delete(name); },
    },
    focus() {}, reportValidity() { return true; },
    addEventListener(name, fn) { this[name] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; },
    reset() { this.resetCalled = true; },
  };
}

test("registration opens PIN entry without logging in; activation returns to login", async () => {
  const context = vm.createContext({
    state: { captcha: { config: { enabled: false } }, token: null },
    emailInput: { value: "tester@example.com" }, usernameInput: { value: "tester" },
    passwordInput: { value: "password", focus() {} }, websiteInput: null,
    verificationDialog: element(), verificationEmail: element(), verificationPin: element(),
    verificationStatus: element(), verificationResend: element(), authStatus: element(),
    verificationForm: { querySelector() { return element(); } },
  });
  const requests = [];
  context.api = async (path, options) => {
    requests.push({ path, body: JSON.parse(options.body) });
    return path.endsWith("register") ? { email: "tester@example.com", is_email_verified: false } : { verified: true };
  };
  vm.runInContext(auth, context);
  context.setMode = mode => { context.state.mode = mode; };
  await context.registerAndLogin();
  assert.equal(context.verificationDialog.open, true);
  assert.equal(context.passwordInput.value, "");
  assert.equal(requests.length, 1);
  context.verificationPin.value = "001234";
  await context.confirmEmailPin({ preventDefault() {} });
  assert.deepEqual(requests[1].body, { email: "tester@example.com", pin: "001234" });
  assert.equal(context.verificationDialog.open, false);
  assert.equal(context.state.mode, "login");
  assert.match(context.authStatus.textContent, /activated/);
  assert.equal(context.state.token, null);
});

test("invalid PIN keeps entry open and allows retry", async () => {
  const button = element();
  const context = vm.createContext({
    verificationDialog: element(), verificationEmail: { value: "tester@example.com" },
    verificationPin: { value: "123456" }, verificationStatus: element(),
    verificationForm: { querySelector() { return button; } },
    api: async () => { throw new Error("Invalid or expired PIN"); },
  });
  context.verificationDialog.open = true;
  vm.runInContext(auth, context);
  await context.confirmEmailPin({ preventDefault() {} });
  assert.equal(context.verificationDialog.open, true);
  assert.equal(button.disabled, false);
  assert.match(context.verificationStatus.textContent, /Invalid/);
});

test("feedback handles flag, saves only the entered feedback, and retains failed submissions", async () => {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const context = vm.createContext({
    document: { querySelector: node }, state: { token: "test-token" },
    closeSidebar() {}, authHeaders: () => ({ Authorization: "Bearer test-token" }),
  });
  vm.runInContext(feedback, context);
  context.api = async () => ({ enabled: false });
  await context.loadFeedbackConfig();
  assert.equal(node("#feedback-button").classList.contains("hidden"), true);
  context.api = async () => ({ enabled: true });
  await context.loadFeedbackConfig();
  assert.equal(node("#feedback-button").classList.contains("hidden"), false);
  node("#feedback-message").value = "The map did not open";
  node("#feedback-category").value = "bug";
  context.api = async (path, options) => {
    assert.equal(path, "/feedback");
    assert.deepEqual(JSON.parse(options.body), { category: "bug", message: "The map did not open" });
    throw new Error("Connection lost");
  };
  await node("#feedback-form").submit({ preventDefault() {} });
  assert.equal(node("#feedback-form").resetCalled, undefined);
  assert.equal(node("#feedback-submit").disabled, false);
  assert.equal(node("#feedback-message").value, "The map did not open");
  context.api = async () => ({ detail: "Feedback saved" });
  await node("#feedback-form").submit({ preventDefault() {} });
  assert.equal(node("#feedback-form").resetCalled, true);
  assert.equal(node("#feedback-status").textContent, "Feedback saved");
});
