function scrubSensitiveAuthParams() {
  const url = new URL(window.location.href);
  const sensitiveNames = new Set([
    "email",
    "email_or_username",
    "username",
    "password",
    "current_password",
    "new_password",
    "website",
  ]);
  let changed = false;
  [...url.searchParams.keys()].forEach((name) => {
    if (sensitiveNames.has(name.toLowerCase())) {
      url.searchParams.delete(name);
      changed = true;
    }
  });
  if (changed) window.history.replaceState({}, document.title, url.toString());
}

scrubSensitiveAuthParams();

function resolveApiBase() {
  const urlBase = new URLSearchParams(window.location.search).get("api_base")?.trim();
  if (urlBase) return urlBase.replace(/\/$/, "");

  if (
    window.location.protocol === "file:" ||
    ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(window.location.hostname)
  ) {
    return "http://127.0.0.1:8000/api/v1";
  }

  const configuredBase = document
    .querySelector('meta[name="feely-api-base"]')
    ?.content.trim();
  if (configuredBase) return configuredBase.replace(/\/$/, "");

  const storedBase = localStorage.getItem("feely_api_base")?.trim();
  if (storedBase) return storedBase.replace(/\/$/, "");

  return `${window.location.origin}/api/v1`;
}

const API_BASE = resolveApiBase();

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
    config: { enabled: false, provider: null, site_key: null, action: null },
    loading: false,
    token: "",
    widgetId: null,
  },
  google: {
    config: { enabled: false, client_id: null },
    buttonRendered: false,
  },
  account: null,
  subscription: null,
};

const authView = document.querySelector("#auth-view");
const chatView = document.querySelector("#chat-view");
const loginTab = document.querySelector("#login-tab");
const registerTab = document.querySelector("#register-tab");
const authForm = document.querySelector("#auth-form");
const authHeading = document.querySelector("#auth-heading");
const authSubmit = document.querySelector("#auth-submit");
const authError = document.querySelector("#auth-error");
const authStatus = document.querySelector("#auth-status");
const usernameField = document.querySelector("#username-field");
const emailInput = document.querySelector("#email");
const usernameInput = document.querySelector("#username");
const passwordInput = document.querySelector("#password");
const websiteInput = document.querySelector("#website");
const captchaField = document.querySelector("#captcha-field");
const captchaWidget = document.querySelector("#captcha-widget");
const captchaStatus = document.querySelector("#captcha-status");
const googleAuthField = document.querySelector("#google-auth-field");
const googleButton = document.querySelector("#google-button");
const logoutButton = document.querySelector("#logout-button");
const accountButton = document.querySelector("#account-button");
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
const mapPlanBadge = document.querySelector("#map-plan-badge");
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
const accountDialog = document.querySelector("#account-dialog");
const accountForm = document.querySelector("#account-form");
const passwordForm = document.querySelector("#password-form");
const accountStatus = document.querySelector("#account-status");
const accountDisplayName = document.querySelector("#account-display-name");
const accountUsername = document.querySelector("#account-username");
const accountEmail = document.querySelector("#account-email");
const accountAvatarUrl = document.querySelector("#account-avatar-url");
const accountBio = document.querySelector("#account-bio");
const accountEmailStatus = document.querySelector("#account-email-status");
const requestVerificationButton = document.querySelector("#request-verification-button");
const currentPasswordField = document.querySelector("#current-password-field");
const accountCurrentPassword = document.querySelector("#account-current-password");
const accountNewPassword = document.querySelector("#account-new-password");
const deleteAccountButton = document.querySelector("#delete-account-button");
const billingPlan = document.querySelector("#billing-plan");
const billingStatus = document.querySelector("#billing-status");
const billingSubscribeActions = document.querySelector("#billing-subscribe-actions");
const subscribeMonthlyButton = document.querySelector("#subscribe-monthly-button");
const subscribeYearlyButton = document.querySelector("#subscribe-yearly-button");
const resumeSubscriptionButton = document.querySelector("#resume-subscription-button");
const manageSubscriptionButton = document.querySelector("#manage-subscription-button");
const cancelSubscriptionButton = document.querySelector("#cancel-subscription-button");
const billingManagementNote = document.querySelector("#billing-management-note");
const billingSubscriptionStatus = document.querySelector("#billing-subscription-status");
const billingPeriodRow = document.querySelector("#billing-period-row");
const billingPeriodLabel = document.querySelector("#billing-period-label");
const billingPeriodEnd = document.querySelector("#billing-period-end");
const billingResultBanner = document.querySelector("#billing-result-banner");
const billingResultText = document.querySelector("#billing-result-text");
const billingResultDismiss = document.querySelector("#billing-result-dismiss");
const accountDialogAvatar = document.querySelector("#account-dialog-avatar");
const stripeCancelDialog = document.querySelector("#stripe-cancel-dialog");
const stripeCancelForm = document.querySelector("#stripe-cancel-form");
const stripeCancelCopy = document.querySelector("#stripe-cancel-copy");
const stripeCancelStatus = document.querySelector("#stripe-cancel-status");
const confirmStripeCancel = document.querySelector("#confirm-stripe-cancel");
const lensToggle = document.querySelector("#lens-toggle");
const lensPanel = document.querySelector("#lens-panel");
const chatPlanCopy = document.querySelector("#chat-plan-copy");
const chatPlanUpgrade = document.querySelector("#chat-plan-upgrade");

