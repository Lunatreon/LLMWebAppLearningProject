const API_BASE =
  localStorage.getItem("feely_api_base") || "http://127.0.0.1:8000/api/v1";

const state = {
  mode: "login",
  token: localStorage.getItem("feely_token"),
  user: null,
  chats: [],
  map: null,
  activeChatId: null,
  activeMapNodeId: null,
  mapDetailOpen: true,
  pendingTopic: null,
  pendingMapSuggestion: null,
  completingPracticeId: null,
  pollTimer: null,
  captcha: {
    config: { enabled: false, provider: null, site_key: null },
    loading: false,
    token: "",
    widgetId: null,
  },
};

const authView = document.querySelector("#auth-view");
const chatView = document.querySelector("#chat-view");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const authForm = document.querySelector("#auth-form");
const authHeading = document.querySelector("#auth-heading");
const authSubmit = document.querySelector("#auth-submit");
const authError = document.querySelector("#auth-error");
const usernameField = document.querySelector("#username-field");
const emailInput = document.querySelector("#email");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const websiteInput = document.querySelector("#website");
const captchaField = document.querySelector("#captcha-field");
const captchaWidget = document.querySelector("#captcha-widget");
const captchaStatus = document.querySelector("#captcha-status");
const logoutButton = document.querySelector("#logout-button");
const refreshButton = document.querySelector("#refresh-button");
const newChatButton = document.querySelector("#new-chat-button");
const chatList = document.querySelector("#chat-list");
const chatCount = document.querySelector("#chat-count");
const chatTitle = document.querySelector("#chat-title");
const messages = document.querySelector("#messages");
const messageForm = document.querySelector("#message-form");
const messageInput = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const topicCard = document.querySelector("#topic-card");
const topicTitle = document.querySelector("#topic-title");
const topicAccept = document.querySelector("#topic-accept");
const topicDismiss = document.querySelector("#topic-dismiss");
const mapSuggestionCard = document.querySelector("#map-suggestion-card");
const mapSuggestionCategory = document.querySelector("#map-suggestion-category");
const mapSuggestionTopic = document.querySelector("#map-suggestion-topic");
const mapSuggestionText = document.querySelector("#map-suggestion-text");
const mapSuggestionReason = document.querySelector("#map-suggestion-reason");
const mapSuggestionAccept = document.querySelector("#map-suggestion-accept");
const mapSuggestionDismiss = document.querySelector("#map-suggestion-dismiss");
const userAvatar = document.querySelector("#user-avatar");
const userName = document.querySelector("#user-name");
const userEmail = document.querySelector("#user-email");
const sidebar = document.querySelector("#sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarClose = document.querySelector("#sidebar-close");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const conversationView = document.querySelector("#conversation-view");
const mapView = document.querySelector("#map-view");
const chatWorkspaceButton = document.querySelector("#chat-workspace-button");
const mapWorkspaceButton = document.querySelector("#map-workspace-button");
const mapSidebarToggle = document.querySelector("#map-sidebar-toggle");
const mapContent = document.querySelector("#map-content");
const addTopicButton = document.querySelector("#add-topic-button");
const practiceDialog = document.querySelector("#practice-dialog");
const practiceForm = document.querySelector("#practice-form");
const practiceText = document.querySelector("#practice-text");
const practiceTopic = document.querySelector("#practice-topic");
const reflectionDialog = document.querySelector("#reflection-dialog");
const reflectionForm = document.querySelector("#reflection-form");
const practiceReflection = document.querySelector("#practice-reflection");
const lensToggle = document.querySelector("#lens-toggle");
const lensPanel = document.querySelector("#lens-panel");

const MAP_CATEGORY_LABELS = {
  inherited_script: "Inherited script",
  own_perception: "My perception",
  value: "Value",
  body_signal: "Body signal",
  practice: "Practice",
  evidence: "Evidence",
};

let lastAuthSubmitAt = 0;
let turnstileScriptPromise = null;

class ApiError extends Error {
  constructor(message, status, retryAfter = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function setMode(mode) {
  state.mode = mode;
  const isLogin = mode === "login";
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.setAttribute("aria-selected", String(!isLogin));
  usernameField.classList.toggle("hidden", isLogin);
  usernameInput.required = !isLogin;
  passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
  authHeading.textContent = isLogin ? "Return to your space" : "Create your private space";
  authSubmit.textContent = isLogin ? "Login" : "Create account";
  authError.textContent = "";
  renderCaptcha().catch((error) => {
    captchaStatus.textContent = error instanceof Error ? error.message : String(error);
  });
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
  };
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { detail: responseText };
    }
  }

  if (!response.ok) {
    const detail = payload && payload.detail ? payload.detail : "Request failed";
    let message = Array.isArray(detail) ? detail[0]?.msg : detail;
    const retryAfter = response.headers.get("Retry-After");
    if (response.status === 429 && retryAfter) {
      message = `${message || "Too many requests."} Try again in ${retryAfter} seconds.`;
    }
    throw new ApiError(message || "Request failed", response.status, retryAfter);
  }
  return payload;
}

