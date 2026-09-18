// Runtime smoke test for the actual script order, without network or a browser.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const root = join(__dirname, "../website");
const html = readFileSync(join(root, "index.html"), "utf8");

function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, value: "", textContent: "", options: [],
    style: { setProperty() {} },
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force = !classes.has(name)) { force ? classes.add(name) : classes.delete(name); return force; },
    },
    setAttribute() {}, removeAttribute() {}, addEventListener() {}, focus() {},
    append(...nodes) { this.children.push(...nodes); }, after() {}, replaceChildren(...nodes) { this.children = nodes; },
    querySelector() { return element(); },
    querySelectorAll(selector) { return this.children.flatMap(node => [node, ...(node.querySelectorAll?.(selector) || [])]); },
  };
}

test("embedded page initializes without requesting views, scripts, or styles", async () => {
  const nodes = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match => [match[1], element()]));
  nodes.get("topic-category").options = ["person", "trait", "experience", "other"].map(value => ({ value, textContent: value }));
  nodes.get("topic-category").value = "other";
  const document = {
    documentElement: element(), title: "FeelY", addEventListener() {},
    querySelector(selector) {
      if (selector.startsWith("#")) {
        assert.ok(nodes.has(selector.slice(1)), `Missing HTML element ${selector}`);
        return nodes.get(selector.slice(1));
      }
      return element();
    },
    querySelectorAll() { return []; }, createElement: element,
  };
  const context = vm.createContext({
    document, URL, URLSearchParams, Event, console, setTimeout, clearTimeout,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: async (url) => {
      assert.ok(url.includes("/api/v1/"), `Unexpected startup file download: ${url}`);
      return { ok: true, status: 200, text: async () => '{"enabled":false}', headers: { get() { return "application/json"; } } };
    },
    window: {
      location: new URL("http://127.0.0.1/"), innerHeight: 800,
      addEventListener() {}, history: { replaceState() {} },
    },
  });
  for (const [, name, source] of html.matchAll(/<script data-app-source="([^"]+)">([\s\S]*?)<\/script>/g)) {
    vm.runInContext(source, context, { filename: name });
  }
  // Await directly so startup's user-facing fallback cannot hide a runtime error.
  await vm.runInContext("init()", context);
  assert.equal(nodes.get("auth-view").classList.contains("hidden"), false);
  assert.equal(typeof context.renderMap, "function");
  assert.equal(typeof context.loadJournalWorkspace, "function");
  assert.equal(typeof context.primaryEntryCategory, "function");
});