const MAP_CATEGORY_LABELS = {
  inherited_script: "Inherited script",
  own_perception: "My perception",
  value: "Value",
  body_signal: "Body signal",
  practice: "Practice",
  evidence: "Evidence",
};

const TOPIC_POLL_DELAYS = [700, 1800, 4000, 8000];

let lastAuthSubmitAt = 0;
let turnstileScriptPromise = null;
let googleScriptPromise = null;
let billingResultTimer = null;

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
  renderGoogleAuth().catch((error) => {
    if (authStatus) authStatus.textContent = error instanceof Error ? error.message : String(error);
  });
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
  };
}

async function api(path, options = {}) {
  let response;
  const canRetry = !options.method || options.method.toUpperCase() === "GET";
  const attempts = canRetry ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });
      break;
    } catch {
      if (attempt + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      throw new ApiError(
        "FeelY temporarily lost its connection. Please try again in a moment.",
        0,
      );
    }
  }

  const responseText = await response.text();
  let payload = null;
  const responseType = response.headers.get("Content-Type") || "";
  if (responseText) {
    if (responseType.includes("application/json")) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
    }
  }

  if (!response.ok) {
    const detail = payload?.detail || (
      responseType.includes("text/html") || responseText.includes("trusted folder")
        ? "The FeelY page reached a file server instead of the backend. Check the API URL."
        : "Request failed"
    );
    let message = Array.isArray(detail) ? detail[0]?.msg : detail;
    const retryAfter = response.headers.get("Retry-After");
    if (response.status === 429 && retryAfter) {
      message = `${message || "Too many requests."} Try again in ${retryAfter} seconds.`;
    }
    throw new ApiError(message || "Request failed", response.status, retryAfter);
  }
  return payload;
}