async function loadCaptchaConfig() {
  try {
    state.captcha.config = await api("/auth/captcha/config");
  } catch {
    state.captcha.config = { enabled: false, provider: null, site_key: null };
  }
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load verification. Please try again."));
    document.head.append(script);
  });
  return turnstileScriptPromise;
}

function resetCaptchaWidget() {
  state.captcha.token = "";
  if (window.turnstile && state.captcha.widgetId !== null) {
    window.turnstile.reset(state.captcha.widgetId);
  }
}

async function renderCaptcha() {
  if (!captchaField || !captchaWidget || !captchaStatus) return;

  const needsCaptcha = state.mode === "register" && state.captcha.config.enabled;
  captchaField.classList.toggle("hidden", !needsCaptcha);
  if (!needsCaptcha) {
    state.captcha.token = "";
    captchaStatus.textContent = "";
    return;
  }

  if (state.captcha.config.provider !== "turnstile" || !state.captcha.config.site_key) {
    captchaStatus.textContent = "Account verification is not configured.";
    return;
  }

  captchaStatus.textContent = "Loading verification...";
  await loadTurnstileScript();
  if (state.mode !== "register") return;

  if (state.captcha.widgetId === null) {
    state.captcha.widgetId = window.turnstile.render(captchaWidget, {
      sitekey: state.captcha.config.site_key,
      callback(token) {
        state.captcha.token = token;
        captchaStatus.textContent = "";
      },
      "expired-callback"() {
        state.captcha.token = "";
        captchaStatus.textContent = "Verification expired. Please verify again.";
      },
      "error-callback"() {
        state.captcha.token = "";
        captchaStatus.textContent = "Verification failed to load. Please try again.";
      },
    });
  } else {
    resetCaptchaWidget();
  }
  captchaStatus.textContent = "";
}

function showAuth() {
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  document.title = "FeelY Chat | Login";
  closeSidebar();
  stopPolling();
}

async function showChat() {
  authView.classList.add("hidden");
  chatView.classList.remove("hidden");
  document.title = "FeelY | Conversations";
  const requestedView = new URLSearchParams(window.location.search).get("view");
  switchWorkspace(requestedView === "map" ? "map" : "chat");
  await Promise.all([loadUser(), loadMap(), loadChats()]);
  startPolling();
}

async function registerAndLogin() {
  const captchaIsEnabled = state.captcha.config.enabled;
  if (captchaIsEnabled && !state.captcha.token) {
    throw new Error("Please complete the verification before creating an account.");
  }

  await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: emailInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value,
      website: websiteInput?.value.trim() || "",
      captcha_token: captchaIsEnabled ? state.captcha.token : null,
    }),
  });
  await login();
}

async function login() {
  const payload = await api("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      email_or_username: emailInput.value.trim(),
      password: passwordInput.value,
    }),
  });
  state.token = payload.access_token;
  localStorage.setItem("feely_token", state.token);
  await showChat();
}

