const API_BASE =
  localStorage.getItem("feely_api_base") || "http://127.0.0.1:8000/api/v1";

const state = {
  mode: "login",
  token: localStorage.getItem("feely_token"),
  user: null,
  chats: [],
  activeChatId: null,
  pendingTopic: null,
  pollTimer: null,
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
const userAvatar = document.querySelector("#user-avatar");
const userName = document.querySelector("#user-name");
const userEmail = document.querySelector("#user-email");
const sidebar = document.querySelector("#sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarClose = document.querySelector("#sidebar-close");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");

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
    const message = Array.isArray(detail) ? detail[0]?.msg : detail;
    throw new Error(message || "Request failed");
  }
  return payload;
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
  await Promise.all([loadUser(), loadChats()]);
  startPolling();
}

async function registerAndLogin() {
  await api("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: emailInput.value.trim(),
      username: usernameInput.value.trim(),
      password: passwordInput.value,
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
  state.chats = [];
  state.pendingTopic = null;
  localStorage.removeItem("feely_token");
  authForm.reset();
  renderChats();
  renderMessages([]);
  renderTopic(null);
  renderUser();
  showAuth();
}

async function loadUser() {
  state.user = await api("/users/me", { headers: authHeaders() });
  renderUser();
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
  renderChats();
  closeSidebar();
  await pollTopicOnce();
}

function renderChats() {
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = chat.chat_id === state.activeChatId ? "active" : "";
    button.setAttribute("aria-current", chat.chat_id === state.activeChatId ? "page" : "false");

    const title = document.createElement("strong");
    title.textContent = chat.title || "New conversation";
    const meta = document.createElement("span");
    const count = chat.message_count || chat.messages?.length || 0;
    meta.textContent = `${count} ${count === 1 ? "message" : "messages"}`;
    button.append(title, meta);

    button.addEventListener("click", () => loadChat(chat.chat_id).catch(renderInlineError));
    chatList.append(button);
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

function renderTopic(topic) {
  state.pendingTopic = topic;
  topicCard.classList.toggle("hidden", !topic);
  if (!topic) {
    topicTitle.textContent = "";
    return;
  }
  topicTitle.textContent = topic.topic;
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
    };
    state.activeChatId = response.chat_id;
    upsertChat(updatedChat);
    chatTitle.textContent = updatedChat.title;
    document.title = `${updatedChat.title} | FeelY`;
    renderChats();
    renderMessages(updatedChat.messages);
    renderTopic(null);
    pollTopicSoon();
  } catch (error) {
    renderInlineError(error);
  } finally {
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
  await loadChats();
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

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
logoutButton.addEventListener("click", logout);
refreshButton.addEventListener("click", () => loadChats().catch(renderInlineError));
newChatButton.addEventListener("click", () => createChat().catch(renderInlineError));
sidebarToggle.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);
messageForm.addEventListener("submit", sendMessage);
topicAccept.addEventListener("click", () => confirmTopic(true).catch(renderInlineError));
topicDismiss.addEventListener("click", () => confirmTopic(false).catch(renderInlineError));
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
  } finally {
    authSubmit.disabled = false;
    authSubmit.textContent = state.mode === "register" ? "Create account" : "Login";
  }
});

setMode("login");
renderUser();
if (state.token) {
  showChat().catch(() => logout());
} else {
  showAuth();
}
