// FeelY map: see website/EDITING.md for file responsibilities and load order.

async function loadMap() {
  if (!hasMyMapAccess()) {
    state.map = null;
    renderMap();
    return;
  }
  state.map = await api("/users/me/map", { headers: authHeaders() });
  renderMap();
  if (state.pendingTopic) renderTopic(state.pendingTopic);
  if (state.pendingMapSuggestion) renderMapSuggestion(state.pendingMapSuggestion);
}

function orderedMapTopics(spaces) {
  const topicIds = new Set(spaces.map((space) => space.id));
  const childrenByParent = new Map();
  spaces.forEach((space) => {
    const parentId = topicIds.has(space.parent_topic_id) ? space.parent_topic_id : null;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(space);
  });

  const ordered = [];
  const visited = new Set();
  const addBranch = (space, depth) => {
    if (visited.has(space.id)) return;
    visited.add(space.id);
    ordered.push({ space, depth });
    (childrenByParent.get(space.id) || []).forEach((child) => addBranch(child, depth + 1));
  };
  (childrenByParent.get(null) || []).forEach((space) => addBranch(space, 0));
  spaces.forEach((space) => addBranch(space, 0));
  return ordered;
}

function overallMapNode(map = state.map) {
  const entries = map?.unassigned_entries || [];
  return {
    id: OVERALL_MAP_NODE_ID,
    kind: "unassigned",
    title: OVERALL_MAP_TITLE,
    description:
      "A permanent home for observations, values, evidence, and practices that matter across several topics.",
    chat_ids: [...new Set(entries.map((entry) => entry.source_chat_id).filter(Boolean))],
    journal_dates: [
      ...new Set(entries.map((entry) => entry.source_journal_date).filter(Boolean)),
    ],
    entries,
    position: mapNodePosition(0),
  };
}

function appendMapSidebarTopic(space, depth = 0, { overall = false } = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-topic-button";
  button.classList.toggle("overall", overall);
  button.classList.toggle("active", space.id === state.activeMapNodeId);
  button.style.setProperty("--topic-indent", `${Math.min(depth, 5) * 14}px`);
  button.setAttribute("aria-current", space.id === state.activeMapNodeId ? "page" : "false");

  const title = document.createElement("strong");
  title.textContent = space.title || "Untitled topic";
  const meta = document.createElement("span");
  const chats = space.chat_ids?.length || 0;
  const journals = space.journal_dates?.length || 0;
  const entries = space.entries?.length || 0;
  meta.textContent = `${chats} ${chats === 1 ? "chat" : "chats"} · ${journals} ${journals === 1 ? "journal" : "journals"} · ${entries} ${entries === 1 ? "entry" : "entries"}`;
  button.title = `${title.textContent} — ${meta.textContent}`;
  button.append(title, meta);
  button.addEventListener("click", () => {
    state.activeMapNodeId = space.id;
    state.mapDetailOpen = true;
    renderMap();
    closeSidebar();
  });
  mapTopicList.append(button);
}

function renderMapSidebar() {
  const allowed = hasMyMapAccess();
  mapSidebarAccess.classList.toggle("hidden", !allowed);
  mapSidebarLocked.classList.toggle("hidden", allowed);
  mapTopicList.replaceChildren();

  const spaces = allowed ? state.map?.topic_spaces || [] : [];
  mapTopicCount.textContent = String(allowed ? spaces.length + 1 : 0);
  if (!allowed) return;

  appendMapSidebarTopic(overallMapNode(), 0, { overall: true });

  orderedMapTopics(spaces).forEach(({ space, depth }) => {
    appendMapSidebarTopic(space, depth);
  });
}

const TOPIC_CATEGORIES = {
  person: { label: "Person", plural: "People" },
  trait: { label: "Trait", plural: "Traits" },
  experience: { label: "Experience", plural: "Experiences" },
  other: { label: "Other", plural: "Other" },
};

function fillEntryCategorySelect(select, selected = "own_perception") {
  select.replaceChildren();
  Object.entries(MAP_CATEGORY_LABELS).filter(([value]) => value !== "merged_topic").forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
  select.value = Object.hasOwn(MAP_CATEGORY_LABELS, selected) && selected !== "merged_topic" ? selected : "own_perception";
}

function topicCategoryOf(topic) {
  return Object.hasOwn(TOPIC_CATEGORIES, topic.category) ? topic.category : "other";
}

let topicTypePickerId = 0;

