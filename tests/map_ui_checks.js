// Run in the browser console against tests/map_ui_server.py only.
// Exercises the real UI handlers and HTTP API; AI previews use the fixture model.
window.runMapUIChecks = async function () {
  if (location.hostname !== "127.0.0.1" || location.port !== "8767" || state.user?.username !== "map_ui") {
    throw new Error("Use the isolated map UI fixture, never a real account.");
  }
  const passed = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const wait = async (condition, message) => {
    const deadline = Date.now() + 8000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  };
  const button = (text, root = document) => {
    const found = [...root.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
    assert(found, `Missing button: ${text}`);
    return found;
  };
  const field = (name) => document.querySelector(`.map-action-popup [name='${name}']`);
  const set = (name, value) => {
    const element = field(name);
    assert(element, `Missing field: ${name}`);
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const topic = (id) => state.map.topic_spaces.find((item) => item.id === id);
  const allEntries = () => [...state.map.unassigned_entries, ...state.map.topic_spaces.flatMap((item) => item.entries)];
  const open = (id) => {
    button("Everything", document.querySelector(".map-topic-filters")).click();
    const title = id === OVERALL_MAP_NODE_ID ? OVERALL_MAP_TITLE : topic(id)?.title;
    const node = [...document.querySelectorAll(".map-node")].find((item) => item.title === title);
    assert(node, `Missing topic ${id}`);
    node.click();
  };
  const edit = (id) => { open(id); button("Edit & connect", document.querySelector(".map-node-detail")).click(); };
  const save = async () => {
    document.querySelector(".map-action-form").requestSubmit();
    await wait(() => !document.querySelector(".map-action-backdrop"), "Map form did not save: " + document.querySelector(".map-form-error")?.textContent);
  };
  const create = async (title, category = "other") => {
    document.querySelector("#add-topic-button").click();
    set("topic_title", title); set("topic_category", category);
    set("topic_description", "A short description for the browser test.");
    await save();
    return state.map.topic_spaces.find((item) => item.title === title).id;
  };
  const originalConfirm = window.confirm;
  window.confirm = () => true;
  try {
    await loadMap();
    edit("legacy-person");
    const longDescription = field("topic_description").value;
    assert(longDescription.length > 1000, "Fixture needs an old long description");
    assert(field("topic_description").maxLength >= longDescription.length, "Old description exceeds edit limit");
    set("topic_title", "Girlfriend");
    const personChoice = document.querySelector(".map-action-popup .topic-type-choices input[value='person']");
    assert(personChoice && !personChoice.disabled, "Topic type must be usable when editing");
    personChoice.closest("label").click();
    assert(personChoice.checked && field("topic_category").value === "person", "Type choice did not update the saved value");
    await save();
    await loadMap();
    assert(topic("legacy-person").category === "person", "Category did not persist");
    assert(topic("legacy-person").description === longDescription.trim(), "Description lost while editing");
    edit("legacy-person");
    assert(document.querySelector(".topic-type-choices input[value='person']").checked, "Saved type must be selected when reopening");
    closeMapActionPopup();
    passed.push("Legacy topic edit, category change, and persistence");

    const trip = await create("First trip", "experience");
    edit(trip);
    set("parent_topic_id", "healing");
    const relation = [...document.querySelectorAll(".map-related-picker input")].find((input) => input.value === "curious");
    relation.checked = true;
    await save();
    assert(topic(trip).parent_topic_id === "healing", "Parent was not saved");
    assert(topic("curious").related_topic_ids.includes(trip), "Reciprocal connection missing");
    passed.push("Create topic, parent connection, related connection");

    edit("healing"); set("parent_topic_id", trip);
    document.querySelector(".map-action-form").requestSubmit();
    await wait(() => document.querySelector(".map-form-error")?.textContent.includes("cycle"), "Invalid parent cycle error was not visible");
    assert(field("parent_topic_id").value === trip, "Failed save discarded inputs");
    set("parent_topic_id", ""); await save();
    passed.push("Failed save stays open with error and supports retry");

    open(trip);
    const disconnect = [...document.querySelectorAll(".map-topic-connection-row")].find((row) => row.textContent.includes("Curious"));
    disconnect.querySelector(".map-topic-connection-remove").click();
    await wait(() => !topic(trip).related_topic_ids.includes("curious"), "Disconnect failed");
    assert(!topic("curious").related_topic_ids.includes(trip), "Disconnect left a backlink");
    passed.push("Disconnect updates both topics");

    open(trip); button("+ Entry", document.querySelector(".map-node-detail")).click();
    document.querySelector("[aria-label='Entry type']").value = "value";
    set("entry_text", "A saved observation from the browser test."); await save();
    const entry = topic(trip).entries[0];
    document.querySelector(".map-entry-menu-button").click();
    button("Edit", document.querySelector(".map-entry-menu")).click();
    set("entry_text", "An edited observation from the browser test."); set("topic_space_id", "curious");
    await save();
    assert(topic("curious").entries.some((item) => item.id === entry.id), "Entry was not moved");
    open("curious"); document.querySelector(".map-entry-menu-button").click();
    button("Delete", document.querySelector(".map-entry-menu")).click();
    await wait(() => !allEntries().some((item) => item.id === entry.id), "Entry delete failed");
    passed.push("Create, edit, move, and delete a saved entry");

    open(trip); button("+ Practice", document.querySelector(".map-node-detail")).click();
    set("entry_text", "Take a short walk."); await save();
    const practice = topic(trip).entries.find((item) => item.category === "practice");
    button("Pause", document.querySelector(".map-task-actions")).click();
    await wait(() => topic(trip).entries[0].status === "paused", "Pause failed");
    button("Resume", document.querySelector(".map-task-actions")).click();
    await wait(() => topic(trip).entries[0].status === "active", "Resume failed");
    button("Complete", document.querySelector(".map-task-actions")).click();
    practiceReflection.value = "It gave me room to think.";
    reflectionForm.requestSubmit();
    await wait(() => topic(trip).entries[0].status === "completed", "Complete failed");
    assert(topic(trip).entries[0].reflection === "It gave me room to think.", "Reflection lost");
    button("Practice again", document.querySelector(".map-task-actions")).click();
    await wait(() => topic(trip).entries[0].status === "active", "Reactivate failed");
    passed.push("Practice creation, pause, resume, reflection, completion, reactivation");

    edit(trip);
    const target = document.querySelector("[aria-label='Topic to merge into']");
    target.value = "healing"; target.dispatchEvent(new Event("change"));
    button("Merge into selected topic").click();
    await wait(() => !topic(trip), "Merge failed");
    assert(topic("healing").entries.some((item) => item.id === practice.id), "Merge lost the practice");
    assert(topic("healing").entries.some((item) => item.category === "merged_topic"), "Merge lost original topic context");
    passed.push("Merge preserves entries and original topic context");

    const removable = await create("Delete me");
    open(removable); button("+ Entry", document.querySelector(".map-node-detail")).click();
    set("entry_text", "Keep this after topic deletion."); await save();
    const retained = topic(removable).entries[0].id;
    button("Delete", document.querySelector(".map-title-actions")).click();
    await wait(() => !topic(removable), "Topic delete failed");
    assert(state.map.unassigned_entries.some((item) => item.id === retained), "Topic deletion lost an entry");
    passed.push("Topic deletion moves observations into Overall");

    for (const [label, category] of [["People", "person"], ["Traits", "trait"], ["Experiences", "experience"], ["Other", "other"]]) {
      button(label, document.querySelector(".map-topic-filters")).click();
      assert([...document.querySelectorAll(".map-node")].every((node) => node.dataset.topicCategory === category), "Filter mismatch: " + label);
    }
    open("legacy-person");
    document.querySelector(".map-connected-chats button").click();
    await wait(() => state.activeChatId === "fixture-chat" && !conversationView.classList.contains("hidden"), "Connected chat did not open");
    document.querySelector("#map-workspace-button").click(); await loadMap(); open("legacy-person");
    document.querySelector(".map-connected-journals button").click();
    await wait(() => state.activeJournalDate === "2026-09-01" && !journalView.classList.contains("hidden"), "Connected journal did not open");
    document.querySelector("#map-workspace-button").click(); await loadMap();
    passed.push("All filters, connected chat, and connected journal navigation");

    button("Debug: update old topics").click(); button("Generate preview").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("ready for review"), "Preview did not finish");
    const before = JSON.stringify(state.map);
    document.querySelector("[aria-label='Close preview']").click();
    await loadMap(); assert(JSON.stringify(state.map) === before, "Preview cancel mutated the map");
    button("Debug: update old topics").click(); button("Generate preview").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("ready for review"), "Second preview did not finish");
    for (const row of document.querySelectorAll(".map-refresh-row")) {
      if (row.dataset.topicId === "legacy-person") continue;
      row.querySelector("[name='include_topic']").click();
    }
    button("Apply selected updates").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("1 topics updated"), "Preview apply failed");
    assert(topic("legacy-person").description.length < 240, "Preview not applied");
    assert(topic("legacy-person").entries[0].id === "legacy-entry", "Refresh lost observations");
    button("Undo this update").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("restored"), "Undo failed");
    assert(topic("legacy-person").description === longDescription.trim(), "Undo did not restore description");
    document.querySelector("[aria-label='Close preview']").click();
    passed.push("Debug preview, cancel, selected apply, preserved contents, undo");
    return { passed, success: true };
  } catch (error) {
    return { passed, success: false, error: error.message, stack: error.stack };
  } finally {
    window.confirm = originalConfirm;
  }
};

