// FeelY chat: see website/EDITING.md for file responsibilities and load order.

async function loadChats() {
  state.chats = await api("/llm/chats", { headers: authHeaders() });

  const activeChatStillExists = state.chats.some(
    (chat) => chat.chat_id === state.activeChatId,
  );
  if (!activeChatStillExists) {
    state.activeChatId = null;
  }

  renderChats();
  if (state.activeChatId) {
    await loadChat(state.activeChatId);
  } else {
    chatTitle.textContent = "New conversation";
    renderMessages([]);
    renderTopic(null);
  }
}

function startNewChat() {
  stopPolling();
  state.activeChatId = null;
  chatTitle.textContent = "New conversation";
  document.title = "New conversation | FeelY";
  renderChats();
  renderMessages([]);
  renderTopic(null);
  renderMapSuggestion(null);
  closeSidebar();
  messageInput.focus();
}

async function loadChat(chatId) {
  const chat = await api(`/llm/chats/${encodeURIComponent(chatId)}`, {
    headers: authHeaders(),
  });
  state.activeChatId = chat.chat_id;
  const existing = state.chats.find((item) => item.chat_id === chat.chat_id) || {};
  const completeChat = { ...existing, ...chat };
  const index = state.chats.findIndex((item) => item.chat_id === chat.chat_id);
  if (index >= 0) state.chats[index] = completeChat;
  chatTitle.textContent = chat.title || "New conversation";
  document.title = `${chat.title || "Conversation"} | FeelY`;
  renderMessages(chat.messages || []);
  renderTopic(chat.pending_topic || null);
  renderMapSuggestion(chat.pending_map_suggestion || null);
  renderChats();
  closeSidebar();
  await pollTopicOnce();
}