function logout() {
  state.token = null;
  state.user = null;
  state.activeChatId = null;
  state.activeMapNodeId = null;
  state.mapDetailOpen = true;
  state.chats = [];
  state.map = null;
  state.pendingTopic = null;
  state.pendingMapSuggestion = null;
  localStorage.removeItem("feely_token");
  authForm.reset();
  renderChats();
  renderMessages([]);
  renderTopic(null);
  renderMapSuggestion(null);
  renderUser();
  showAuth();
}

async function loadUser() {
  state.user = await api("/users/me", { headers: authHeaders() });
  renderUser();
}

async function loadMap() {
  state.map = await api("/users/me/map", { headers: authHeaders() });
  renderMap();
}

function renderUser() {
  const username = state.user?.username || "Your space";
  userName.textContent = username;
  userEmail.textContent = state.user?.email || "Private account";
  userAvatar.textContent = username.charAt(0) || "Y";
}

async function loadChats() {
  state.chats = await api("/llm/chats", { headers: authHeaders() });

  const activeChatStillExists = state.chats.some(
    (chat) => chat.chat_id === state.activeChatId,
  );
  if (!activeChatStillExists) {
    state.activeChatId = state.chats[0]?.chat_id || null;
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

async function createChat() {
  const chat = await api("/llm/chats", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ title: "New conversation" }),
  });
  state.activeChatId = chat.chat_id;
  upsertChat({ ...chat, messages: [] });
  chatTitle.textContent = chat.title || "New conversation";
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

function renderMessages(items) {
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
  messages.scrollTop = messages.scrollHeight;
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

function renderTopic(topic) {
  state.pendingTopic = topic;
  topicCard.classList.toggle("hidden", !topic);
  if (!topic) {
    topicTitle.textContent = "";
    return;
  }
  topicTitle.textContent = topic.topic;
}

function renderMapSuggestion(suggestion) {
  state.pendingMapSuggestion = suggestion;
  mapSuggestionCard.classList.toggle("hidden", !suggestion);
  if (!suggestion) {
    mapSuggestionCategory.textContent = "";
    mapSuggestionTopic.textContent = "";
    mapSuggestionText.value = "";
    mapSuggestionReason.textContent = "";
    return;
  }

  mapSuggestionCategory.textContent =
    MAP_CATEGORY_LABELS[suggestion.category] || suggestion.category;
  mapSuggestionTopic.textContent = suggestion.topic_title
    ? `Topic: ${suggestion.topic_title}`
    : "Not connected to a topic yet";
  mapSuggestionText.value = suggestion.text || "";
  mapSuggestionReason.textContent = suggestion.reason || "";
}

async function sendMessage(event) {
  event.preventDefault();
  const context = messageInput.value.trim();
  if (!context || sendButton.disabled) return;

  if (!state.activeChatId) {
    await createChat();
  }

  sendButton.disabled = true;
  messageInput.value = "";
  autoresizeMessageInput();

  const currentChat = state.chats.find((chat) => chat.chat_id === state.activeChatId);
  const existingMessages = currentChat?.messages || [];
  renderMessages([...existingMessages, { role: "user", content: context }]);
  const waitingMessage = showWaitingMessage();

  try {
    const response = await api("/llm/message", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        chat_id: state.activeChatId,
        context,
      }),
    });
    const updatedChat = {
      chat_id: response.chat_id,
      title: response.chat_info.title || "New conversation",
      message_count: response.chat_info.message_count || 0,
      updated_at: response.chat_info.updated_at,
      pending_topic: response.chat_info.pending_topic || null,
      messages: response.chat_info.messages || [],
      pending_map_suggestion: response.map_suggestion || null,
    };
    state.activeChatId = response.chat_id;
    upsertChat(updatedChat);
    chatTitle.textContent = updatedChat.title;
    document.title = `${updatedChat.title} | FeelY`;
    renderChats();
    renderMessages(updatedChat.messages);
    renderMapSuggestion(response.map_suggestion || null);
    renderTopic(null);
    pollTopicSoon();
  } catch (error) {
    waitingMessage.remove();
    renderInlineError(error);
  } finally {
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
  const bubble = document.createElement("article");
  bubble.className = "message assistant";
  bubble.textContent = error instanceof Error ? error.message : String(error);
  messages.append(bubble);
  messages.scrollTop = messages.scrollHeight;
}