async function apiStream(path, options, onEvent) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new ApiError(
      "FeelY temporarily lost its connection. Your message is still in the input box so you can retry.",
      0,
    );
  }
  if (!response.ok || !response.body) {
    let detail = "Request failed";
    try {
      detail = (await response.json()).detail || detail;
    } catch {}
    throw new ApiError(detail, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

async function loadCaptchaConfig() {
  try {
    state.captcha.config = await api("/auth/captcha/config");
  } catch {
    state.captcha.config = { enabled: false, provider: null, site_key: null, action: null };
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
      action: state.captcha.config.action || "register",
      size: "flexible",
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

async function loadGoogleConfig() {
  try {
    state.google.config = await api("/auth/google/config");
  } catch {
    state.google.config = { enabled: false, client_id: null };
  }
}

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (googleScriptPromise) return googleScriptPromise;

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.append(script);
  });
  return googleScriptPromise;
}

async function renderGoogleAuth() {
  if (!googleAuthField || !googleButton) return;
  const enabled = state.google.config.enabled && state.google.config.client_id;
  googleAuthField.classList.toggle("hidden", !enabled);
  if (!enabled || state.google.buttonRendered) return;

  await loadGoogleScript();
  window.google.accounts.id.initialize({
    client_id: state.google.config.client_id,
    callback: handleGoogleCredential,
  });
  window.google.accounts.id.renderButton(googleButton, {
    theme: "outline",
    size: "large",
    width: googleButton.offsetWidth || 320,
    text: state.mode === "register" ? "signup_with" : "signin_with",
  });
  state.google.buttonRendered = true;
}

async function handleGoogleCredential(response) {
  if (!response?.credential) return;
  if (authStatus) authStatus.textContent = "Signing in with Google...";
  try {
    const payload = await api("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential }),
    });
    state.token = payload.access_token;
    localStorage.setItem("feely_token", state.token);
    if (authStatus) authStatus.textContent = "";
    await showChat();
  } catch (error) {
    authError.textContent = error instanceof Error ? error.message : String(error);
    if (authStatus) authStatus.textContent = "";
  }
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
  await loadSubscription();
  await Promise.all([loadUser(), loadChats()]);
  if (hasMyMapAccess()) {
    await loadMap();
  } else {
    renderMap();
  }
  switchWorkspace(requestedView === "map" ? "map" : "chat");
  startPolling();
  await handleCheckoutReturn();
  await handleAccountReturn(requestedView);
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
  state.account = null;
  state.subscription = null;
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
  state.user = await api("/users/me/account", { headers: authHeaders() });
  state.account = state.user;
  renderUser();
}

function freeSubscriptionState() {
  return {
    status: "none",
    plan: "free",
    premium: false,
    my_map_access: false,
    chat_daily_limit: 10,
    cancel_at_period_end: false,
    current_period_end: null,
    billing_available: false,
    available_plans: [],
    management_available: false,
    can_resume: false,
  };
}

function hasMyMapAccess() {
  return Boolean(state.subscription?.my_map_access);
}

async function loadSubscription() {
  try {
    state.subscription = await api("/billing/subscription", { headers: authHeaders() });
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) throw error;
    state.subscription = freeSubscriptionState();
  }
  renderSubscription();
}

async function loadMap() {
  if (!hasMyMapAccess()) {
    state.map = null;
    renderMap();
    return;
  }
  state.map = await api("/users/me/map", { headers: authHeaders() });
  renderMap();
}

function renderUser() {
  const username = state.user?.display_name || state.user?.username || "Your space";
  userName.textContent = username;
  userEmail.textContent = state.user?.email || "Private account";
  userAvatar.textContent = username.charAt(0) || "Y";
}

function renderAccountDialog() {
  const account = state.account || state.user || {};
  const avatarText = (account.display_name || account.username || account.email || "Y")
    .trim()
    .charAt(0)
    .toUpperCase();
  accountDialogAvatar.textContent = avatarText || "Y";
  accountDisplayName.value = account.display_name || "";
  accountUsername.value = account.username || "";
  accountEmail.value = account.email || "";
  accountAvatarUrl.value = account.avatar_url || "";
  accountBio.value = account.bio || "";
  accountEmailStatus.textContent = account.is_email_verified
    ? "Email verified"
    : "Email not verified";
  requestVerificationButton.hidden = Boolean(account.is_email_verified);
  currentPasswordField.classList.toggle("hidden", !account.has_password);
  accountCurrentPassword.required = Boolean(account.has_password);
  accountNewPassword.value = "";
  accountCurrentPassword.value = "";
}

