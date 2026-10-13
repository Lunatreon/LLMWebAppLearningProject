// Exercise the real view loader and application scripts in their browser order.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const root = join(__dirname, "../website");
const html = readFileSync(join(root, "index.html"), "utf8");
const loader = readFileSync(join(root, "js/load-views.js"), "utf8");

function element() {
  const classes = new Set();
  return {
    children: [], dataset: {}, value: "", textContent: "", options: [], hidden: false,
    attributes: {}, listeners: {}, style: { setProperty() {} },
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      contains(name) { return classes.has(name); },
      toggle(name, force = !classes.has(name)) { force ? classes.add(name) : classes.delete(name); return force; },
    },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute() {},
    addEventListener(name, listener) { this.listeners[name] = listener; }, focus() {}, remove() {},
    append(...nodes) { this.children.push(...nodes); }, after() {}, replaceChildren(...nodes) { this.children = nodes; },
    querySelector() { return element(); }, querySelectorAll() { return []; },
  };
}

function fixture({ viewResponse, failScript, executeScripts = false } = {}) {
  const nodes = new Map();
  const addNodes = markup => {
    for (const [, id] of markup.matchAll(/\bid="([^"]+)"/g)) nodes.set(id, element());
    if (nodes.has("topic-category")) {
      nodes.get("topic-category").options = ["person", "trait", "experience", "other"].map(value => ({ value, textContent: value }));
      nodes.get("topic-category").value = "other";
    }
  };
  addNodes(html);
  nodes.get("app-loading-retry").hidden = true;
  const shell = element();
  shell.hidden = true;
  const loadedScripts = [];
  const requestedViews = [];
  const mountedViews = [];
  const errors = [];
  const placeholders = [...html.matchAll(/data-view="([^"]+)"/g)].map(([, name]) => ({
    dataset: { view: name },
    replaceWith(content) { mountedViews.push(name); addNodes(content.markup); },
  }));
  const document = {
    documentElement: element(), title: "FeelY", addEventListener() {},
    querySelector(selector) {
      if (selector === "[data-app-shell]") return shell;
      if (selector.startsWith("#")) {
        assert.ok(nodes.has(selector.slice(1)), `Missing HTML element ${selector}`);
        return nodes.get(selector.slice(1));
      }
      return element();
    },
    querySelectorAll(selector) { return selector === "template[data-view]" ? placeholders : []; },
    createElement(tag) {
      if (tag !== "template") return element();
      return {
        set innerHTML(markup) {
          this.content = { markup, querySelector() { return /<(script|style)\b|data-view=/.test(markup) ? {} : null; } };
        },
      };
    },
    head: { append(script) {
      queueMicrotask(() => {
        if (script.src === failScript) { script.onerror(); return; }
        assert.equal(mountedViews.length, placeholders.length, "Scripts started before every view was mounted");
        loadedScripts.push(script.src);
        try {
          if (executeScripts) vm.runInContext(readFileSync(join(root, script.src), "utf8"), context, { filename: script.src });
          script.onload();
        } catch (error) { errors.push(error); script.onerror(); }
      });
    } },
  };
  const location = new URL("http://127.0.0.1/");
  let reloaded = false;
  location.reload = () => { reloaded = true; };
  const context = vm.createContext({
    document, URL, URLSearchParams, Event, AbortController, setTimeout, clearTimeout,
    console: { ...console, error: (...args) => errors.push(args) },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: async (url, options) => {
      if (url.startsWith("views/")) {
        requestedViews.push(url);
        assert.equal(options.cache, "no-cache");
        if (viewResponse) return viewResponse(url, options);
        return response(readFileSync(join(root, url), "utf8"));
      }
      assert.ok(url.includes("/api/v1/"), `Unexpected request: ${url}`);
      return response('{"enabled":false}', "application/json");
    },
    window: { location, innerHeight: 800, addEventListener() {}, history: { replaceState() {} } },
  });
  vm.runInContext(loader, context);
  return { context, nodes, shell, loadedScripts, requestedViews, mountedViews, errors,
    ready: context.window.feelyReady, wasReloaded: () => reloaded };
}