function pollTopicSoon() {
  setTimeout(() => {
    pollTopicOnce().catch(() => {});
  }, 700);
}

async function pollTopicOnce() {
  if (!state.activeChatId || !state.token) return;
  const payload = await api(
    `/llm/chats/${encodeURIComponent(state.activeChatId)}/topic-suggestion`,
    { headers: authHeaders() },
  );
  renderTopic(payload.suggestion);
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    pollTopicOnce().catch(() => {});
  }, 2500);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

async function confirmTopic(accepted) {
  if (!state.pendingTopic) return;
  const topic = state.pendingTopic;
  renderTopic(null);
  await api("/llm/topics/confirm", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      chat_id: topic.chat_id,
      topic: topic.topic,
      description: topic.description,
      accepted,
    }),
  });
  await loadMap();
  await loadChats();
}

async function confirmMapSuggestion(accepted) {
  if (!state.pendingMapSuggestion) return;
  const suggestion = state.pendingMapSuggestion;
  const text = mapSuggestionText.value.trim();
  if (accepted && !text) return;

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
      topic_space_id: suggestion.topic_space_id,
    }),
  });
  state.map = response.map;
  renderMap();
}

function autoresizeMessageInput() {
  messageInput.style.height = "auto";
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 160)}px`;
}

function openSidebar() {
  sidebar.classList.add("open");
  sidebarBackdrop.classList.remove("hidden");
}

function closeSidebar() {
  sidebar.classList.remove("open");
  sidebarBackdrop.classList.add("hidden");
}

function switchWorkspace(view) {
  const showMap = view === "map";
  if (showMap) {
    state.activeMapNodeId = null;
    state.mapDetailOpen = false;
  }
  conversationView.classList.toggle("hidden", showMap);
  mapView.classList.toggle("hidden", !showMap);
  chatWorkspaceButton.classList.toggle("active", !showMap);
  mapWorkspaceButton.classList.toggle("active", showMap);
  chatWorkspaceButton.setAttribute("aria-selected", String(!showMap));
  mapWorkspaceButton.setAttribute("aria-selected", String(showMap));
  document.title = showMap ? "My Map | FeelY" : `${chatTitle.textContent} | FeelY`;
  closeSidebar();
  if (showMap) loadMap().catch(renderInlineError);
}

function createMapEntryElement(entry) {
  const item = document.createElement("article");
  item.className = "map-entry";
  item.dataset.category = entry.category;

  const label = document.createElement("span");
  label.className = "map-entry-label";
  label.textContent = MAP_CATEGORY_LABELS[entry.category] || entry.category;

  const text = document.createElement("p");
  text.textContent = entry.text;
  item.append(label, text);

  if (entry.category === "practice") {
    const status = document.createElement("span");
    status.className = "practice-status";
    status.textContent = entry.status || "active";
    item.append(status);

    const controls = document.createElement("div");
    controls.className = "practice-controls";
    if (entry.status !== "completed") {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.textContent = entry.status === "paused" ? "Resume" : "Pause";
      toggle.addEventListener("click", () => {
        updatePractice(entry.id, entry.status === "paused" ? "active" : "paused").catch(
          renderInlineError,
        );
      });

      const complete = document.createElement("button");
      complete.type = "button";
      complete.textContent = "Reflect and complete";
      complete.addEventListener("click", () => openReflectionDialog(entry.id));
      controls.append(toggle, complete);
    } else {
      const reactivate = document.createElement("button");
      reactivate.type = "button";
      reactivate.textContent = "Practice again";
      reactivate.addEventListener("click", () => updatePractice(entry.id, "active").catch(renderInlineError));
      controls.append(reactivate);
    }
    item.append(controls);

    if (entry.reflection) {
      const reflection = document.createElement("p");
      reflection.className = "practice-reflection";
      reflection.textContent = entry.reflection;
      item.append(reflection);
    }
  }
  return item;
}

function primaryEntryCategory(entries) {
  const counts = entries.reduce((totals, entry) => {
    totals[entry.category] = (totals[entry.category] || 0) + 1;
    return totals;
  }, {});
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

function createConceptNode(node, index) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "map-node";
  button.dataset.category = primaryEntryCategory(node.entries || []);
  button.setAttribute("aria-pressed", String(node.id === state.activeMapNodeId));
  button.setAttribute("aria-label", `Open ${node.title}`);
  const position = mapNodePosition(index);
  button.style.left = `${position.x}%`;
  button.style.top = `${position.y}%`;
  button.style.setProperty("--node-delay", `${index * 90}ms`);

  const title = document.createElement("strong");
  title.textContent = node.title;
  const meta = document.createElement("span");
  const entryCount = node.entries?.length || 0;
  meta.textContent =
    node.id === state.activeMapNodeId && !state.mapDetailOpen
      ? "Open details"
      : `${entryCount} ${entryCount === 1 ? "entry" : "entries"}`;
  button.append(title, meta);

  button.addEventListener("click", () => {
    state.activeMapNodeId = node.id;
    state.mapDetailOpen = true;
    renderMap();
  });
  return button;
}

async function createThreadMapEntry(node, category, text) {
  const response = await api("/users/me/map/entries", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      category,
      text,
      topic_space_id: node.kind === "topic" ? node.id : null,
      source_chat_id: state.activeChatId,
    }),
  });
  state.map = response.map;
  state.activeMapNodeId = node.id;
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
  if (!window.confirm("Delete this map entry? This cannot be undone.")) return;
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
  document.querySelector(".map-action-backdrop")?.remove();
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
  titleInput.required = true;
  titleInput.maxLength = 120;
  titleInput.placeholder = "Topic title";
  titleInput.value = topic?.title || "";

  const descriptionInput = document.createElement("textarea");
  descriptionInput.rows = 3;
  descriptionInput.maxLength = 1000;
  descriptionInput.placeholder = "Optional note about this topic";
  descriptionInput.value = topic?.description || "";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = isEdit ? "Save topic" : "Create topic";
  form.append(titleInput, descriptionInput, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const titleText = titleInput.value.trim();
    if (!titleText) return;
    closeMapActionPopup();
    const payload = {
      title: titleText,
      description: descriptionInput.value.trim(),
    };
    const request = isEdit
      ? updateMapTopic(topic.id, payload)
      : createMapTopic({ ...payload, chat_id: state.activeChatId });
    request.catch(renderInlineError);
  });

  popup.append(closeButton, eyebrow, title, form);
  backdrop.append(popup);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeMapActionPopup();
  });
  document.body.append(backdrop);
  titleInput.focus();
}

async function createMapTopic(payload) {
  const response = await api("/users/me/map/topics", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  state.map = response.map;
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
  state.activeMapNodeId = response.topic.id;
  state.mapDetailOpen = true;
  renderMap();
}

async function deleteMapTopic(topic) {
  if (
    !window.confirm(
      "Delete this topic? Its entries will move to Across topics instead of being deleted.",
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
  popup.setAttribute("aria-label", isEdit ? "Edit entry" : isTask ? "Add task" : "Add entry");

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
  title.textContent = isPracticeEdit ? "Edit task" : isEdit ? "Edit entry" : isTask ? "Add a task" : "Add an entry";

  const form = document.createElement("form");
  form.className = "map-action-form";

  let categoryInput = null;
  if (!isTask && !isPracticeEdit) {
    categoryInput = document.createElement("select");
    categoryInput.setAttribute("aria-label", "Entry type");
    [
      "own_perception",
      "value",
      "body_signal",
      "evidence",
      "inherited_script",
    ].forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = MAP_CATEGORY_LABELS[category] || category;
      categoryInput.append(option);
    });
    form.append(categoryInput);
    if (entry) categoryInput.value = entry.category;
  }

  const textInput = document.createElement("textarea");
  textInput.rows = 4;
  textInput.required = true;
  textInput.placeholder = isTask
    ? "What task or practice belongs to this thread?"
    : "What observation do you want to save here?";
  if (entry) textInput.value = entry.text || "";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = isEdit ? "Save changes" : isTask ? "Save task" : "Save entry";
  form.append(textInput, submit);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = textInput.value.trim();
    if (!text) return;
    closeMapActionPopup();
    if (isEdit) {
      updateMapEntry(entry.id, {
        category: isPracticeEdit ? "practice" : categoryInput.value,
        text,
      }).catch(renderInlineError);
    } else {
      createThreadMapEntry(node, isTask ? "practice" : categoryInput.value, text).catch(
        renderInlineError,
      );
    }
  });

  popup.append(closeButton, eyebrow, title, form);
  backdrop.append(popup);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeMapActionPopup();
  });
  document.body.append(backdrop);
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
      statusButton.textContent = entry.status === "paused" ? "Resume task" : "Pause task";
      statusButton.addEventListener("click", () => {
        closeEntryMenus();
        updatePractice(entry.id, entry.status === "paused" ? "active" : "paused").catch(
          renderInlineError,
        );
      });
      menu.append(statusButton);

      const completeButton = document.createElement("button");
      completeButton.type = "button";
      completeButton.textContent = "Complete task";
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
    ["task", "+ Task"],
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
  eyebrow.textContent = node.kind === "unassigned" ? "Across topics" : "Selected thread";

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
    editTopicButton.textContent = "Edit title";
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
  const entries = node.entries || [];
  [`${chats} ${chats === 1 ? "chat" : "chats"}`, `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`].forEach(
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

  panel.append(closeButton, eyebrow, titleRow, stats, signals);
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

function renderMap() {
  mapContent.replaceChildren();


  const map = state.map || { topic_spaces: [], unassigned_entries: [] };
  const spaces = map.topic_spaces || [];
  const unassigned = map.unassigned_entries || [];
  if (!spaces.length && !unassigned.length) {
    const empty = document.createElement("p");
    empty.className = "map-empty";
    empty.textContent =
      "When you accept a recurring topic or save a useful observation from chat, it will appear here. You can also begin with one small practice.";
    mapContent.append(empty);
    return;
  }

  const nodes = spaces.map((space) => ({
    ...space,
    kind: "topic",
    title: space.title || "Untitled",
    description: space.description || "A thread you chose to keep visible.",
    entries: space.entries || [],
  }));
  if (unassigned.length) {
    nodes.push({
      id: "__across_topics",
      kind: "unassigned",
      title: "Across topics",
      description: "Observations and practices that belong to more than one thread.",
      chat_ids: [],
      entries: unassigned,
    });
  }

  if (!nodes.some((node) => node.id === state.activeMapNodeId)) {
    state.activeMapNodeId = null;
    state.mapDetailOpen = false;
  }
  const activeNode = nodes.find((node) => node.id === state.activeMapNodeId) || null;

  const layout = document.createElement("section");
  layout.className = "map-concept-layout";

  const board = document.createElement("div");
  board.className = "map-concept-board";
  board.setAttribute("aria-label", "Interactive concept map");
  ["one", "two", "three"].forEach((name) => {
    const line = document.createElement("span");
    line.className = `map-connection map-connection-${name}`;
    board.append(line);
  });
  nodes.forEach((node, index) => board.append(createConceptNode(node, index)));

  const detailWrap = document.createElement("div");
  detailWrap.className = "map-detail-drawer";
  if (!state.mapDetailOpen || !activeNode) detailWrap.classList.add("hidden");
  if (state.mapDetailOpen && activeNode) detailWrap.append(createConceptDetails(activeNode));

  layout.append(board, detailWrap);
  mapContent.append(layout);
}

function openPracticeDialog() {
  practiceText.value = "";
  practiceTopic.replaceChildren();
  const unassigned = document.createElement("option");
  unassigned.value = "";
  unassigned.textContent = "Across topics";
  practiceTopic.append(unassigned);
  (state.map?.topic_spaces || []).forEach((space) => {
    const option = document.createElement("option");
    option.value = space.id;
    option.textContent = space.title;
    practiceTopic.append(option);
  });
  practiceDialog.showModal();
  practiceText.focus();
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

async function createPractice(event) {
  event.preventDefault();
  const text = practiceText.value.trim();
  if (!text) return;
  const response = await api("/users/me/map/entries", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      category: "practice",
      text,
      topic_space_id: practiceTopic.value || null,
      source_chat_id: state.activeChatId,
    }),
  });
  state.map = response.map;
  renderMap();
  practiceDialog.close();
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

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
logoutButton.addEventListener("click", logout);
refreshButton.addEventListener("click", () => loadChats().catch(renderInlineError));
newChatButton.addEventListener("click", () => {
  switchWorkspace("chat");
  createChat().catch(renderInlineError);
});
sidebarToggle.addEventListener("click", openSidebar);
mapSidebarToggle.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);
chatWorkspaceButton.addEventListener("click", () => switchWorkspace("chat"));
mapWorkspaceButton.addEventListener("click", () => switchWorkspace("map"));
messageForm.addEventListener("submit", sendMessage);
topicAccept.addEventListener("click", () => confirmTopic(true).catch(renderInlineError));
topicDismiss.addEventListener("click", () => confirmTopic(false).catch(renderInlineError));
mapSuggestionAccept.addEventListener("click", () =>
  confirmMapSuggestion(true).catch(renderInlineError),
);
mapSuggestionDismiss.addEventListener("click", () =>
  confirmMapSuggestion(false).catch(renderInlineError),
);
addTopicButton.addEventListener("click", () => openMapTopicPopup());
practiceForm.addEventListener("submit", (event) => createPractice(event).catch(renderInlineError));
reflectionForm.addEventListener("submit", (event) =>
  completePractice(event).catch(renderInlineError),
);
document.addEventListener("click", (event) => {
  if (
    !event.target.closest(".chat-actions-menu") &&
    !event.target.closest(".chat-actions-button")
  ) {
    closeChatActionsMenu();
  }
  if (!event.target.closest(".map-entry-menu") && !event.target.closest(".map-entry-menu-button")) {
    closeEntryMenus();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeChatActionsMenu();
  if (event.key === "Escape") closeMapActionPopup();
  if (event.key === "Escape") closeEntryMenus();
});
chatList.addEventListener("scroll", closeChatActionsMenu);
window.addEventListener("resize", closeChatActionsMenu);
document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(`#${button.dataset.closeDialog}`).close();
  });
});
lensToggle.addEventListener("click", () => {
  const isOpen = lensPanel.classList.toggle("hidden") === false;
  lensToggle.setAttribute("aria-expanded", String(isOpen));
});
document.querySelectorAll("[data-lens]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.lens;
    messageInput.value = messageInput.value.trim()
      ? `${messageInput.value.trim()}\n\n${prompt}`
      : prompt;
    autoresizeMessageInput();
    lensPanel.classList.add("hidden");
    lensToggle.setAttribute("aria-expanded", "false");
    messageInput.focus();
  });
});
messageInput.addEventListener("input", autoresizeMessageInput);
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    messageForm.requestSubmit();
  }
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.textContent = "";
  const now = Date.now();
  if (now - lastAuthSubmitAt < 1200) {
    authError.textContent = "Please wait a moment before trying again.";
    return;
  }
  lastAuthSubmitAt = now;
  authSubmit.disabled = true;
  const submitLabel = state.mode === "register" ? "Creating account..." : "Logging in...";
  authSubmit.textContent = submitLabel;
  try {
    if (state.mode === "register") {
      await registerAndLogin();
    } else {
      await login();
    }
  } catch (error) {
    authError.textContent = error instanceof Error ? error.message : String(error);
    if (state.mode === "register") resetCaptchaWidget();
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = state.mode === "register" ? "Create account" : "Login";
  }
});

async function init() {
  await loadCaptchaConfig();
  setMode("login");
  renderUser();
  if (state.token) {
    showChat().catch(() => logout());
  } else {
    showAuth();
  }
}

init().catch(() => {
  setMode("login");
  renderUser();
  showAuth();
});
