// FeelY journal: see website/EDITING.md for file responsibilities and load order.

function localDateKey(value = new Date()) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(value) {
  return new Date(`${value}T12:00:00`);
}

function shiftedDateKey(value, offset) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + offset);
  return localDateKey(date);
}

function formattedJournalDate(value, options = { dateStyle: "full" }) {
  return new Intl.DateTimeFormat(undefined, options).format(dateFromKey(value));
}

function journalWordTotal(content) {
  return content.trim() ? content.trim().split(/\s+/).length : 0;
}

function setJournalSaveStatus(text, status = "saved") {
  journalSaveStatus.textContent = text;
  journalSaveStatus.dataset.state = status;
}

function renderJournalAccess() {
  const allowed = hasJournalAccess();
  journalPaywall.classList.toggle("hidden", allowed);
  journalWorkspace.classList.toggle("hidden", !allowed);
  journalSidebarAccess.classList.toggle("hidden", !allowed);
  journalSidebarLocked.classList.toggle("hidden", allowed);
  journalAnalyseButton.hidden = !allowed;
  if (!allowed) return;
  if (!state.activeJournalDate) state.activeJournalDate = localDateKey();
}

async function loadJournalIndex() {
  if (!hasJournalAccess()) return;
  state.journalEntries = await api("/journal/entries?limit=180", {
    headers: authHeaders(),
  });
  renderJournalHistory();
}

function renderJournalHistory() {
  journalEntryList.replaceChildren();
  journalEntryCount.textContent = String(state.journalEntries.length);
  if (!state.journalEntries.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your saved pages will appear here.";
    journalEntryList.append(empty);
    return;
  }
  state.journalEntries.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "journal-entry-button";
    button.classList.toggle("active", entry.entry_date === state.activeJournalDate);
    const date = document.createElement("strong");
    date.textContent = formattedJournalDate(entry.entry_date, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const excerpt = document.createElement("span");
    excerpt.textContent = entry.excerpt || `${entry.word_count || 0} words`;
    button.append(date, excerpt);
    button.addEventListener("click", () => {
      openJournalDateFromSidebar(entry.entry_date).catch(renderInlineError);
    });
    journalEntryList.append(button);
  });
}

async function openJournalDateFromSidebar(entryDate) {
  await openJournalDate(entryDate);
  if (window.matchMedia("(max-width: 900px)").matches) closeSidebar();
}

function renderJournalEntry() {
  const entry = state.journalEntry || {
    entry_date: state.activeJournalDate || localDateKey(),
    content: "",
    word_count: 0,
    suggestions: [],
  };
  journalText.value = entry.content || "";
  journalFullDate.textContent = formattedJournalDate(entry.entry_date);
  const words = journalWordTotal(entry.content || "");
  journalWordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  journalNextButton.disabled = entry.entry_date >= localDateKey();
  setJournalSaveStatus(entry.updated_at ? "Saved" : "New page");
  renderJournalSuggestions();
  renderJournalHistory();
}

async function openJournalDate(entryDate) {
  if (!hasJournalAccess()) return;
  if (state.journalDirty) await saveJournalEntry();
  state.activeJournalDate = entryDate;
  setJournalSaveStatus("Loading...", "saving");
  state.journalEntry = await api(`/journal/entries/${encodeURIComponent(entryDate)}`, {
    headers: authHeaders(),
  });
  state.journalDirty = false;
  renderJournalEntry();
}

function updateJournalIndexFromEntry(entry) {
  const compact = (entry.content || "").replace(/\s+/g, " ").trim();
  const item = {
    entry_date: entry.entry_date,
    excerpt: compact.length > 120 ? `${compact.slice(0, 117)}...` : compact,
    word_count: journalWordTotal(entry.content || ""),
    suggestion_count: entry.suggestions?.length || 0,
    updated_at: entry.updated_at,
  };
  const index = state.journalEntries.findIndex(
    (candidate) => candidate.entry_date === entry.entry_date,
  );
  if (index >= 0) state.journalEntries.splice(index, 1);
  if (item.word_count || item.suggestion_count) state.journalEntries.unshift(item);
  state.journalEntries.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
  renderJournalHistory();
}