function renderSubscription() {
  const subscription = state.subscription || freeSubscriptionState();
  const planLabels = {
    free: "Free",
    monthly: "Premium monthly",
    yearly: "Premium yearly",
    premium: "Premium",
  };
  billingPlan.textContent = planLabels[subscription.plan] || "Free";

  const statusLabels = {
    none: "No subscription",
    trialing: "Trial",
    active: "Active",
    past_due: "Payment past due",
    unpaid: "Unpaid",
    canceled: "Canceled",
    incomplete: "Incomplete",
    incomplete_expired: "Expired",
    paused: "Paused",
  };
  billingSubscriptionStatus.textContent = subscription.cancel_at_period_end
    ? "Cancellation scheduled"
    : statusLabels[subscription.status] || "Unknown";

  const periodEnd = formatBillingDate(subscription.current_period_end);
  billingPeriodRow.hidden = !periodEnd;
  if (periodEnd) {
    if (subscription.cancel_at_period_end) {
      billingPeriodLabel.textContent = "Premium access ends";
    } else if (subscription.status === "canceled") {
      billingPeriodLabel.textContent = "Subscription ended";
    } else {
      billingPeriodLabel.textContent = "Current period ends";
    }
    billingPeriodEnd.textContent = periodEnd;
  }

  if (subscription.premium && subscription.cancel_at_period_end) {
    billingStatus.textContent = periodEnd
      ? `Your subscription is scheduled to cancel. Premium remains active until ${periodEnd}.`
      : "Your subscription is scheduled to cancel after the paid period ends.";
  } else if (subscription.status === "canceled") {
    billingStatus.textContent = "Your subscription has ended and will not renew.";
  } else if (["past_due", "unpaid"].includes(subscription.status)) {
    billingStatus.textContent = "Your latest payment needs attention. Open billing to update it.";
  } else if (subscription.premium) {
    billingStatus.textContent = "Your Premium subscription is active.";
  } else if (!subscription.billing_available) {
    billingStatus.textContent = "Premium subscriptions are not available yet.";
  } else {
    billingStatus.textContent = "You are currently using the Free plan.";
  }

  const availablePlans = Array.isArray(subscription.available_plans)
    ? subscription.available_plans
    : [];
  subscribeMonthlyButton.hidden = !availablePlans.includes("monthly");
  subscribeYearlyButton.hidden = !availablePlans.includes("yearly");
  billingSubscribeActions.hidden =
    !subscription.billing_available || subscription.premium || availablePlans.length === 0;
  resumeSubscriptionButton.hidden = !subscription.can_resume;
  manageSubscriptionButton.hidden = !subscription.management_available;
  billingManagementNote.hidden = !subscription.management_available;
  const cancelableStatuses = ["active", "trialing", "past_due", "unpaid"];
  cancelSubscriptionButton.hidden = !(
    subscription.management_available &&
    cancelableStatuses.includes(subscription.status) &&
    !subscription.cancel_at_period_end
  );
  renderPremiumAccess();
}

function renderPremiumAccess() {
  const mapAccess = hasMyMapAccess();
  const dailyLimit = state.subscription?.chat_daily_limit || 10;
  mapPlanBadge.hidden = false;
  mapPlanBadge.textContent = mapAccess ? "Premium" : "Unlock";
  mapPlanBadge.classList.toggle("active", mapAccess);
  mapWorkspaceButton.classList.toggle("premium-locked", !mapAccess);
  mapWorkspaceButton.title = mapAccess ? "Open My Map" : "My Map is included with Premium";
  addTopicButton.hidden = !mapAccess;
  chatPlanCopy.textContent = mapAccess
    ? `Premium - up to ${dailyLimit} messages per day.`
    : `Free plan - ${dailyLimit} messages per day.`;
  chatPlanUpgrade.hidden = mapAccess;

  if (!mapAccess) {
    state.map = null;
    renderMapSuggestion(null);
    if (!mapView.classList.contains("hidden")) renderMap();
  }
}

function formatBillingDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

function showBillingResult(message, kind = "info", autoDismiss = true) {
  if (billingResultTimer) window.clearTimeout(billingResultTimer);
  billingResultText.textContent = message;
  billingResultBanner.dataset.kind = kind;
  billingResultBanner.classList.remove("hidden");
  if (autoDismiss) {
    billingResultTimer = window.setTimeout(() => {
      billingResultBanner.classList.add("hidden");
    }, 9000);
  }
}