function response(body, type = "text/html", ok = true) {
  return { ok, status: ok ? 200 : 404, headers: { get: () => type }, text: async () => body };
}

test("views mount before the real application scripts initialize", async () => {
  const f = fixture({ executeScripts: true });
  assert.equal(await f.ready, true, JSON.stringify(f.errors));
  await vm.runInContext("init()", f.context);
  assert.equal(f.loadedScripts[0], "app.js");
  assert.equal(f.loadedScripts.at(-1), "js/start.js");
  assert.equal(f.shell.hidden, false);
  assert.equal(f.nodes.get("app-loading").hidden, true);
  assert.equal(f.nodes.get("auth-view").classList.contains("hidden"), false);
  assert.equal(typeof f.context.renderMap, "function");
  assert.equal(typeof f.context.loadJournalWorkspace, "function");
  assert.equal(f.errors.length, 0);
});

test("startup waits for slow views before loading any application script", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ viewResponse: async name => {
    await gate;
    return response(readFileSync(join(root, name), "utf8"));
  } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.loadedScripts.length, 0);
  assert.equal(f.shell.hidden, true);
  release();
  assert.equal(await f.ready, true);
});

test("temporary gateway errors recover before application startup", async () => {
  const attempts = new Map();
  const f = fixture({ executeScripts: true, viewResponse: async name => {
    const attempt = (attempts.get(name) || 0) + 1;
    attempts.set(name, attempt);
    if (attempt < 3) return { ...response("Bad Gateway", "text/html", false), status: 502 };
    return response(readFileSync(join(root, name), "utf8"));
  } });
  assert.equal(await f.ready, true);
  assert.equal(f.shell.hidden, false);
  assert.ok([...attempts.values()].every(count => count === 3));
  assert.equal(f.loadedScripts.filter(name => name === "app.js").length, 1);
});

test("persistent gateway errors stop after six attempts", async () => {
  const attempts = new Map();
  const f = fixture({ viewResponse: async name => {
    attempts.set(name, (attempts.get(name) || 0) + 1);
    return { ...response("Bad Gateway", "text/html", false), status: 502 };
  } });
  assert.equal(await f.ready, false);
  assert.equal(f.loadedScripts.length, 0);
  assert.equal(Math.max(...attempts.values()), 6);
  assert.equal(f.nodes.get("app-loading-retry").hidden, false);
});

test("missing files are not retried", async () => {
  const f = fixture({ viewResponse: async () => response("Not found", "text/html", false) });
  assert.equal(await f.ready, false);
  assert.equal(new Set(f.requestedViews).size, f.requestedViews.length);
});

for (const [name, viewResponse] of [
  ["missing view", async () => response("Not found", "text/html", false)],
  ["network failure", async () => { throw new TypeError("Offline"); }],
  ["HTML fallback page", async () => response("<!doctype html><html>Fallback</html>")],
  ["wrong content type", async () => response("{}", "application/json")],
  ["script inside a view", async () => response("<script>bad()</script>")],
]) {
  test(`${name} shows retry without starting a partial app`, async () => {
    const f = fixture({ viewResponse });
    assert.equal(await f.ready, false);
    assert.equal(f.loadedScripts.length, 0);
    assert.equal(f.mountedViews.length, 0);
    assert.equal(f.shell.hidden, true);
    assert.equal(f.nodes.get("app-loading-retry").hidden, false);
    assert.equal(f.nodes.get("app-loading").attributes.role, "alert");
    f.nodes.get("app-loading-retry").listeners.click();
    assert.equal(f.wasReloaded(), true);
  });
}

test("failed script stops startup before the event handlers are registered", async () => {
  const f = fixture({ failScript: "js/auth.js" });
  assert.equal(await f.ready, false);
  assert.equal(f.loadedScripts.includes("js/start.js"), false);
  assert.equal(f.shell.hidden, true);
  assert.equal(f.nodes.get("app-loading-retry").hidden, false);
});