window.runMapUIFailureChecks = async function () {
  if (location.port !== "8767" || state.user?.username !== "map_ui") throw new Error("Use the local fixture.");
  const passed = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (condition) => {
    for (let i = 0; i < 200; i += 1) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    throw new Error("Timed out waiting for error handling");
  };
  const button = (text) => [...document.querySelectorAll(".map-action-popup button, .map-toolbar button")].find((item) => item.textContent === text);
  const originalFetch = window.fetch;
  try {
    await loadMap();
    const old = state.map.topic_spaces.find((topic) => topic.id === "legacy-person");
    openMapTopicPopup(old);
    const input = document.querySelector("[name='topic_title']");
    input.value = "Unsaved edit";
    window.fetch = async (url, options) => {
      if (String(url).endsWith("/map/topics/legacy-person") && options?.method === "PATCH") throw new TypeError("Fixture connection failure");
      return originalFetch(url, options);
    };
    document.querySelector(".map-action-form").requestSubmit();
    await wait(() => document.querySelector(".map-form-error")?.textContent.includes("connection"));
    assert(document.querySelector("[name='topic_title']").value === "Unsaved edit", "Network failure lost the edit");
    assert(!button("Save topic").disabled, "Retry stayed disabled");
    window.fetch = originalFetch;
    input.value = old.title;
    document.querySelector(".map-action-form").requestSubmit();
    await wait(() => !document.querySelector(".map-action-popup"));
    passed.push("Network failure retains inputs and permits retry");

    const failedTopic = await api("/users/me/map/topics", {method: "POST", headers: authHeaders(), body: JSON.stringify({title: "Fail preview"})});
    await loadMap();
    button("Debug: update old topics").click(); button("Generate preview").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("ready for review"));
    assert(document.querySelector(".map-refresh-rows .map-form-error")?.textContent.includes("Fixture model unavailable"), "Model error not shown");
    assert(document.querySelectorAll(".map-refresh-row").length === state.map.topic_spaces.length - 1, "Failed model preview produced an editable proposal");
    passed.push("Partial model failure keeps successful previews and names the failure");

    await api("/users/me/map/topics/curious", {method: "PATCH", headers: authHeaders(), body: JSON.stringify({description: "Changed in another session."})});
    button("Apply selected updates").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("map changed"));
    const latest = await api("/users/me/map", {headers: authHeaders()});
    assert(latest.topic_spaces.find((topic) => topic.id === "legacy-person").description.length > 1000, "Stale preview overwrote the map");
    passed.push("Stale preview rejects the whole update without partial changes");
    document.querySelector("[aria-label='Close preview']").click();
    await api(`/users/me/map/topics/${failedTopic.topic.id}`, {method: "DELETE", headers: authHeaders()});
    await loadMap();

    button("Debug: update old topics").click(); button("Generate preview").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("ready for review"));
    document.querySelectorAll("[name='include_topic']").forEach((input) => input.click());
    button("Apply selected updates").click();
    assert(document.querySelector(".map-refresh-status").textContent.includes("Select at least one"), "Empty selection was not explained");
    const row = document.querySelector(".map-refresh-row[data-topic-id='legacy-person']");
    row.querySelector("[name='include_topic']").click();
    row.querySelector("[name='refresh_title']").value = "Partner";
    row.querySelector("textarea").value = "You feel supported.";
    button("Apply selected updates").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("1 topics updated"));
    assert(state.map.topic_spaces.find((topic) => topic.id === "legacy-person").title === "Partner", "Edited preview was ignored");
    button("Undo this update").click();
    await wait(() => document.querySelector(".map-refresh-status")?.textContent.includes("restored"));
    document.querySelector("[aria-label='Close preview']").click();
    passed.push("Empty selection, edited preview, and undo");

    openMapTopicPopup(state.map.topic_spaces[0]);
    const popup = document.querySelector(".map-action-popup");
    const focusable = [...popup.querySelectorAll("button, input, select, textarea")].filter((element) => !element.disabled && element.getClientRects().length);
    focusable.at(-1).focus();
    focusable.at(-1).dispatchEvent(new KeyboardEvent("keydown", {key: "Tab", bubbles: true, cancelable: true}));
    assert(document.activeElement === focusable[0], "Tab escaped the popup");
    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true}));
    assert(!document.querySelector(".map-action-popup"), "Escape did not close popup");
    passed.push("Popup keyboard focus stays inside and Escape closes it");
    return {success: true, passed};
  } catch (error) {
    return {success: false, passed, error: error.message};
  } finally {
    window.fetch = originalFetch;
  }
};