async function handleCheckoutReturn() {
  const url = new URL(window.location.href);
  const checkoutResult = url.searchParams.get("checkout");
  const checkoutSessionId = url.searchParams.get("session_id");
  if (!checkoutResult) return;

  url.searchParams.delete("checkout");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, document.title, url.toString());

  if (["cancel", "cancelled", "canceled"].includes(checkoutResult)) {
    showBillingResult("Checkout was canceled. You were not charged.", "neutral");
    return;
  }
  if (checkoutResult !== "success") return;

  showBillingResult(
    "Payment completed. We are confirming your Premium subscription...",
    "success",
    false,
  );
  if (checkoutSessionId) {
    try {
      state.subscription = await api("/billing/checkout/sync", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ session_id: checkoutSessionId }),
      });
      if (state.subscription.premium) {
        renderSubscription();
        await loadMap();
        showBillingResult("Payment successful. Your Premium subscription is active.", "success");
        return;
      }
    } catch {
      // Webhook delivery can still complete the synchronization below.
    }
  }
  const confirmationDelays = [0, 800, 1600, 3000];
  for (const delay of confirmationDelays) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      const subscription = await api("/billing/subscription", { headers: authHeaders() });
      state.subscription = subscription;
      if (subscription.premium) {
        renderSubscription();
        await loadMap();
        showBillingResult("Payment successful. Your Premium subscription is active.", "success");
        return;
      }
    } catch {
      break;
    }
  }
  showBillingResult(
    "Payment was completed. Stripe is still confirming the subscription; refresh Account shortly.",
    "success",
    false,
  );
}

async function handleAccountReturn(requestedView) {
  if (requestedView !== "account") return;

  const url = new URL(window.location.href);
  const returnedFromPortal = url.searchParams.get("billing_return") === "portal";
  url.searchParams.delete("view");
  url.searchParams.delete("billing_return");
  window.history.replaceState({}, document.title, url.toString());

  await openAccountDialog();
  if (returnedFromPortal) {
    showBillingResult("Welcome back. Your latest Stripe subscription status is shown below.");
    refreshSubscriptionAfterPortalReturn().catch((error) => {
      billingStatus.textContent = error instanceof Error ? error.message : String(error);
    });
  }
}

async function refreshSubscriptionAfterPortalReturn() {
  // Stripe can redirect before its subscription.updated webhook reaches FeelY.
  for (const delay of [800, 1600, 3000]) {
    await new Promise((resolve) => window.setTimeout(resolve, delay));
    state.subscription = await api("/billing/subscription", { headers: authHeaders() });
    renderSubscription();
    if (hasMyMapAccess()) await loadMap();
  }
}

async function openAccountDialog() {
  const [account, subscription] = await Promise.all([
    api("/users/me/account", { headers: authHeaders() }),
    api("/billing/subscription", { headers: authHeaders() }),
  ]);
  state.account = account;
  state.subscription = subscription;
  state.user = state.account;
  renderUser();
  accountStatus.textContent = "";
  renderAccountDialog();
  renderSubscription();
  accountDialog.showModal();
}

async function startSubscriptionCheckout(plan) {
  billingStatus.textContent = "Opening secure Stripe Checkout...";
  const response = await api("/billing/checkout", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ plan }),
  });
  window.location.assign(response.url);
}