function enhanceTopicCategorySelect(select) {
  const choices = document.createElement("div");
  choices.className = "topic-type-choices";
  choices.setAttribute("role", "radiogroup");
  choices.setAttribute("aria-label", "Topic type");
  const name = `topic_type_${++topicTypePickerId}`;
  [...select.options].forEach((option) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;
    const text = document.createElement("span");
    text.textContent = option.textContent;
    input.addEventListener("change", () => {
      if (!input.checked) return;
      select.value = input.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    label.append(input, text);
    choices.append(label);
  });
  select.syncChoices = () => {
    choices.querySelectorAll("input").forEach((input) => {
      input.checked = input.value === select.value;
      input.disabled = select.disabled;
    });
  };
  select.addEventListener("change", select.syncChoices);
  select.hidden = true;
  select.after(choices);
  select.syncChoices();
}

function createTopicCategorySelect(category = "other") {
  const label = document.createElement("div");
  label.className = "map-action-field";
  label.textContent = "Topic type";
  const select = document.createElement("select");
  select.name = "topic_category";
  Object.entries(TOPIC_CATEGORIES).forEach(([value, { label: name }]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = name;
    select.append(option);
  });
  select.value = category;
  label.append(select);
  enhanceTopicCategorySelect(select);
  return label;
}

function createTopicConnections(selectedIds = [], excludedId = null) {
  const fieldset = document.createElement("fieldset");
  fieldset.className = "map-related-picker";
  const legend = document.createElement("legend");
  legend.textContent = "Connect related topics";
  fieldset.append(legend);
  (state.map?.topic_spaces || []).forEach((space) => {
    if (space.id === excludedId) return;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = space.id;
    input.checked = selectedIds.includes(space.id);
    label.append(input, document.createTextNode(space.title));
    fieldset.append(label);
  });
  fieldset.classList.toggle("hidden", fieldset.children.length === 1);
  return fieldset;
}

function primaryEntryCategory(entries) {
  const counts = entryCategoryCounts(entries);
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || "own_perception";
}

function mapNodePosition(index) {
  const positions = [
    [50, 50],
    [23, 27],
    [78, 34],
    [28, 72],
    [68, 74],
    [50, 20],
    [18, 52],
    [84, 58],
    [42, 82],
  ];
  const [x, y] = positions[index % positions.length];
  const lap = Math.floor(index / positions.length);
  return {
    x: Math.min(88, Math.max(12, x + lap * 4)),
    y: Math.min(84, Math.max(16, y + (lap % 2 ? -6 : 6))),
  };
}

// Mobile has room for two bubbles across. Grow the canvas instead of
// squeezing additional topics into the same positions.
function layoutMobileMap(nodes) {
  const hasOverall = nodes[0]?.id === OVERALL_MAP_NODE_ID;
  const positions = nodes.map((node, index) => {
    if (hasOverall && index === 0) return { x: 50, y: 64 };
    const slot = index - (hasOverall ? 1 : 0);
    return {
      x: slot % 2 ? 74 : 26,
      y: (hasOverall ? 184 : 64) + Math.floor(slot / 2) * 120 + (slot % 2) * 28,
    };
  });
  const height = Math.max(430, ...positions.map((position) => position.y + 76));
  nodes.forEach((node, index) => {
    node.position = { x: positions[index].x, y: positions[index].y / height * 100 };
  });
  return height;
}

function createConceptNode(node, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-node";
  button.classList.toggle("overall", node.id === OVERALL_MAP_NODE_ID);
  button.dataset.category = primaryEntryCategory(node.entries || []);
  button.title = node.title;
  button.setAttribute("aria-pressed", String(node.id === state.activeMapNodeId));
  button.setAttribute("aria-label", `Open ${node.title}`);
  const position = node.position || mapNodePosition(index);
  button.style.left = `${position.x}%`;
  button.style.top = `${position.y}%`;
  button.style.setProperty("--node-delay", `${index * 90}ms`);

  const title = document.createElement("strong");
  title.textContent = node.title;
  const meta = document.createElement("span");
  const entryCount = node.entries?.length || 0;
  const chatCount = node.chat_ids?.length || 0;
  const journalCount = node.journal_dates?.length || 0;
  const journalLabel = `${journalCount} ${journalCount === 1 ? "journal entry" : "journal entries"}`;
  const entryLabel = `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;
  meta.textContent =
    node.id === state.activeMapNodeId && !state.mapDetailOpen
      ? "Open details"
      : node.parent_title
        ? `Under ${node.parent_title} · ${journalLabel}`
        : `${chatCount} ${chatCount === 1 ? "chat" : "chats"} · ${journalLabel} · ${entryLabel}`;
  button.append(title, meta);

  button.addEventListener("click", () => {
    state.activeMapNodeId = node.id;
    state.mapDetailOpen = true;
    renderMap();
  });
  return button;
}

function createMapConnectionLayer(nodes) {
  const namespace = "http://www.w3.org/2000/svg";
  const layer = document.createElementNS(namespace, "svg");
  layer.classList.add("map-connection-layer");
  layer.setAttribute("viewBox", "0 0 100 100");
  layer.setAttribute("preserveAspectRatio", "none");
  layer.setAttribute("aria-hidden", "true");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const renderedRelations = new Set();

  const addLine = (source, target, type) => {
    if (!source?.position || !target?.position) return;
    const line = document.createElementNS(namespace, "line");
    line.classList.add("map-topic-link", `map-topic-link-${type}`);
    line.setAttribute("x1", source.position.x);
    line.setAttribute("y1", source.position.y);
    line.setAttribute("x2", target.position.x);
    line.setAttribute("y2", target.position.y);
    layer.append(line);
  };

  nodes.forEach((node) => {
    if (node.parent_topic_id) addLine(byId.get(node.parent_topic_id), node, "parent");
    (node.related_topic_ids || []).forEach((relatedId) => {
      const relationKey = [node.id, relatedId].sort().join(":");
      if (renderedRelations.has(relationKey)) return;
      renderedRelations.add(relationKey);
      addLine(node, byId.get(relatedId), "related");
    });
  });
  return layer;
}

async function createThreadMapEntry(node, category, text, topicSpaceId = undefined) {
  const response = await api("/users/me/map/entries", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      category,
      text,
      topic_space_id:
        topicSpaceId === undefined
          ? node.kind === "topic" ? node.id : null
          : topicSpaceId,
      source_chat_id: state.activeChatId,
    }),
  });
  state.map = response.map;
  state.activeMapNodeId =
    topicSpaceId || (node.kind === "topic" ? node.id : OVERALL_MAP_NODE_ID);
  renderMap();
}

async function updateMapEntry(entryId, payload) {
  const response = await api(`/users/me/map/entries/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  state.map = response.map;
  renderMap();
}

async function deleteMapEntry(entry) {
  if (!await confirmAction("Delete this map entry? This cannot be undone.")) return;
  const response = await api(`/users/me/map/entries/${encodeURIComponent(entry.id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  state.map = response.map;
  renderMap();
}

function mapTextPreview(text, limit = 86) {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  return {
    full: cleaned,
    preview: cleaned.length > limit ? `${cleaned.slice(0, limit - 3)}...` : cleaned,
    truncated: cleaned.length > limit,
  };
}

function entryCategoryCounts(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.category] = (counts[entry.category] || 0) + 1;
    return counts;
  }, {});
}

function closeMapActionPopup() {
  const backdrop = document.querySelector(".map-action-backdrop");
  if (backdrop?.dataset.busy === "true") return;
  backdrop?.remove();
  const focusTarget = backdrop?.returnFocus;
  if (focusTarget?.isConnected) focusTarget.focus();
  else mapContent.querySelector(".map-topic-filters button")?.focus();
}

function mountMapPopup(backdrop) {
  backdrop.returnFocus = document.activeElement;
  document.body.append(backdrop);
  backdrop.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...backdrop.querySelectorAll("button, input, select, textarea, [tabindex='0']")]
      .filter((element) => !element.disabled && element.getClientRects().length);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  });
}

async function saveMapPopup(form, save) {
  const backdrop = form.closest(".map-action-backdrop");
  if (backdrop.dataset.busy === "true") return;
  let error = form.querySelector(".map-form-error");
  if (!error) {
    error = document.createElement("p");
    error.className = "map-form-error";
    error.setAttribute("role", "alert");
    form.append(error);
  }
  error.textContent = "";
  backdrop.dataset.busy = "true";
  form.setAttribute("aria-busy", "true");
  const buttons = [...backdrop.querySelectorAll("button")];
  const disabled = buttons.map((button) => button.disabled);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    await save();
    backdrop.dataset.busy = "false";
    closeMapActionPopup();
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : String(failure);
    error.scrollIntoView({ block: "nearest" });
  } finally {
    backdrop.dataset.busy = "false";
    form.removeAttribute("aria-busy");
    buttons.forEach((button, index) => { button.disabled = disabled[index]; });
  }
}

function openMapTopicPopup(topic = null) {
  closeMapActionPopup();
  const isEdit = Boolean(topic);
  const backdrop = document.createElement("div");
  backdrop.className = "map-action-backdrop";

  const popup = document.createElement("section");
  popup.className = "map-action-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.setAttribute("aria-label", isEdit ? "Edit topic" : "Add topic");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "map-action-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", closeMapActionPopup);

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Self-authorship map";

  const title = document.createElement("h3");
  title.textContent = isEdit ? "Edit topic" : "Add a topic";

  const form = document.createElement("form");
  form.className = "map-action-form";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.name = "topic_title";
  titleInput.required = true;
  titleInput.maxLength = 120;
  titleInput.placeholder = "Dad, Curious, Healing...";
  titleInput.setAttribute("aria-label", "Topic name");
  titleInput.value = topic?.title || "";

  const descriptionInput = document.createElement("textarea");
  descriptionInput.name = "topic_description";
  descriptionInput.rows = 3;
  descriptionInput.maxLength = 2000;
  descriptionInput.placeholder = "A short note about what this means in your life";
  descriptionInput.setAttribute("aria-label", "Topic description");
  descriptionInput.value = topic?.description || "";

  const parentLabel = document.createElement("label");
  parentLabel.className = "map-action-field";
  const parentLabelText = document.createElement("span");
  parentLabelText.textContent = "Broader topic";
  const parentInput = document.createElement("select");
  parentInput.name = "parent_topic_id";
  const noParent = document.createElement("option");
  noParent.value = "";
  noParent.textContent = "No parent topic";
  parentInput.append(noParent);
  (state.map?.topic_spaces || []).forEach((space) => {
    if (space.id === topic?.id) return;
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.title;
    parentInput.append(option);
  });
  parentInput.value = topic?.parent_topic_id || "";
  parentLabel.append(parentLabelText, parentInput);

  const relatedFieldset = document.createElement("fieldset");
  relatedFieldset.className = "map-related-picker";
  const relatedLegend = document.createElement("legend");
  relatedLegend.textContent = "Connect related topics";
  relatedFieldset.append(relatedLegend);
  (state.map?.topic_spaces || []).forEach((space) => {
    if (space.id === topic?.id) return;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "related_topic_ids";
    input.value = space.id;
    input.checked = Boolean(topic?.related_topic_ids?.includes(space.id));
    const text = document.createElement("span");
    text.textContent = space.title;
    label.append(input, text);
    relatedFieldset.append(label);
  });
  if (relatedFieldset.children.length === 1) relatedFieldset.classList.add("hidden");

  let mergeField = null;
  if (isEdit && (state.map?.topic_spaces || []).length > 1) {
    mergeField = document.createElement("section");
    mergeField.className = "map-topic-merge";
    const mergeHeading = document.createElement("strong");
    mergeHeading.textContent = "Duplicate topic?";
    const mergeCopy = document.createElement("p");
    mergeCopy.textContent =
      "Move this topic’s chats, journals, and entries into another topic, then remove this bubble.";
    const mergeTarget = document.createElement("select");
    mergeTarget.setAttribute("aria-label", "Topic to merge into");
    const chooseTarget = document.createElement("option");
    chooseTarget.value = "";
    chooseTarget.textContent = "Choose the topic to keep";
    mergeTarget.append(chooseTarget);
    (state.map?.topic_spaces || []).forEach((space) => {
      if (space.id === topic.id) return;
      const option = document.createElement("option");
      option.value = space.id;
      option.textContent = space.title;
      mergeTarget.append(option);
    });
    const mergeButton = document.createElement("button");
    mergeButton.type = "button";
    mergeButton.className = "map-merge-button";
    mergeButton.textContent = "Merge into selected topic";
    mergeButton.disabled = true;
    mergeTarget.addEventListener("change", () => {
      mergeButton.disabled = !mergeTarget.value;
    });
    mergeButton.addEventListener("click", async () => {
      const target = (state.map?.topic_spaces || []).find(
        (space) => space.id === mergeTarget.value,
      );
      if (!target) return;
      if (
        !await confirmAction(
          `Merge “${topic.title}” into “${target.title}”? The second topic will be kept.`,
        )
      ) {
        return;
      }
      saveMapPopup(form, () => mergeMapTopic(topic.id, target.id));
    });
    mergeField.append(mergeHeading, mergeCopy, mergeTarget, mergeButton);
  }

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = isEdit ? "Save topic" : "Create topic";
  const categoryField = createTopicCategorySelect(topicCategoryOf(topic || {}));
  form.append(titleInput, categoryField, descriptionInput, parentLabel, relatedFieldset);
  if (mergeField) form.append(mergeField);
  form.append(submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const titleText = titleInput.value.trim();
    if (!titleText) return;
    const payload = {
      title: titleText,
      category: categoryField.querySelector("select").value,
      description: descriptionInput.value.trim(),
      parent_topic_id: parentInput.value || null,
      related_topic_ids: [...relatedFieldset.querySelectorAll("input:checked")].map(
        (input) => input.value,
      ),
    };
    saveMapPopup(form, () => isEdit
      ? updateMapTopic(topic.id, payload)
      : createMapTopic({ ...payload, chat_id: state.activeChatId }));
  });

  popup.append(closeButton, eyebrow, title, form);
  backdrop.append(popup);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeMapActionPopup();
  });
  mountMapPopup(backdrop);
  titleInput.focus();
}

async function createMapTopic(payload) {
  const response = await api("/users/me/map/topics", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  state.map = response.map;
  state.mapFilter = "all";
  state.activeMapNodeId = response.topic.id;
  state.mapDetailOpen = true;
  renderMap();
}

async function updateMapTopic(topicId, payload) {
  const response = await api(`/users/me/map/topics/${encodeURIComponent(topicId)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  state.map = response.map;
  state.mapFilter = "all";
  state.activeMapNodeId = response.topic.id;
  state.mapDetailOpen = true;
  renderMap();
}

async function disconnectMapTopicConnection(node, relationship, connectedTopic) {
  if (
    !await confirmAction(
      `Disconnect “${node.title}” and “${connectedTopic.title}”? Both topics and their contents will be kept.`,
    )
  ) {
    return;
  }

  const topicId = relationship === "Contains" ? connectedTopic.id : node.id;
  const payload =
    relationship === "Related"
      ? {
          related_topic_ids: (node.related_topic_ids || []).filter(
            (topicIdValue) => topicIdValue !== connectedTopic.id,
          ),
        }
      : { parent_topic_id: null };
  const response = await api(`/users/me/map/topics/${encodeURIComponent(topicId)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  state.map = response.map;
  state.activeMapNodeId = node.id;
  state.mapDetailOpen = true;
  renderMap();
}

async function mergeMapTopic(sourceTopicId, targetTopicId) {
  const response = await api(
    `/users/me/map/topics/${encodeURIComponent(sourceTopicId)}/merge`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ target_topic_space_id: targetTopicId }),
    },
  );
  state.map = response.map;
  state.mapFilter = "all";
  state.activeMapNodeId = response.topic.id;
  state.mapDetailOpen = true;
  renderMap();
}

async function deleteMapTopic(topic) {
  if (
    !await confirmAction(
      "Delete this topic? Its entries will move to Overall instead of being deleted.",
    )
  ) {
    return;
  }
  const response = await api(`/users/me/map/topics/${encodeURIComponent(topic.id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  state.map = response.map;
  state.activeMapNodeId = null;
  state.mapDetailOpen = false;
  renderMap();
}

function openMapActionPopup(node, mode, entry = null) {
  closeMapActionPopup();

  const isTask = mode === "task";
  const isEdit = mode === "edit";
  const isPracticeEdit = isEdit && entry?.category === "practice";
  const backdrop = document.createElement("div");
  backdrop.className = "map-action-backdrop";

  const popup = document.createElement("section");
  popup.className = "map-action-popup";
  popup.setAttribute("role", "dialog");
  popup.setAttribute("aria-modal", "true");
  popup.setAttribute("aria-label", isEdit ? "Edit entry" : isTask ? "Add practice" : "Add entry");

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "map-action-close";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", closeMapActionPopup);

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = node?.title || "Map entry";

  const title = document.createElement("h3");
  title.textContent = isPracticeEdit
    ? "Edit practice"
    : isEdit
      ? "Edit entry"
      : isTask
        ? "Add a practice"
        : "Add an entry";

  const form = document.createElement("form");
  form.className = "map-action-form";

  let categoryInput = null;
  if (!isTask && !isPracticeEdit) {
    categoryInput = document.createElement("select");
    categoryInput.setAttribute("aria-label", "Entry type");
    const entryCategories = [
      "own_perception",
      "value",
      "body_signal",
      "evidence",
      "inherited_script",
    ];
    if (entry?.category === "merged_topic") entryCategories.unshift("merged_topic");
    entryCategories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = MAP_CATEGORY_LABELS[category] || category;
      categoryInput.append(option);
    });
    form.append(categoryInput);
    if (entry) categoryInput.value = entry.category;
  }

  const topicInput = document.createElement("select");
  topicInput.name = "topic_space_id";
  topicInput.setAttribute("aria-label", "Topic for this entry");
  const acrossTopics = document.createElement("option");
  acrossTopics.value = "";
  acrossTopics.textContent = OVERALL_MAP_TITLE;
  topicInput.append(acrossTopics);
  (state.map?.topic_spaces || []).forEach((space) => {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.title;
    topicInput.append(option);
  });
  topicInput.value = node?.kind === "topic" ? node.id : "";
  form.append(topicInput);

  const textInput = document.createElement("textarea");
  textInput.name = "entry_text";
  textInput.rows = 4;
  textInput.required = true;
  textInput.placeholder = isTask
    ? "What repeatable practice belongs to this topic?"
    : "What observation do you want to save here?";
  if (entry) textInput.value = entry.text || "";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = isEdit ? "Save changes" : isTask ? "Save practice" : "Save entry";
  form.append(textInput, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    saveMapPopup(form, async () => {
      if (isEdit) {
        await updateMapEntry(entry.id, {
          category: isPracticeEdit ? "practice" : categoryInput.value,
          text,
          topic_space_id: topicInput.value || null,
        });
      } else {
        await createThreadMapEntry(
          node,
          isTask ? "practice" : categoryInput.value,
          text,
          topicInput.value || null,
        );
      }
    });
  });

  popup.append(closeButton, eyebrow, title, form);
  backdrop.append(popup);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeMapActionPopup();
  });
  mountMapPopup(backdrop);
  textInput.focus();
}

function closeEntryMenus() {
  document.querySelectorAll(".map-entry-preview article.open").forEach((item) => {
    item.classList.remove("open");
    item.querySelector(".map-entry-menu-button")?.setAttribute("aria-expanded", "false");
  });
}

function practiceStatusLabel(status) {
  if (status === "paused") return "Paused";
  if (status === "completed") return "Completed";
  return "Active";
}

function updatePracticeFromButton(button, entryId, status, reflection = null) {
  button.disabled = true;
  const originalText = button.textContent;
  button.textContent = "Saving...";
  updatePractice(entryId, status, reflection)
    .catch(renderInlineError)
    .finally(() => {
      button.disabled = false;
      button.textContent = originalText;
    });
}

function createEntryPreviewElement(node, entry) {
  const item = document.createElement("article");
  item.dataset.category = entry.category;

  const label = document.createElement("span");
  label.className = "map-entry-type";
  label.textContent = MAP_CATEGORY_LABELS[entry.category] || entry.category;

  const header = document.createElement("div");
  header.className = "map-entry-preview-head";

  const preview = mapTextPreview(entry.text);
  const text = document.createElement("p");
  text.className = "map-entry-text";
  text.title = entry.text || "";

  const renderEntryText = (expanded = false) => {
    text.replaceChildren();
    const previewText = document.createElement("span");
    previewText.textContent = expanded ? preview.full : preview.preview;
    text.append(previewText);
    if (!preview.truncated) return;

    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = "map-entry-more";
    toggleButton.textContent = expanded ? "less" : "more";
    toggleButton.setAttribute("aria-expanded", String(expanded));
    toggleButton.addEventListener("click", () => renderEntryText(!expanded));
    text.append(" ", toggleButton);
  };
  renderEntryText();

  let taskPanel = null;
  if (entry.category === "practice") {
    taskPanel = document.createElement("div");
    taskPanel.className = "map-task-panel";

    const statusChip = document.createElement("span");
    statusChip.className = "map-task-status";
    statusChip.dataset.status = entry.status || "active";
    statusChip.textContent = practiceStatusLabel(entry.status);
    taskPanel.append(statusChip);

    if (entry.reflection) {
      const reflection = document.createElement("p");
      reflection.className = "map-task-reflection";
      reflection.textContent = entry.reflection;
      taskPanel.append(reflection);
    }

    const taskActions = document.createElement("div");
    taskActions.className = "map-task-actions";

    if (entry.status === "completed") {
      const reactivateTaskButton = document.createElement("button");
      reactivateTaskButton.type = "button";
      reactivateTaskButton.textContent = "Practice again";
      reactivateTaskButton.addEventListener("click", () =>
        updatePracticeFromButton(reactivateTaskButton, entry.id, "active"),
      );
      taskActions.append(reactivateTaskButton);
    } else {
      const pauseTaskButton = document.createElement("button");
      pauseTaskButton.type = "button";
      pauseTaskButton.textContent = entry.status === "paused" ? "Resume" : "Pause";
      pauseTaskButton.addEventListener("click", () =>
        updatePracticeFromButton(
          pauseTaskButton,
          entry.id,
          entry.status === "paused" ? "active" : "paused",
        ),
      );

      const completeTaskButton = document.createElement("button");
      completeTaskButton.type = "button";
      completeTaskButton.className = "primary";
      completeTaskButton.textContent = "Complete";
      completeTaskButton.addEventListener("click", () => openReflectionDialog(entry.id));

      taskActions.append(pauseTaskButton, completeTaskButton);
    }

    taskPanel.append(taskActions);
  }

  const menuButton = document.createElement("button");
  menuButton.type = "button";
  menuButton.className = "map-entry-menu-button";
  menuButton.setAttribute("aria-label", "Entry actions");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.textContent = "...";

  const menu = document.createElement("div");
  menu.className = "map-entry-menu";

  const editEntry = () => {
    closeEntryMenus();
    openMapActionPopup(node, "edit", entry);
  };

  const deleteEntry = () => {
    closeEntryMenus();
    deleteMapEntry(entry).catch(renderInlineError);
  };

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", editEntry);
  menu.append(editButton);

  if (entry.category === "practice") {
    if (entry.status === "completed") {
      const reactivateButton = document.createElement("button");
      reactivateButton.type = "button";
      reactivateButton.textContent = "Practice again";
      reactivateButton.addEventListener("click", () => {
        closeEntryMenus();
        updatePractice(entry.id, "active").catch(renderInlineError);
      });
      menu.append(reactivateButton);
    } else {
      const statusButton = document.createElement("button");
      statusButton.type = "button";
      statusButton.textContent = entry.status === "paused" ? "Resume practice" : "Pause practice";
      statusButton.addEventListener("click", () => {
        closeEntryMenus();
        updatePractice(entry.id, entry.status === "paused" ? "active" : "paused").catch(
          renderInlineError,
        );
      });
      menu.append(statusButton);

      const completeButton = document.createElement("button");
      completeButton.type = "button";
      completeButton.textContent = "Complete practice";
      completeButton.addEventListener("click", () => {
        closeEntryMenus();
        openReflectionDialog(entry.id);
      });
      menu.append(completeButton);
    }
  }

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "danger";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", deleteEntry);
  menu.append(deleteButton);

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !item.classList.contains("open");
    closeEntryMenus();
    item.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
  });

  header.append(label, menuButton);
  item.append(header, text);
  if (taskPanel) item.append(taskPanel);
  item.append(menu);
  return item;
}

