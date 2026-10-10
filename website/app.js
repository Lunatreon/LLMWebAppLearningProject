// Shared state, DOM references, theme, and HTTP helpers. Feature code lives in js/.

const initialPasswordResetToken = new URLSearchParams(window.location.search).get(
  "reset_password_token",
);
const THEME_STORAGE_KEY = "feely_theme";

function syncViewportHeight() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  if (viewportHeight > 0) {
    document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
  }
}

syncViewportHeight();

function readSavedTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme, { persist = false } = {}) {
  const selectedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selectedTheme;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  if (themeColor) themeColor.content = selectedTheme === "light" ? "#fff4f7" : "#100f13";
  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, selectedTheme);
    } catch {
      // The appearance still changes when browser storage is unavailable.
    }
  }
  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    const isLight = selectedTheme === "light";
    const nextTheme = isLight ? "dark" : "light";
    button.setAttribute("aria-checked", String(isLight));
    button.setAttribute("aria-label", `Use ${nextTheme} appearance`);
    button.title = `Use ${nextTheme} appearance`;
  });
}

applyTheme(readSavedTheme());

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
    "reset_password_token",
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
  mapFilter: "all",
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
  journalEntries: [],
  activeJournalDate: null,
  journalEntry: null,
  journalDirty: false,
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
const forgotPasswordButton = document.querySelector("#forgot-password-button");
const websiteInput = document.querySelector("#website");
const captchaField = document.querySelector("#captcha-field");
const captchaWidget = document.querySelector("#captcha-widget");
const captchaStatus = document.querySelector("#captcha-status");
const googleAuthField = document.querySelector("#google-auth-field");
const googleButton = document.querySelector("#google-button");
const logoutButton = document.querySelector("#logout-button");
const accountButton = document.querySelector("#account-button");
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
const topicDescription = document.querySelector("#topic-description");
const topicCategory = document.querySelector("#topic-category");
const topicConnections = document.querySelector("#topic-connections");
const topicNameLabel = document.querySelector("#topic-name-label");
const topicQueueStatus = document.querySelector("#topic-queue-status");
const topicAccept = document.querySelector("#topic-accept");
const topicDismiss = document.querySelector("#topic-dismiss");
const topicRouting = document.querySelector("#topic-routing");
const topicTarget = document.querySelector("#topic-target");
const topicEntryCategoryField = document.querySelector("#topic-entry-category-field");
const topicEntryCategory = document.querySelector("#topic-entry-category");
const topicMatchBadge = document.querySelector("#topic-match-badge");
const topicRouteHint = document.querySelector("#topic-route-hint");
const topicParent = document.querySelector("#topic-parent");
const topicParentField = document.querySelector("#topic-parent-field");
const mapSuggestionCard = document.querySelector("#map-suggestion-card");
const mapSuggestionCategory = document.querySelector("#map-suggestion-category");
const mapSuggestionTopic = document.querySelector("#map-suggestion-topic");
const mapSuggestionText = document.querySelector("#map-suggestion-text");
const mapSuggestionReason = document.querySelector("#map-suggestion-reason");
const mapSuggestionTargetField = document.querySelector("#map-suggestion-target-field");
const mapSuggestionTarget = document.querySelector("#map-suggestion-target");
const mapSuggestionAccept = document.querySelector("#map-suggestion-accept");
const mapSuggestionDismiss = document.querySelector("#map-suggestion-dismiss");
const userAvatar = document.querySelector("#user-avatar");
const userName = document.querySelector("#user-name");
const userEmail = document.querySelector("#user-email");
const sidebar = document.querySelector("#sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarClose = document.querySelector("#sidebar-close");
const sidebarBackdrop = document.querySelector("#sidebar-backdrop");
const workspaceSwitch = document.querySelector(".workspace-switch");
const chatSidebarContent = document.querySelector("#chat-sidebar-content");
const mapSidebarContent = document.querySelector("#map-sidebar-content");
const mapSidebarAccess = document.querySelector("#map-sidebar-access");
const mapSidebarLocked = document.querySelector("#map-sidebar-locked");
const mapSidebarAddTopic = document.querySelector("#map-sidebar-add-topic");
const mapTopicList = document.querySelector("#map-topic-list");
const mapTopicCount = document.querySelector("#map-topic-count");
const journalSidebarContent = document.querySelector("#journal-sidebar-content");
const conversationView = document.querySelector("#conversation-view");
const mapView = document.querySelector("#map-view");
const chatWorkspaceButton = document.querySelector("#chat-workspace-button");
const mapWorkspaceButton = document.querySelector("#map-workspace-button");
const journalWorkspaceButton = document.querySelector("#journal-workspace-button");
const mapPlanBadge = document.querySelector("#map-plan-badge");
const journalPlanBadge = document.querySelector("#journal-plan-badge");
const mapSidebarToggle = document.querySelector("#map-sidebar-toggle");
const mapContent = document.querySelector("#map-content");
const addTopicButton = document.querySelector("#add-topic-button");
const journalView = document.querySelector("#journal-view");
const journalSidebarToggle = document.querySelector("#journal-sidebar-toggle");
const journalPaywall = document.querySelector("#journal-paywall");
const journalWorkspace = document.querySelector("#journal-workspace");
const journalUpgradeButton = document.querySelector("#journal-upgrade-button");
const journalReturnChat = document.querySelector("#journal-return-chat");
const journalAnalyseButton = document.querySelector("#journal-analyse-button");
const journalFullDate = document.querySelector("#journal-full-date");
const journalText = document.querySelector("#journal-text");
const journalSaveStatus = document.querySelector("#journal-save-status");
const journalWordCount = document.querySelector("#journal-word-count");
const journalTodayButton = document.querySelector("#journal-today-button");
const journalPreviousButton = document.querySelector("#journal-previous-button");
const journalNextButton = document.querySelector("#journal-next-button");
const journalEntryList = document.querySelector("#journal-entry-list");
const journalEntryCount = document.querySelector("#journal-entry-count");
const journalSidebarAccess = document.querySelector("#journal-sidebar-access");
const journalSidebarLocked = document.querySelector("#journal-sidebar-locked");
const journalSuggestions = document.querySelector("#journal-suggestions");
const journalSuggestionList = document.querySelector("#journal-suggestion-list");
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
const deleteAccountDialog = document.querySelector("#delete-account-dialog");
const deleteAccountForm = document.querySelector("#delete-account-form");
const deleteAccountPassword = document.querySelector("#delete-account-password");
const deleteAccountStatus = document.querySelector("#delete-account-status");
let accountDeletionPending = false;
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
const passwordResetDialog = document.querySelector("#password-reset-dialog");
const passwordResetRequestView = document.querySelector("#password-reset-request-view");
const passwordResetConfirmView = document.querySelector("#password-reset-confirm-view");
const passwordResetRequestForm = document.querySelector("#password-reset-request-form");
const passwordResetConfirmForm = document.querySelector("#password-reset-confirm-form");
const passwordResetEmail = document.querySelector("#password-reset-email");
const passwordResetNew = document.querySelector("#password-reset-new");
const passwordResetConfirm = document.querySelector("#password-reset-confirm");
const passwordResetStatus = document.querySelector("#password-reset-status");

const MAP_CATEGORY_LABELS = {
  inherited_script: "Inherited script",
  merged_topic: "Merged topic",
  own_perception: "My perception",
  value: "Value",
  body_signal: "Body signal",
  practice: "Practice",
  evidence: "Evidence",
};
const OVERALL_MAP_NODE_ID = "__across_topics";
const OVERALL_MAP_TITLE = "Overall";

const TOPIC_POLL_DELAYS = [700, 1800, 4000, 8000];

let lastAuthSubmitAt = 0;
let turnstileScriptPromise = null;
let googleScriptPromise = null;
let billingResultTimer = null;
let journalSaveTimer = null;

class ApiError extends Error {
  constructor(message, status, retryAfter = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    "Content-Type": "application/json",
  };
}

async function api(path, options = {}) {
  const requestToken = options.headers?.Authorization?.replace(/^Bearer /, "");
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

  checkSessionResponse(response, requestToken);
  const responseText = await response.text();
  checkSessionResponse(response, requestToken);
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
    if (response.status === 423 && requestToken === state.token) {
      ensureTermsAccepted().catch(renderInlineError);
    }
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
  const requestToken = options.headers?.Authorization?.replace(/^Bearer /, "");
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch {
    throw new ApiError(
      "FeelY temporarily lost its connection. Your message is still in the input box so you can retry.",
      0,
    );
  }
  checkSessionResponse(response, requestToken);
  if (!response.ok || !response.body) {
    if (response.status === 423 && requestToken === state.token) {
      ensureTermsAccepted().catch(renderInlineError);
    }
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
    if (requestToken && requestToken !== state.token) {
      await reader.cancel();
      throw new ApiError("Your session has ended. Please sign in again.", 401);
    }
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

async function loadUser() {
  state.user = await api("/users/me/account", { headers: authHeaders() });
  state.account = state.user;
  renderUser();
}

const verificationDialog = document.querySelector("#email-verification-dialog");
const verificationForm = document.querySelector("#email-verification-form");
const verificationEmail = document.querySelector("#verification-email");
const verificationPin = document.querySelector("#verification-pin");
const verificationStatus = document.querySelector("#verification-status");
const verificationResend = document.querySelector("#verification-resend");
const activateAccountButton = document.querySelector("#activate-account-button");