async function startLimitSubscriptionCheckout(button) {
  const subscription = state.subscription || freeSubscriptionState();
  const availablePlans = Array.isArray(subscription.available_plans)
    ? subscription.available_plans
    : [];
  const plan = availablePlans.includes("monthly")
    ? "monthly"
    : availablePlans.includes("yearly")
      ? "yearly"
      : null;

  if (!subscription.billing_available || !plan) {
    throw new ApiError("Premium subscriptions are not available right now.", 503);
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Opening Stripe...";
  try {
    await startSubscriptionCheckout(plan);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function buildPortalReturnUrl() {
  if (!["http:", "https:"].includes(window.location.protocol)) return null;

  // Using the exact origin preserves that origin's login token in browser storage.
  const returnUrl = new URL(window.location.href);
  ["checkout", "session_id", "mode", "verify_email_token"].forEach((name) => {
    returnUrl.searchParams.delete(name);
  });
  returnUrl.searchParams.set("view", "account");
  returnUrl.searchParams.set("billing_return", "portal");
  returnUrl.hash = "";
  return returnUrl.toString();
}

async function createCustomerPortalSession() {
  const returnUrl = buildPortalReturnUrl();
  return api("/billing/portal", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(returnUrl ? { return_url: returnUrl } : {}),
  });
}

async function openSubscriptionManagement() {
  billingStatus.textContent = "Opening subscription management...";
  const response = await createCustomerPortalSession();
  window.location.assign(response.url);
}

async function keepSubscriptionActive() {
  resumeSubscriptionButton.disabled = true;
  billingStatus.textContent = "Keeping your subscription active...";
  try {
    state.subscription = await api("/billing/subscription/resume", {
      method: "POST",
      headers: authHeaders(),
    });
    renderSubscription();
    showBillingResult(
      "Your cancellation was reversed. The subscription will renew as usual.",
      "success",
    );
  } finally {
    resumeSubscriptionButton.disabled = false;
  }
}

function openStripeCancellationConfirmation() {
  const periodEnd = formatBillingDate(state.subscription?.current_period_end);
  stripeCancelCopy.textContent = periodEnd
    ? `Nothing changes yet. Stripe will show the final cancellation details. Your current paid period ends ${periodEnd}.`
    : "Nothing changes yet. You will review and confirm the cancellation securely in Stripe.";
  stripeCancelStatus.textContent = "";
  confirmStripeCancel.disabled = false;
  confirmStripeCancel.textContent = "Continue to Stripe";
  stripeCancelDialog.showModal();
}

async function continueCancellationInStripe(event) {
  event.preventDefault();
  confirmStripeCancel.disabled = true;
  confirmStripeCancel.textContent = "Opening Stripe...";
  stripeCancelStatus.textContent = "";
  try {
    const response = await createCustomerPortalSession();
    window.location.assign(response.url);
  } catch (error) {
    stripeCancelStatus.textContent = error instanceof Error ? error.message : String(error);
    confirmStripeCancel.disabled = false;
    confirmStripeCancel.textContent = "Continue to Stripe";
  }
}

async function saveAccount(event) {
  event.preventDefault();
  accountStatus.textContent = "Saving...";
  const response = await api("/users/me/account", {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({
      display_name: accountDisplayName.value.trim() || null,
      username: accountUsername.value.trim(),
      email: accountEmail.value.trim(),
      avatar_url: accountAvatarUrl.value.trim() || null,
      bio: accountBio.value.trim() || null,
    }),
  });
  state.account = response;
  state.user = response;
  renderUser();
  renderAccountDialog();
  accountStatus.textContent = "Saved.";
}

async function requestEmailVerification() {
  accountStatus.textContent = "Sending verification email...";
  const response = await api("/auth/email-verification/request", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ email: accountEmail.value.trim() }),
  });
  accountStatus.textContent = response.detail || "Verification email requested.";
}

async function updateAccountPassword(event) {
  event.preventDefault();
  if (!accountNewPassword.value.trim()) {
    accountStatus.textContent = "Enter a new password.";
    return;
  }
  accountStatus.textContent = "Updating password...";
  const response = await api("/users/me/password", {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({
      current_password: accountCurrentPassword.value || null,
      new_password: accountNewPassword.value,
    }),
  });
  state.account = response;
  state.user = response;
  renderAccountDialog();
  accountStatus.textContent = "Password updated.";
}

async function deleteAccount() {
  if (!window.confirm("Delete your account and all conversations? This cannot be undone.")) return;
  const password = state.account?.has_password
    ? window.prompt("Enter your password to delete this account.")
    : "";
  if (state.account?.has_password && !password) return;

  await api("/users/me/account", {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify({ password }),
  });
  accountDialog.close();
  logout();
}

