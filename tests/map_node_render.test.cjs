// Run with: node --test tests/map_node_render.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../website/js/map.js"), "utf8").replace(/\r\n/g, "\n");
function appFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing map function: ${name}`);
  const end = source.indexOf("\n}\n", start);
  assert.ok(end > start, `Missing function boundary: ${name}`);
  return source.slice(start, end + 3);
}

function element() {
  return {
    dataset: {}, children: [], attributes: {}, listeners: {},
    classList: { toggle() {}, add() {} }, style: { setProperty() {} },
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
  };
}

test("map nodes render with empty or saved entries and open on click", () => {
  const context = vm.createContext({
    document: { createElement: element },
    state: { activeMapNodeId: null, mapDetailOpen: false },
    OVERALL_MAP_NODE_ID: "overall",
    renderMap() { context.rendered = true; },
  });
  vm.runInContext([
    "entryCategoryCounts", "primaryEntryCategory", "mapNodePosition", "createConceptNode",
  ].map(appFunction).join("\n"), context);

  for (const entries of [undefined, [], [{ category: "value" }, { category: "practice" }, { category: "value" }]]) {
    const node = context.createConceptNode({ id: "topic", title: "Healing", entries }, 1);
    assert.equal(node.dataset.category, entries?.length ? "value" : "own_perception");
    assert.equal(node.children[0].textContent, "Healing");
    assert.equal(node.attributes["aria-label"], "Open Healing");
    node.listeners.click();
    assert.equal(context.state.activeMapNodeId, "topic");
    assert.equal(context.state.mapDetailOpen, true);
    assert.equal(context.rendered, true);
  }
});

test("map debug button is rendered only for admin and test accounts", () => {
  const mapContent = element();
  const context = vm.createContext({
    document: { createElement: element, createElementNS: element },
    state: { map: { topic_spaces: [], unassigned_entries: [] }, mapFilter: "all", user: null },
    OVERALL_MAP_NODE_ID: "overall", OVERALL_MAP_TITLE: "Overall", mapContent,
    hasMyMapAccess: () => true,
  });
  vm.runInContext(source, context);
  context.renderMapSidebar = () => {};
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)]);
  for (const role of [undefined, "member", "test", "admin"]) {
    context.state.user = { role };
    context.renderMap();
    assert.equal(descendants(mapContent).some(node => node.textContent === "Debug: update old topics"),
      role === "test" || role === "admin");
  }
  context.state.user = { role: "member" };
  // Calling the UI handler directly must also stop before mounting a preview.
  assert.doesNotThrow(() => context.openMapRefreshPopup());
});