async function saveJournalEntry({ keepalive = false } = {}) {
  if (!hasJournalAccess() || !state.activeJournalDate || !state.journalDirty) return;
  if (journalSaveTimer) window.clearTimeout(journalSaveTimer);
  journalSaveTimer = null;
  const entryDate = state.activeJournalDate;
  const content = journalText.value;
  setJournalSaveStatus("Saving...", "saving");

  if (keepalive) {
    state.journalDirty = false;
    api(`/journal/entries/${encodeURIComponent(entryDate)}`, {
      method: "PUT",
      keepalive: true,
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    }).catch(() => {});
    return;
  }

  try {
    const saved = await api(`/journal/entries/${encodeURIComponent(entryDate)}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ content }),
    });
    if (entryDate === state.activeJournalDate && content === journalText.value) {
      state.journalEntry = saved;
      state.journalDirty = false;
      setJournalSaveStatus("Saved");
    }
    updateJournalIndexFromEntry(saved);
  } catch (error) {
    setJournalSaveStatus("Could not save", "error");
    throw error;
  }
}

function scheduleJournalSave() {
  state.journalDirty = true;
  setJournalSaveStatus("Unsaved", "saving");
  const words = journalWordTotal(journalText.value);
  journalWordCount.textContent = `${words} ${words === 1 ? "word" : "words"}`;
  if (journalSaveTimer) window.clearTimeout(journalSaveTimer);
  journalSaveTimer = window.setTimeout(() => {
    saveJournalEntry().catch((error) => {
      setJournalSaveStatus(error instanceof Error ? error.message : "Could not save", "error");
    });
  }, 900);
}

async function analyseJournalEntry() {
  if (!hasJournalAccess() || !state.activeJournalDate) return;
  if (state.journalDirty) await saveJournalEntry();
  journalAnalyseButton.disabled = true;
  const originalLabel = journalAnalyseButton.textContent;
  journalAnalyseButton.textContent = "Finding insights...";
  setJournalSaveStatus("Analysing...", "saving");
  try {
    const response = await api(
      `/journal/entries/${encodeURIComponent(state.activeJournalDate)}/analyse`,
      { method: "POST", headers: authHeaders() },
    );
    state.journalEntry = response.entry;
    updateJournalIndexFromEntry(response.entry);
    renderJournalSuggestions();
    setJournalSaveStatus("Analysis ready");
  } finally {
    journalAnalyseButton.disabled = false;
    journalAnalyseButton.textContent = originalLabel;
  }
}

function journalTopicOptions(select, selectedValue = "", emptyLabel = OVERALL_MAP_TITLE) {
  const across = document.createElement("option");
  across.value = "";
  across.textContent = emptyLabel;
  select.append(across);
  (state.map?.topic_spaces || []).forEach((topic) => {
    const option = document.createElement("option");
    option.value = topic.id;
    option.textContent = topic.title;
    option.selected = topic.id === selectedValue;
    select.append(option);
  });
}

function createJournalSuggestionCard(suggestion) {
  const card = document.createElement("article");
  card.className = "journal-suggestion";
  card.dataset.status = suggestion.status;

  const kind = document.createElement("span");
  kind.className = "journal-suggestion-kind";
  kind.textContent = suggestion.kind === "topic"
    ? "Possible topic"
    : MAP_CATEGORY_LABELS[suggestion.category] || suggestion.category;
  card.append(kind);

  let titleInput = null;
  let topicCategoryInput = null;
  if (suggestion.kind === "topic") {
    titleInput = document.createElement("input");
    titleInput.name = "journal_topic_title";
    titleInput.value = suggestion.title || "";
    titleInput.maxLength = 120;
    titleInput.setAttribute("aria-label", "Topic title");
    const categoryField = createTopicCategorySelect(suggestion.topic_category || "other");
    topicCategoryInput = categoryField.querySelector("select");
    card.append(titleInput, categoryField);
  }

  const textInput = document.createElement("textarea");
  textInput.name = "journal_suggestion_text";
  textInput.value = suggestion.text || "";
  textInput.maxLength = 1000;
  textInput.setAttribute("aria-label", suggestion.kind === "topic" ? "Topic description" : "Map entry");
  card.append(textInput);

  let categoryInput = null;
  let topicInput = null;
  if (suggestion.kind === "topic") {
    topicInput = document.createElement("select");
    topicInput.name = "journal_topic_space_id";
    topicInput.setAttribute("aria-label", "Connect this journal page to a topic");
    journalTopicOptions(topicInput, "", `Create “${suggestion.title || "new topic"}”`);
    categoryInput = document.createElement("select");
    categoryInput.setAttribute("aria-label", "Note category for existing topic");
    fillEntryCategorySelect(categoryInput);
    categoryInput.hidden = true;
    topicInput.addEventListener("change", () => {
      const target = (state.map?.topic_spaces || []).find(space => space.id === topicInput.value);
      categoryInput.hidden = !target;
      topicCategoryInput.value = target ? topicCategoryOf(target) : suggestion.topic_category || "other";
      topicCategoryInput.syncChoices();
    });
    card.append(topicInput, categoryInput);
  } else if (suggestion.kind === "map_entry") {
    categoryInput = document.createElement("select");
    categoryInput.name = "journal_map_category";
    fillEntryCategorySelect(categoryInput, suggestion.category);
    categoryInput.setAttribute("aria-label", "Map category");
    topicInput = document.createElement("select");
    topicInput.name = "journal_map_topic_space_id";
    topicInput.setAttribute("aria-label", "Connect to topic");
    journalTopicOptions(topicInput);
    card.append(categoryInput, topicInput);
  }

  const reason = document.createElement("p");
  reason.className = "journal-suggestion-reason";
  reason.textContent = suggestion.reason;
  card.append(reason);

  if (suggestion.status === "pending") {
    const actions = document.createElement("div");
    actions.className = "journal-suggestion-actions";
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "secondary-button";
    dismiss.textContent = "Not this";
    const accept = document.createElement("button");
    accept.type = "button";
    accept.className = "primary-button small";
    accept.textContent = suggestion.kind === "topic" ? "Save topic" : "Add to map";
    const submitDecision = async (accepted) => {
      if (accept.disabled) return;
      accept.disabled = true;
      dismiss.disabled = true;
      try {
        await decideJournalSuggestion(suggestion, accepted, accepted ? {
          title: titleInput?.value || null,
          topic_category: topicCategoryInput?.value || null,
          text: textInput.value,
          category: categoryInput?.value || null,
          topic_space_id: topicInput?.value || null,
        } : {});
      } catch (error) {
        renderInlineError(error);
      } finally {
        accept.disabled = false;
        dismiss.disabled = false;
      }
    };
    dismiss.addEventListener("click", () => submitDecision(false));
    accept.addEventListener("click", () => submitDecision(true));
    actions.append(dismiss, accept);
    card.append(actions);
  } else {
    const status = document.createElement("strong");
    status.textContent = suggestion.status === "saved" ? "Saved to My Map" : "Dismissed";
    card.append(status);
    card.querySelectorAll("input, textarea, select").forEach((field) => {
      field.disabled = true;
    });
  }
  return card;
}

function renderJournalSuggestions() {
  const suggestions = state.journalEntry?.suggestions || [];
  journalSuggestions.classList.toggle("hidden", suggestions.length === 0);
  journalSuggestionList.replaceChildren(
    ...suggestions.map(createJournalSuggestionCard),
  );
}

async function decideJournalSuggestion(suggestion, accepted, edits = {}) {
  const response = await api(
    `/journal/entries/${encodeURIComponent(state.activeJournalDate)}/suggestions/${encodeURIComponent(suggestion.id)}`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ accepted, ...edits }),
    },
  );
  state.map = response.map;
  if (accepted) {
    state.mapFilter = "all";
    const savedTopic = (response.map?.topic_spaces || []).find(topic =>
      topic.id === response.suggestion.saved_item_id ||
      (topic.entries || []).some(entry => entry.id === response.suggestion.saved_item_id));
    if (savedTopic) {
      state.activeMapNodeId = savedTopic.id;
      state.mapDetailOpen = true;
    }
  }
  const index = (state.journalEntry?.suggestions || []).findIndex(
    (item) => item.id === suggestion.id,
  );
  if (index >= 0) state.journalEntry.suggestions[index] = response.suggestion;
  renderJournalSuggestions();
  renderMap();
}

async function loadJournalWorkspace() {
  renderJournalAccess();
  if (!hasJournalAccess()) return;
  if (!state.activeJournalDate) state.activeJournalDate = localDateKey();
  await Promise.all([loadJournalIndex(), openJournalDate(state.activeJournalDate)]);
}