async function confirmEmailVerificationFromUrl() {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("verify_email_token");
  if (!token) return;

  try {
    const response = await api("/auth/email-verification/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
    if (authStatus) authStatus.textContent = response.detail || "Email verified.";
  } catch (error) {
    if (authStatus) {
      authStatus.textContent = error instanceof Error ? error.message : String(error);
    }
  } finally {
    url.searchParams.delete("verify_email_token");
    window.history.replaceState({}, document.title, url.toString());
  }
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

function appendStreamingText(bubble, text) {
  if (!text) return;

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

  content.append(document.createTextNode(text));
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

function renderMapSuggestion(suggestion) {
  if (!hasMyMapAccess()) suggestion = null;
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
  const waitingLabel = waitingMessage.querySelector(".waiting-label");

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
        appendStreamingText(waitingMessage, event.text);
      } else if (event.type === "result") {
        response = event.data;
      } else if (event.type === "error") {
        throw new ApiError(event.message || "Request failed", event.status || 500);
      }
    });
    if (!response) throw new ApiError("The response stream ended unexpectedly.", 502);
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
    renderTopic(updatedChat.pending_topic);
    pollTopicSoon();
  } catch (error) {
    waitingMessage.remove();
    messageInput.value = context;
    autoresizeMessageInput();
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
  if (attempt >= TOPIC_POLL_DELAYS.length) return;
  state.pollTimer = setTimeout(async () => {
    state.pollTimer = null;
    try {
      const topicReady = await pollTopicOnce();
      if (!topicReady) pollTopicSoon(attempt + 1);
    } catch {
      pollTopicSoon(attempt + 1);
    }
  }, TOPIC_POLL_DELAYS[attempt]);
}

async function pollTopicOnce() {
  if (!state.activeChatId || !state.token) return false;
  const payload = await api(
    `/llm/chats/${encodeURIComponent(state.activeChatId)}/topic-suggestion`,
    { headers: authHeaders() },
  );
  renderTopic(payload.suggestion);
  return Boolean(payload.suggestion);
}

function startPolling() {
  stopPolling();
  pollTopicOnce().catch(() => {});
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
  if (hasMyMapAccess()) await loadMap();
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
  if (showMap) {
    if (hasMyMapAccess()) {
      loadMap().catch(renderInlineError);
    } else {
      renderMap();
    }
  }
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
    "My Map connects the topics, observations, values, and practices you choose to keep.";

  const benefits = document.createElement("ul");
  [
    "See recurring themes across conversations",
    "Keep useful insights organized in one visual space",
    "Turn reflection into practices you can revisit",
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
  mapContent.replaceChildren();

  if (!hasMyMapAccess()) {
    renderMapPaywall();
    return;
  }

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
accountButton.addEventListener("click", () => openAccountDialog().catch(renderInlineError));
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
chatPlanUpgrade.addEventListener("click", () =>
  startLimitSubscriptionCheckout(chatPlanUpgrade).catch(renderInlineError),
);
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
accountForm.addEventListener("submit", (event) => saveAccount(event).catch((error) => {
  accountStatus.textContent = error instanceof Error ? error.message : String(error);
}));
passwordForm.addEventListener("submit", (event) =>
  updateAccountPassword(event).catch((error) => {
    accountStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
requestVerificationButton.addEventListener("click", () =>
  requestEmailVerification().catch((error) => {
    accountStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
deleteAccountButton.addEventListener("click", () =>
  deleteAccount().catch((error) => {
    accountStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
subscribeMonthlyButton.addEventListener("click", () =>
  startSubscriptionCheckout("monthly").catch((error) => {
    billingStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
subscribeYearlyButton.addEventListener("click", () =>
  startSubscriptionCheckout("yearly").catch((error) => {
    billingStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
manageSubscriptionButton.addEventListener("click", () =>
  openSubscriptionManagement().catch((error) => {
    billingStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
resumeSubscriptionButton.addEventListener("click", () =>
  keepSubscriptionActive().catch((error) => {
    billingStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
cancelSubscriptionButton.addEventListener("click", openStripeCancellationConfirmation);
stripeCancelForm.addEventListener("submit", continueCancellationInStripe);
billingResultDismiss.addEventListener("click", () => {
  billingResultBanner.classList.add("hidden");
  if (billingResultTimer) window.clearTimeout(billingResultTimer);
});
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
  await Promise.all([loadCaptchaConfig(), loadGoogleConfig()]);
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  setMode(requestedMode === "register" ? "register" : "login");
  renderUser();
  await confirmEmailVerificationFromUrl();
  if (state.token) {
    try {
      await showChat();
    } catch (error) {
      // A temporary backend failure should not erase a valid saved session.
      if (error instanceof ApiError && [401, 403].includes(error.status)) {
        logout();
      } else {
        renderInlineError(error);
      }
    }
  } else {
    showAuth();
  }
}

init().catch(() => {
  setMode("login");
  renderUser();
  showAuth();
});
