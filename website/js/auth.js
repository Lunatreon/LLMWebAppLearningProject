// FeelY auth: see website/EDITING.md for file responsibilities and load order.

function setMode(mode) {
  state.mode = mode;
  const isLogin = mode === "login";
  loginTab.classList.toggle("active", isLogin);
  registerTab.classList.toggle("active", !isLogin);
  loginTab.setAttribute("aria-selected", String(isLogin));
  registerTab.setAttribute("aria-selected", String(!isLogin));
  usernameField.classList.toggle("hidden", isLogin);
  forgotPasswordButton.classList.toggle("hidden", !isLogin);
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
    await showChat({ startFreshChat: true });
  } catch (error) {
    authError.textContent = error instanceof Error ? error.message : String(error);
    if (authStatus) authStatus.textContent = "";
  }
}

let sessionExpiryTimer = null;
let sessionCheckPending = false;

function expireSession(token = state.token) {
  // An old request must not sign out a newly signed-in account.
  if (!token || token !== state.token) return;
  logout();
  authStatus.textContent = "Your session has ended. Please sign in again.";
  emailInput.focus();
}

function checkSessionResponse(response, requestToken) {
  if (!requestToken) return; // A rejected login is not an expired session.
  if (response.status === 401) expireSession(requestToken);
  if (requestToken !== state.token) {
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
}

function scheduleSessionExpiry() {
  clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = null;
  const token = state.token;
  if (!token) return;
  let expiresAt;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp } = JSON.parse(atob(payload));
    if (typeof exp !== "number" || !Number.isFinite(exp)) throw new Error("Invalid expiry");
    expiresAt = exp * 1000;
  } catch {
    expireSession(token);
    return;
  }
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) { expireSession(token); return; }
  sessionExpiryTimer = setTimeout(scheduleSessionExpiry, Math.min(remaining, 2147483647));
}

async function validateSessionOnReturn() {
  scheduleSessionExpiry();
  if (!state.token || sessionCheckPending || document.visibilityState === "hidden") return;
  sessionCheckPending = true;
  try {
    await api("/users/me", { headers: authHeaders() });
  } catch {
    // api handles revoked sessions. Temporary network failures keep the session.
  } finally {
    sessionCheckPending = false;
  }
}

function showAuth() {
  authView.classList.remove("hidden");
  chatView.classList.add("hidden");
  document.title = "FeelY Chat | Login";
  closeSidebar();
  stopPolling();
}

async function showChat({ startFreshChat = false } = {}) {
  scheduleSessionExpiry();
  if (!state.token) return;
  if (startFreshChat) state.activeChatId = null;
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
  const workspace = ["map", "journal"].includes(requestedView) ? requestedView : "chat";
  switchWorkspace(workspace);
  if (startFreshChat && workspace === "chat") startNewChat();
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
  await showChat({ startFreshChat: true });
}

function openPasswordResetRequest() {
  passwordResetRequestView.classList.remove("hidden");
  passwordResetConfirmView.classList.add("hidden");
  passwordResetStatus.textContent = "";
  passwordResetEmail.value = emailInput.value.trim();
  passwordResetDialog.showModal();
  passwordResetEmail.focus();
}

function openPasswordResetConfirm() {
  passwordResetRequestView.classList.add("hidden");
  passwordResetConfirmView.classList.remove("hidden");
  passwordResetStatus.textContent = "";
  passwordResetNew.value = "";
  passwordResetConfirm.value = "";
  passwordResetDialog.showModal();
  passwordResetNew.focus();
}

async function requestPasswordReset(event) {
  event.preventDefault();
  const submit = passwordResetRequestForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  passwordResetStatus.textContent = "Sending...";
  try {
    const response = await api("/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ email: passwordResetEmail.value.trim() }),
    });
    passwordResetStatus.textContent = response.detail;
  } finally {
    submit.disabled = false;
  }
}

async function confirmPasswordReset(event) {
  event.preventDefault();
  if (!initialPasswordResetToken) {
    passwordResetStatus.textContent = "This reset link is missing its token.";
    return;
  }
  if (passwordResetNew.value !== passwordResetConfirm.value) {
    passwordResetStatus.textContent = "The passwords do not match.";
    return;
  }
  const submit = passwordResetConfirmForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  passwordResetStatus.textContent = "Saving...";
  try {
    const response = await api("/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({
        token: initialPasswordResetToken,
        new_password: passwordResetNew.value,
      }),
    });
    passwordResetStatus.textContent = response.detail;
    passwordInput.value = "";
    window.setTimeout(() => {
      passwordResetDialog.close();
      emailInput.focus();
    }, 1200);
  } finally {
    submit.disabled = false;
  }
}

function logout() {
  state.chatRequest?.controller.abort();
  state.chatRequest = null;
  clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer = null;
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
  state.journalEntries = [];
  state.activeJournalDate = null;
  state.journalEntry = null;
  state.journalDirty = false;
  if (journalSaveTimer) window.clearTimeout(journalSaveTimer);
  localStorage.removeItem("feely_token");
  document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
  document.querySelectorAll(".map-action-backdrop").forEach((popup) => popup.remove());
  journalText.value = "";
  messageInput.value = "";
  authForm.reset();
  setMode("login");
  renderChats();
  renderMessages([]);
  renderTopic(null);
  renderMapSuggestion(null);
  renderUser();
  showAuth();
}