async function deleteChat(chat) {
  const title = chat.title || "New conversation";
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;

  await api(`/llm/chats/${encodeURIComponent(chat.chat_id)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });

  state.chats = state.chats.filter((item) => item.chat_id !== chat.chat_id);
  if (state.activeChatId === chat.chat_id) {
    state.activeChatId = state.chats[0]?.chat_id || null;
  }

  renderChats();
  if (state.activeChatId) {
    await loadChat(state.activeChatId);
  } else {
    chatTitle.textContent = "New conversation";
    document.title = "FeelY | Conversations";
    renderMessages([]);
    renderTopic(null);
    renderMapSuggestion(null);
  }
}

function closeChatActionsMenu() {
  document.querySelector(".chat-actions-menu")?.remove();
  document.querySelectorAll(".chat-actions-button[aria-expanded='true']").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function openChatActionsMenu(chat, trigger) {
  const wasOpen = trigger.getAttribute("aria-expanded") === "true";
  closeChatActionsMenu();
  if (wasOpen) return;

  const menu = document.createElement("div");
  menu.className = "chat-actions-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", `Actions for ${chat.title || "conversation"}`);

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "chat-menu-delete";
  deleteButton.setAttribute("role", "menuitem");
  deleteButton.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-1 11H8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"></path>
    </svg>
    <span>Delete</span>
  `;
  deleteButton.addEventListener("click", () => {
    closeChatActionsMenu();
    deleteChat(chat).catch(renderInlineError);
  });

  menu.append(deleteButton);
  document.body.append(menu);

  const triggerRect = trigger.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const gap = 5;
  const left = Math.max(8, triggerRect.right - menuRect.width);
  const top =
    triggerRect.bottom + gap + menuRect.height <= window.innerHeight
      ? triggerRect.bottom + gap
      : triggerRect.top - menuRect.height - gap;
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  trigger.setAttribute("aria-expanded", "true");
  deleteButton.focus();
}

function renderChats() {
  closeChatActionsMenu();
  chatList.replaceChildren();
  chatCount.textContent = String(state.chats.length);

  if (!state.chats.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your conversations will appear here.";
    chatList.append(empty);
    return;
  }

  state.chats.forEach((chat) => {
    const item = document.createElement("div");
    item.className = "chat-list-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-open-button";
    if (chat.chat_id === state.activeChatId) button.classList.add("active");
    button.setAttribute("aria-current", chat.chat_id === state.activeChatId ? "page" : "false");

    const title = document.createElement("strong");
    title.textContent = chat.title || "New conversation";
    const meta = document.createElement("span");
    const count = chat.message_count || chat.messages?.length || 0;
    meta.textContent = `${count} ${count === 1 ? "message" : "messages"}`;
    button.append(title, meta);

    button.addEventListener("click", () => loadChat(chat.chat_id).catch(renderInlineError));

    const actionsButton = document.createElement("button");
    actionsButton.type = "button";
    actionsButton.className = "chat-actions-button";
    actionsButton.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="5" cy="12" r="1.8"></circle>
        <circle cx="12" cy="12" r="1.8"></circle>
        <circle cx="19" cy="12" r="1.8"></circle>
      </svg>
    `;
    actionsButton.title = `More options for ${chat.title || "conversation"}`;
    actionsButton.setAttribute("aria-label", actionsButton.title);
    actionsButton.setAttribute("aria-haspopup", "menu");
    actionsButton.setAttribute("aria-expanded", "false");
    actionsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openChatActionsMenu(chat, actionsButton);
    });

    item.append(button, actionsButton);
    chatList.append(item);
  });
}

function renderMessages(items, followLatest = true) {
  const previousScrollTop = messages.scrollTop;
  messages.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("section");
    empty.className = "empty-chat";

    const mark = document.createElement("span");
    mark.className = "empty-chat-mark";
    mark.textContent = "F";
    mark.setAttribute("aria-hidden", "true");

    const heading = document.createElement("h3");
    heading.textContent = "What would you like to understand?";

    const copy = document.createElement("p");
    copy.textContent =
      "You do not need a polished thought. Begin with the feeling, question, or moment that keeps returning.";

    const suggestions = document.createElement("div");
    suggestions.className = "prompt-suggestions";
    [
      "A feeling I cannot place",
      "Something I keep thinking about",
      "A decision I am facing",
    ].forEach((suggestion) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = suggestion;
      button.addEventListener("click", () => {
        messageInput.value = suggestion;
        autoresizeMessageInput();
        messageInput.focus();
      });
      suggestions.append(button);
    });

    empty.append(mark, heading, copy, suggestions);
    messages.append(empty);
    return;
  }

  items.forEach((item) => {
    const bubble = document.createElement("article");
    bubble.className = `message ${item.role === "user" ? "user" : "assistant"}`;
    bubble.textContent = item.content || "";
    messages.append(bubble);
  });
  messages.scrollTop = followLatest ? messages.scrollHeight : previousScrollTop;
}

function showWaitingMessage() {
  const bubble = document.createElement("article");
  bubble.className = "message assistant waiting-message";
  bubble.setAttribute("role", "status");
  bubble.setAttribute("aria-label", "FeelY is thinking");

  const label = document.createElement("span");
  label.className = "waiting-label";
  label.textContent = "FeelY is thinking";

  const dots = document.createElement("span");
  dots.className = "waiting-dots";
  dots.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 3; index += 1) {
    dots.append(document.createElement("span"));
  }

  bubble.append(label, dots);
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
  return bubble;
}

function appendStreamingText(bubble, text) {
  if (!text) return;
  const followLatest = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;

  let content = bubble.querySelector(".streaming-content");
  if (!content) {
    bubble.classList.remove("waiting-message");
    bubble.classList.add("streaming-message");
    bubble.removeAttribute("role");
    bubble.removeAttribute("aria-label");

    content = document.createElement("span");
    content.className = "streaming-content";
    const cursor = document.createElement("span");
    cursor.className = "streaming-cursor";
    cursor.setAttribute("aria-hidden", "true");
    bubble.replaceChildren(content, cursor);
  }

  const chunk = document.createElement("span");
  chunk.className = "streaming-chunk";
  chunk.textContent = text;
  content.append(chunk);
  if (followLatest) messages.scrollTop = messages.scrollHeight;
}

// Reveal short phrases with breathing room at punctuation. Keep timing
// across network gaps so the cadence does not depend on packet boundaries.
function createChatTextPlayer(bubble) {
  let pending = "";
  let timer = null;
  let stopped = false;
  let finishing = false;
  let nextRevealAt = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sentenceEnd = /[.!?\u3002\uff01\uff1f]["'\u201d\u2019)]*\s*$/u;
  const clauseEnd = /[,;:\u2014\u3001\uff0c]["'\u201d\u2019)]*\s*$/u;
  function schedule() {
    timer = setTimeout(tick, Math.max(24, nextRevealAt - performance.now()));
  }
  function tick() {
    timer = null;
    if (stopped) return;
    if (!bubble.isConnected) { cancel(); return; }
    const instant = reducedMotion || document.hidden;
    let text = "";
    if (instant) {
      text = pending;
      pending = "";
    } else {
      const groupSize = pending.length > 720 ? 4 : 2;
      for (let index = 0; index < groupSize; index += 1) {
        // Also recognize sentence boundaries in languages without spaces.
        const word = pending.match(/^(?:\s+|\S+?(?:\s+|[\u3002\uff01\uff1f]))/u);
        if (!word) break;
        text += word[0];
        pending = pending.slice(word[0].length);
        if (sentenceEnd.test(text) || clauseEnd.test(text) || /\n\s*\n/.test(text)) break;
      }
    }
    appendStreamingText(bubble, text);
    if (text && !instant) {
      const phraseTime = 90 + Math.min(130, Array.from(text.trim()).length * 4);
      const pause = /\n\s*\n/.test(text) ? 360 : sentenceEnd.test(text) ? 260 : clauseEnd.test(text) ? 130 : 0;
      nextRevealAt = performance.now() + phraseTime + pause;
    }
    if (pending && text) schedule();

  }
  function cancel() {
    stopped = true;
    clearTimeout(timer);
    pending = "";
  }
  return {
    push(text) {
      if (stopped || finishing) return;
      pending += text;
      if (timer === null) schedule();
    },
    finish() {
      if (stopped || finishing) return Promise.resolve();
      finishing = true;
      clearTimeout(timer);
      timer = null;
      // The response is complete: never hold its ending behind the animation.
      if (bubble.isConnected) {
        appendStreamingText(bubble, pending);
        bubble.classList?.add("streaming-complete");
      }
      pending = "";
      return Promise.resolve();
    },
    cancel,
  };
}

function topicContentsLabel(space) {
  const chatCount = space.chat_ids?.length || 0;
  const journalCount = space.journal_dates?.length || 0;
  return [
    `${chatCount} ${chatCount === 1 ? "chat" : "chats"}`,
    `${journalCount} ${journalCount === 1 ? "journal" : "journals"}`,
  ].join(" and ");
}

function updateTopicRoutePresentation() {
  const topic = state.pendingTopic;
  if (!topic) return;
  const spaces = state.map?.topic_spaces || [];
  const selectedSpace = spaces.find((space) => space.id === topicTarget.value);
  const isRecommended = Boolean(selectedSpace && selectedSpace.id === topic.existing_topic_id);
  topicCategory.value = selectedSpace ? topicCategoryOf(selectedSpace) : topic.category || "other";
  topicCategory.syncChoices();
  topicConnections.querySelectorAll("input").forEach((input) => {
    input.disabled = input.value === selectedSpace?.id;
    input.closest("label").classList.toggle("hidden", input.disabled);
  });

  topicParentField.classList.toggle("hidden", Boolean(selectedSpace));
  topicMatchBadge.classList.toggle("hidden", !isRecommended);
  topicNameLabel.textContent = selectedSpace ? "Detected aspect" : "New topic name";
  if (selectedSpace) {
    const prefix = isRecommended ? "Best match found. " : "";
    topicRouteHint.textContent =
      `${prefix}This chat will join “${selectedSpace.title}” ` +
      `(${topicContentsLabel(selectedSpace)}), so no extra map bubble is created. ` +
      "The same chat can also belong to other topics.";
    topicAccept.textContent = "Connect chat";
  } else {
    topicRouteHint.textContent =
      "This creates a new map topic and connects this chat to it. Its name is independent from the conversation name.";
    topicAccept.textContent = "Create and connect";
  }
}

function renderTopic(topic) {
  state.pendingTopic = topic;
  updateChatReviewNotice("topic", Boolean(topic), topic ? `Review topic: ${topic.topic || "New topic"}` : "Review topic");
  topicCard.classList.toggle("hidden", !topic);
  if (!topic) {
    topicTitle.value = "";
    topicDescription.value = "";
    topicQueueStatus.textContent = "";
    topicQueueStatus.classList.add("hidden");
    topicRouteHint.textContent = "";
    topicMatchBadge.classList.add("hidden");
    topicRouting.classList.add("hidden");
    return;
  }
  topicTitle.value = topic.topic || "";
  topicDescription.value = topic.description || "";
  topicCategory.value = topic.category || "other";
  topicConnections.replaceChildren(createTopicConnections(topic.related_topic_ids || []));
  const queueTotal = Number(topic.queue_total || 1);
  const queuePosition = Number(topic.queue_position || 1);
  topicQueueStatus.textContent = `Suggestion ${queuePosition} of ${queueTotal}`;
  topicQueueStatus.classList.toggle("hidden", queueTotal <= 1);
  const spaces = state.map?.topic_spaces || [];
  topicRouting.classList.toggle("hidden", !hasMyMapAccess() || !spaces.length);
  topicTarget.replaceChildren();
  const createOption = document.createElement("option");
  createOption.value = "";
  createOption.textContent = "Create a new map topic";
  topicTarget.append(createOption);

  const orderedSpaces = [...spaces].sort((first, second) => {
    if (first.id === topic.existing_topic_id) return -1;
    if (second.id === topic.existing_topic_id) return 1;
    return String(first.title || "").localeCompare(String(second.title || ""));
  });
  orderedSpaces.forEach((space) => {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent =
      space.id === topic.existing_topic_id
        ? `Recommended: ${space.title}`
        : `Existing topic: ${space.title}`;
    topicTarget.append(option);
  });
  if (spaces.some((space) => space.id === topic.existing_topic_id)) {
    topicTarget.value = topic.existing_topic_id;
  }

  topicParent.replaceChildren();
  const noParent = document.createElement("option");
  noParent.value = "";
  noParent.textContent = "No broader topic";
  topicParent.append(noParent);
  spaces.forEach((space) => {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.title;
    topicParent.append(option);
  });
  if (spaces.some((space) => space.id === topic.parent_topic_id)) {
    topicParent.value = topic.parent_topic_id;
  }
  updateTopicRoutePresentation();
}

function renderMapSuggestion(suggestion) {
  if (!hasMyMapAccess()) suggestion = null;
  updateChatReviewNotice("map-suggestion", Boolean(suggestion), "Review map note");
  state.pendingMapSuggestion = suggestion;
  mapSuggestionCard.classList.toggle("hidden", !suggestion);
  if (!suggestion) {
    mapSuggestionCategory.textContent = "";
    mapSuggestionTopic.textContent = "";
    mapSuggestionText.value = "";
    mapSuggestionReason.textContent = "";
    mapSuggestionTargetField.classList.add("hidden");
    mapSuggestionTarget.replaceChildren();
    return;
  }

  mapSuggestionCategory.textContent =
    MAP_CATEGORY_LABELS[suggestion.category] || suggestion.category;
  mapSuggestionTopic.textContent = suggestion.topic_title
    ? `Topic: ${suggestion.topic_title}`
    : "Not connected to a topic yet";
  mapSuggestionText.value = suggestion.text || "";
  mapSuggestionReason.textContent = suggestion.reason || "";
  const spaces = state.map?.topic_spaces || [];
  mapSuggestionTargetField.classList.toggle("hidden", !spaces.length);
  mapSuggestionTarget.replaceChildren();
  const unassigned = document.createElement("option");
  unassigned.value = "";
  unassigned.textContent = OVERALL_MAP_TITLE;
  mapSuggestionTarget.append(unassigned);
  spaces.forEach((space) => {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.title;
    mapSuggestionTarget.append(option);
  });
  if (spaces.some((space) => space.id === suggestion.topic_space_id)) {
    mapSuggestionTarget.value = suggestion.topic_space_id;
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const context = messageInput.value.trim();
  if (!context || sendButton.disabled) return;

  sendButton.disabled = true;
  messageInput.value = "";
  autoresizeMessageInput();

  const currentChat = state.chats.find((chat) => chat.chat_id === state.activeChatId);
  const existingMessages = currentChat?.messages || [];
  renderMessages([...existingMessages, { role: "user", content: context }]);
  const waitingMessage = showWaitingMessage();
  const waitingLabel = waitingMessage.querySelector(".waiting-label");
  const textPlayer = createChatTextPlayer(waitingMessage);

  try {
    let response = null;
    await apiStream("/llm/message/stream", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat_id: state.activeChatId,
        context,
      }),
    }, (event) => {
      if (event.type === "status" && waitingLabel) {
        const elapsed = event.elapsed_seconds ? ` - ${event.elapsed_seconds}s` : "";
        waitingLabel.textContent = `${event.message}${elapsed}`;
        messages.scrollTop = messages.scrollHeight;
      } else if (event.type === "text_delta" && typeof event.text === "string") {
        textPlayer.push(event.text);
      } else if (event.type === "result") {
        response = event.data;
        textPlayer.finish();
      } else if (event.type === "error") {
        throw new ApiError(event.message || "Request failed", event.status || 500);
      }
    });
    if (!response) throw new ApiError("The response stream ended unexpectedly.", 502);
    await textPlayer.finish();
    const updatedChat = {
      chat_id: response.chat_id,
      title: response.chat_info.title || "New conversation",
      message_count: response.chat_info.message_count || 0,
      updated_at: response.chat_info.updated_at,
      pending_topic: response.chat_info.pending_topic || null,
      pending_topics: response.chat_info.pending_topics || [],
      messages: response.chat_info.messages || [],
      pending_map_suggestion: response.map_suggestion || null,
    };
    state.activeChatId = response.chat_id;
    upsertChat(updatedChat);
    chatTitle.textContent = updatedChat.title;
    document.title = `${updatedChat.title} | FeelY`;
    renderChats();
    const followLatest = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    renderMessages(updatedChat.messages, followLatest);
    renderMapSuggestion(response.map_suggestion || null);
    renderTopic(updatedChat.pending_topic);
    pollTopicSoon();
  } catch (error) {
    waitingMessage.remove();
    messageInput.value = context;
    autoresizeMessageInput();
    renderInlineError(error);
  } finally {
    textPlayer.cancel();
    waitingMessage.remove();
    sendButton.disabled = false;
    messageInput.focus();
  }
}

function upsertChat(chat) {
  const index = state.chats.findIndex((item) => item.chat_id === chat.chat_id);
  if (index >= 0) state.chats.splice(index, 1);
  state.chats.unshift(chat);
}

function renderInlineError(error) {
  if (error instanceof ApiError && error.status === 401 && !state.token) return;
  if (!mapView.classList.contains("hidden")) {
    let alert = mapContent.querySelector(".map-feedback");
    if (!alert) {
      alert = document.createElement("p");
      alert.className = "map-feedback";
      alert.setAttribute("role", "alert");
      (mapContent.querySelector(".map-toolbar") || mapContent).prepend(alert);
    }
    alert.textContent = error instanceof Error ? error.message : String(error);
    alert.scrollIntoView({ block: "nearest" });
    return;
  }
  const bubble = document.createElement("article");
  bubble.className = "message assistant";
  const message = error instanceof Error ? error.message : String(error);
  bubble.textContent = message;
  const isFreeLimit =
    !hasMyMapAccess() &&
    error instanceof ApiError &&
    error.status === 429 &&
    message.toLowerCase().includes("free messages");
  if (isFreeLimit) {
    const upgradeButton = document.createElement("button");
    upgradeButton.type = "button";
    upgradeButton.className = "message-upgrade-button";
    upgradeButton.textContent = "Subscribe with Stripe";
    upgradeButton.addEventListener("click", () =>
      startLimitSubscriptionCheckout(upgradeButton).catch(renderInlineError),
    );
    bubble.append(upgradeButton);
  }
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function pollTopicSoon(attempt = 0) {
  stopPolling();
  if (!state.activeChatId || !state.token) return;
  const requestedChatId = state.activeChatId;
  state.pollTimer = setTimeout(async () => {
    state.pollTimer = null;
    try {
      const topicReady = await pollTopicOnce();
      if (!topicReady && state.activeChatId === requestedChatId) pollTopicSoon(attempt + 1);
    } catch {
      if (state.activeChatId === requestedChatId) pollTopicSoon(attempt + 1);
    }
  }, TOPIC_POLL_DELAYS[Math.min(attempt, TOPIC_POLL_DELAYS.length - 1)]);
}

async function pollTopicOnce() {
  if (!state.activeChatId || !state.token) return false;
  const requestedChatId = state.activeChatId;
  const payload = await api(
    `/llm/chats/${encodeURIComponent(requestedChatId)}/topic-suggestion`,
    { headers: authHeaders() },
  );
  if (state.activeChatId !== requestedChatId) return false;
  document.querySelector("#map-analysis-retry").classList.toggle("hidden", payload.analysis_status !== "error");
  if (payload.chat_title) {
    const chat = state.chats.find((item) => item.chat_id === requestedChatId);
    if (chat && chat.title !== payload.chat_title) {
      chat.title = payload.chat_title;
      renderChats();
    }
    chatTitle.textContent = payload.chat_title;
    document.title = `${payload.chat_title} | FeelY`;
  }
  const suggestion = payload.suggestions?.[0] || payload.suggestion || null;
  // Background observations can arrive without a new topic. Avoid resetting
  // edits in a review dialog on every poll.
  if (JSON.stringify(state.pendingTopic) !== JSON.stringify(suggestion)) renderTopic(suggestion);
  const mapSuggestion = payload.map_suggestion || null;
  if (JSON.stringify(state.pendingMapSuggestion) !== JSON.stringify(mapSuggestion)) renderMapSuggestion(mapSuggestion);
  const chat = state.chats.find((item) => item.chat_id === requestedChatId);
  if (chat) { chat.pending_topic = suggestion; chat.pending_map_suggestion = mapSuggestion; }
  return !["queued", "analysing"].includes(payload.analysis_status);

}

function startPolling() {
  document.querySelector("#map-analysis-retry").classList.add("hidden");
  pollTopicSoon();
}

async function retryMapAnalysis() {
  const chatId = state.activeChatId;
  if (!chatId) return;
  const button = document.querySelector("#map-analysis-retry");
  button.disabled = true;
  try {
    await api(`/llm/chats/${encodeURIComponent(chatId)}/topic-suggestion/retry`, {
      method: "POST", headers: authHeaders(),
    });
    if (state.activeChatId === chatId) startPolling();
  } catch {
    button.textContent = "Could not retry. Try again shortly";
  } finally {
    button.disabled = false;
  }
}

function stopPolling() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
}

async function confirmTopic(accepted) {
  if (!state.pendingTopic) return;
  const topic = state.pendingTopic;
  const editedTopic = topicTitle.value.trim() || topic.topic;
  const editedDescription = topicDescription.value.trim() || topic.description;
  if (accepted && !editedTopic) {
    topicTitle.focus();
    return;
  }
  const existingTopicSpaceId = accepted && topicTarget.value ? topicTarget.value : null;
  const parentTopicSpaceId =
    accepted && !existingTopicSpaceId && topicParent.value ? topicParent.value : null;
  const category = topicCategory.value;
  const relatedTopicIds = [...topicConnections.querySelectorAll("input:checked")]
    .map((input) => input.value).filter((id) => id !== existingTopicSpaceId);
  renderTopic(null);
  await api("/llm/topics/confirm", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      chat_id: topic.chat_id,
      topic: editedTopic,
      description: editedDescription,
      category,
      related_topic_ids: relatedTopicIds,
      accepted,
      existing_topic_space_id: existingTopicSpaceId,
      parent_topic_space_id: parentTopicSpaceId,
    }),
  });
  if (hasMyMapAccess()) await loadMap();
  await loadChats();
}

async function confirmMapSuggestion(accepted) {
  if (!state.pendingMapSuggestion) return;
  const suggestion = state.pendingMapSuggestion;
  const text = mapSuggestionText.value.trim();
  if (accepted && !text) return;
  const targetTopicSpaceId = mapSuggestionTargetField.classList.contains("hidden")
    ? suggestion.topic_space_id
    : mapSuggestionTarget.value || null;

  renderMapSuggestion(null);
  const response = await api("/llm/map-suggestions/confirm", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      chat_id: suggestion.source_chat_id || state.activeChatId,
      accepted,
      category: suggestion.category,
      text: text || suggestion.text,
      reason: suggestion.reason,
      topic_space_id: targetTopicSpaceId,
    }),
  });
  state.map = response.map;
  state.activeMapNodeId = targetTopicSpaceId || OVERALL_MAP_NODE_ID;
  renderMap();
}

function updateChatReviewNotice(kind, available, label) {
  const button = document.querySelector(`#${kind}-review`);
  const dialog = document.querySelector(`#${kind}-review-dialog`);
  button.classList.toggle("hidden", !available);
  button.textContent = label;
  button.title = label;
  if (!available && dialog.open) {
    dialog.close();
    messageInput.focus({ preventScroll: true });
  }
}

function autoresizeMessageInput() {
  const followLatest = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const maxHeight = Math.max(84, Math.min(240, Math.floor(viewportHeight * 0.3)));
  messageInput.style.maxHeight = `${maxHeight}px`;
  messageInput.style.height = "auto";
  const contentHeight = messageInput.scrollHeight;
  messageInput.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  messageInput.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  if (followLatest) messages.scrollTop = messages.scrollHeight;
}