function createThreadActions(node) {
  const actions = document.createElement("section");
  actions.className = "map-thread-actions";

  [
    ["entry", "+ Entry"],
    ["task", "+ Practice"],
  ].forEach(([mode, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-thread-button";
    button.textContent = label;
    button.addEventListener("click", () => openMapActionPopup(node, mode));
    actions.append(button);
  });
  return actions;
}

function createConceptDetails(node) {
  const panel = document.createElement("aside");
  panel.className = "map-node-detail";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "map-detail-close";
  closeButton.setAttribute("aria-label", "Close thread details");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", () => {
    state.mapDetailOpen = false;
    renderMap();
  });

  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = node.kind === "unassigned" ? "Across your map" : TOPIC_CATEGORIES[topicCategoryOf(node)].label;

  const titleRow = document.createElement("div");
  titleRow.className = "map-detail-title-row";

  const title = document.createElement("h3");
  title.textContent = node.title;
  titleRow.append(title);

  if (node.kind === "topic") {
    const titleActions = document.createElement("div");
    titleActions.className = "map-title-actions";

    const editTopicButton = document.createElement("button");
    editTopicButton.type = "button";
    editTopicButton.className = "map-title-edit-button";
    editTopicButton.textContent = "Edit & connect";
    editTopicButton.addEventListener("click", () => openMapTopicPopup(node));
    titleActions.append(editTopicButton);

    const deleteTopicButton = document.createElement("button");
    deleteTopicButton.type = "button";
    deleteTopicButton.className = "map-title-edit-button danger";
    deleteTopicButton.textContent = "Delete";
    deleteTopicButton.addEventListener("click", () => deleteMapTopic(node).catch(renderInlineError));
    titleActions.append(deleteTopicButton);

    titleRow.append(titleActions);
  }

  const stats = document.createElement("div");
  stats.className = "map-node-stats";
  const chats = node.chat_ids?.length || 0;
  const journals = node.journal_dates?.length || 0;
  const entries = node.entries || [];
  [
    `${chats} ${chats === 1 ? "chat" : "chats"}`,
    `${journals} ${journals === 1 ? "journal entry" : "journal entries"}`,
    `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`,
  ].forEach(
    (value) => {
      const item = document.createElement("span");
      item.textContent = value;
      stats.append(item);
    },
  );

  const signals = document.createElement("div");
  signals.className = "map-node-signals";
  Object.entries(entryCategoryCounts(entries)).forEach(([category, count]) => {
    const signal = document.createElement("span");
    signal.dataset.category = category;
    signal.textContent = `${MAP_CATEGORY_LABELS[category] || category} ${count}`;
    signals.append(signal);
  });
  if (!signals.children.length) {
    const signal = document.createElement("span");
    signal.textContent = "No saved signals";
    signals.append(signal);
  }

  const description = document.createElement("p");
  description.className = "map-node-description";
  description.textContent = node.description || "A thread you chose to keep visible.";
  panel.append(closeButton, eyebrow, titleRow, description, stats, signals);

  if (node.kind === "topic") {
    const spaces = state.map?.topic_spaces || [];
    const byId = new Map(spaces.map((space) => [space.id, space]));
    const connections = [];
    if (node.parent_topic_id && byId.has(node.parent_topic_id)) {
      connections.push(["Under", byId.get(node.parent_topic_id)]);
    }
    spaces
      .filter((space) => space.parent_topic_id === node.id)
      .forEach((space) => connections.push(["Contains", space]));
    (node.related_topic_ids || []).forEach((topicId) => {
      if (byId.has(topicId)) connections.push(["Related", byId.get(topicId)]);
    });

    if (connections.length) {
      const connectionSection = document.createElement("section");
      connectionSection.className = "map-detail-section";
      const heading = document.createElement("h4");
      heading.textContent = "Topic connections";
      const connectionList = document.createElement("div");
      connectionList.className = "map-topic-connections";
      connections.forEach(([relationship, space]) => {
        const row = document.createElement("div");
        row.className = "map-topic-connection-row";
        const openButton = document.createElement("button");
        openButton.type = "button";
        openButton.className = "map-topic-connection-open";
        const relationshipLabel = document.createElement("span");
        relationshipLabel.textContent = relationship;
        const topicLabel = document.createElement("strong");
        topicLabel.textContent = space.title;
        openButton.append(relationshipLabel, topicLabel);
        openButton.addEventListener("click", () => {
          state.activeMapNodeId = space.id;
          state.mapDetailOpen = true;
          renderMap();
        });

        const disconnectButton = document.createElement("button");
        disconnectButton.type = "button";
        disconnectButton.className = "map-topic-connection-remove";
        disconnectButton.textContent = "×";
        disconnectButton.title = `Disconnect from ${space.title}`;
        disconnectButton.setAttribute("aria-label", `Disconnect from ${space.title}`);
        disconnectButton.addEventListener("click", () => {
          disconnectMapTopicConnection(node, relationship, space).catch(renderInlineError);
        });
        row.append(openButton, disconnectButton);
        connectionList.append(row);
      });
      connectionSection.append(heading, connectionList);
      panel.append(connectionSection);
    }

    if (node.chat_ids?.length) {
      const chatSection = document.createElement("section");
      chatSection.className = "map-detail-section";
      const heading = document.createElement("h4");
      heading.textContent = "Connected conversations";
      const chatListElement = document.createElement("div");
      chatListElement.className = "map-connected-chats";
      node.chat_ids.forEach((chatId) => {
        const chat = state.chats.find((item) => item.chat_id === chatId);
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = chat?.title || "Conversation";
        button.addEventListener("click", () => {
          switchWorkspace("chat");
          loadChat(chatId).catch(renderInlineError);
        });
        chatListElement.append(button);
      });
      chatSection.append(heading, chatListElement);
      panel.append(chatSection);
    }

    if (node.journal_dates?.length) {
      const journalSection = document.createElement("section");
      journalSection.className = "map-detail-section";
      const heading = document.createElement("h4");
      heading.textContent = "Connected journal entries";
      const journalListElement = document.createElement("div");
      journalListElement.className = "map-connected-journals";
      [...node.journal_dates].sort().reverse().forEach((journalDate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = formattedJournalDate(journalDate, {
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        button.addEventListener("click", () => {
          state.activeJournalDate = journalDate;
          switchWorkspace("journal");
        });
        journalListElement.append(button);
      });
      journalSection.append(heading, journalListElement);
      panel.append(journalSection);
    }
  }

  panel.append(createThreadActions(node));

  if (entries.length) {
    const preview = document.createElement("div");
    preview.className = "map-entry-preview";
    entries.slice(-3).reverse().forEach((entry) => {
      preview.append(createEntryPreviewElement(node, entry));
    });
    panel.append(preview);
  } else {
    const empty = document.createElement("p");
    empty.className = "map-empty compact";
    empty.textContent = "No saved observations here yet.";
    panel.append(empty);
  }
  return panel;
}

function renderMapPaywall() {
  const card = document.createElement("section");
  card.className = "map-paywall";

  const badge = document.createElement("span");
  badge.className = "map-paywall-badge";
  badge.textContent = "Premium";

  const title = document.createElement("h3");
  title.textContent = "Turn conversations into your personal map";

  const copy = document.createElement("p");
  copy.textContent =
    "My Map connects the reflections you choose to keep into a map of yourself and your journey.";

  const benefits = document.createElement("ul");
  [
    "See recurring themes across conversations",
    "Keep useful insights organized in one visual space",
    "Revisit what matters to you and how your perspective changes",
  ].forEach((benefit) => {
    const item = document.createElement("li");
    item.textContent = benefit;
    benefits.append(item);
  });

  const actions = document.createElement("div");
  actions.className = "map-paywall-actions";
  const primary = document.createElement("button");
  primary.type = "button";
  primary.className = "primary-button";
  const monthlyAvailable = state.subscription?.available_plans?.includes("monthly");
  primary.textContent = monthlyAvailable ? "Unlock My Map" : "View Premium";
  primary.addEventListener("click", () => {
    const request = monthlyAvailable
      ? startSubscriptionCheckout("monthly")
      : openAccountDialog();
    request.catch(renderInlineError);
  });

  const back = document.createElement("button");
  back.type = "button";
  back.className = "secondary-button";
  back.textContent = "Continue with chat";
  back.addEventListener("click", () => switchWorkspace("chat"));
  actions.append(primary, back);
  card.append(badge, title, copy, benefits, actions);
  mapContent.append(card);
}

function renderMap() {
  renderMapSidebar();
  mapContent.replaceChildren();

  if (!hasMyMapAccess()) {
    renderMapPaywall();
    return;
  }

  const map = state.map || { topic_spaces: [], unassigned_entries: [] };
  const spaces = map.topic_spaces || [];

  const topicTitles = new Map(spaces.map((space) => [space.id, space.title || "Untitled"]));
  const nodes = [
    overallMapNode(map),
    ...spaces.map((space, index) => ({
      ...space,
      kind: "topic",
      title: space.title || "Untitled",
      description: space.description || "A thread you chose to keep visible.",
      parent_title: topicTitles.get(space.parent_topic_id) || null,
      related_topic_ids: space.related_topic_ids || [],
      journal_dates: space.journal_dates || [],
      entries: space.entries || [],
      position: mapNodePosition(index + 1),
    })),
  ];

  if (!nodes.some((node) => node.id === state.activeMapNodeId)) {
    state.activeMapNodeId = null;
    state.mapDetailOpen = false;
  }
  const activeNode = nodes.find((node) => node.id === state.activeMapNodeId) || null;
  if (activeNode && state.mapDetailOpen && state.mapFilter !== "all" && topicCategoryOf(activeNode) !== state.mapFilter) {
    state.mapFilter = "all";
  }
  const visibleNodes = nodes.filter((node) =>
    state.mapFilter === "all" || (node.kind === "topic" && topicCategoryOf(node) === state.mapFilter));
  const toolbar = document.createElement("div");
  toolbar.className = "map-toolbar";
  const summary = document.createElement("p");
  summary.className = "map-topic-summary";
  summary.textContent = spaces.length ? Object.entries(TOPIC_CATEGORIES).map(([category, { plural }]) => {
    const count = spaces.filter((space) => topicCategoryOf(space) === category).length;
    return count ? `${count} ${count === 1 ? TOPIC_CATEGORIES[category].label.toLowerCase() : plural.toLowerCase()}` : null;
  }).filter(Boolean).join(" \u00b7 ") : "The people, qualities, and experiences that make up your life.";
  const filters = document.createElement("div");
  filters.className = "map-topic-filters";
  filters.setAttribute("role", "group");
  filters.setAttribute("aria-label", "Filter map topics");
  [["all", "Everything"], ...Object.entries(TOPIC_CATEGORIES).map(([key, value]) => [key, value.plural])].forEach(([value, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(state.mapFilter === value));
    button.addEventListener("click", () => {
      state.mapFilter = value;
      state.activeMapNodeId = null;
      state.mapDetailOpen = false;
      renderMap();
      [...mapContent.querySelectorAll(".map-topic-filters button")].find((item) => item.textContent === label)?.focus();
    });
    filters.append(button);
  });
  toolbar.append(summary, filters);

  const layout = document.createElement("section");
  layout.className = "map-concept-layout";

  const board = document.createElement("div");
  board.className = "map-concept-board";
  board.setAttribute("aria-label", "Interactive concept map");
  if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) {
    const height = layoutMobileMap(visibleNodes);
    board.style.height = `${height}px`;
    board.style.minHeight = `${height}px`;
  }
  board.append(createMapConnectionLayer(visibleNodes));
  visibleNodes.forEach((node, index) => board.append(createConceptNode(node, index)));
  if (!visibleNodes.length) {
    const empty = document.createElement("p");
    empty.className = "map-filter-empty";
    empty.textContent = spaces.length ? "No topics of this type yet. You can choose a type in Edit & connect." : "Add a person, a trait, or an experience to begin your map.";
    board.append(empty);
  }

  const detailWrap = document.createElement("div");
  detailWrap.className = "map-detail-drawer";
  if (!state.mapDetailOpen || !activeNode) detailWrap.classList.add("hidden");
  if (state.mapDetailOpen && activeNode) detailWrap.append(createConceptDetails(activeNode));

  layout.append(toolbar, board, detailWrap);
  mapContent.append(layout);
}

function openReflectionDialog(entryId) {
  state.completingPracticeId = entryId;
  practiceReflection.value = "";
  const submit = reflectionForm.querySelector(".primary-button");
  if (submit) {
    submit.disabled = false;
    submit.textContent = "Mark complete";
  }
  reflectionDialog.showModal();
  practiceReflection.focus();
}

async function updatePractice(entryId, status, reflection = null) {
  const response = await api(`/users/me/map/practices/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status, reflection }),
  });
  state.map = response.map;
  renderMap();
}

async function completePractice(event) {
  event.preventDefault();
  if (!state.completingPracticeId) return;
  const submit = reflectionForm.querySelector(".primary-button");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Completing...";
  }
  try {
    await updatePractice(
      state.completingPracticeId,
      "completed",
      practiceReflection.value.trim() || null,
    );
    state.completingPracticeId = null;
    reflectionDialog.close();
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Mark complete";
    }
  }
}

