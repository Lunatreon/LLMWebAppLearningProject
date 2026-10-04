// FeelY account: see website/EDITING.md for file responsibilities and load order.

function freeSubscriptionState() {
  return {
    status: "none",
    plan: "free",
    premium: false,
    my_map_access: false,
    journal_access: false,
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

function hasJournalAccess() {
  return Boolean(state.subscription?.journal_access ?? state.subscription?.my_map_access);
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
  if (subscription.free_test_phase) {
    billingPlan.textContent = "Now for free";
    billingStatus.textContent = "All features are free during the test phase. Existing subscriptions can still be managed below.";
    billingSubscribeActions.hidden = true;
  }
  renderPremiumAccess();
}

function renderPremiumAccess() {
  const mapAccess = hasMyMapAccess();
  const journalAccess = hasJournalAccess();
  const dailyLimit = state.subscription?.chat_daily_limit || 10;
  mapPlanBadge.hidden = mapAccess;
  mapPlanBadge.textContent = "✦";
  mapWorkspaceButton.classList.toggle("premium-locked", !mapAccess);
  mapWorkspaceButton.title = mapAccess ? "Open My Map" : "My Map is included with Premium";
  journalPlanBadge.hidden = journalAccess;
  journalPlanBadge.textContent = "✦";
  journalWorkspaceButton.classList.toggle("premium-locked", !journalAccess);
  journalWorkspaceButton.title = journalAccess
    ? "Open Journal"
    : "Journal is included with Premium";
  addTopicButton.hidden = !mapAccess;
  chatPlanCopy.textContent = mapAccess
    ? `Premium - up to ${dailyLimit} messages per day.`
    : `Free plan - ${dailyLimit} messages per day.`;
  if (state.subscription?.free_test_phase) chatPlanCopy.textContent = "Now for free - All features during the test phase";
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
  if (!journalView.classList.contains("hidden")) renderJournalAccess();
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
  if (response.sent) openEmailVerification(accountEmail.value.trim(), response.detail);
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

function openDeleteAccountDialog() {
  deleteAccountForm.reset();
  deleteAccountStatus.textContent = "";
  document.querySelector("#delete-account-password-field").classList.toggle("hidden", !state.account?.has_password);
  deleteAccountDialog.showModal();
}

async function deleteAccount(event) {
  event.preventDefault();
  if (accountDeletionPending) return;
  const password = state.account?.has_password ? deleteAccountPassword.value : "";
  if (state.account?.has_password && !password) {
    deleteAccountStatus.textContent = "Enter your password to delete this account.";
    deleteAccountPassword.focus();
    return;
  }

  accountDeletionPending = true;
  deleteAccountDialog.querySelectorAll("button").forEach((button) => { button.disabled = true; });
  deleteAccountStatus.textContent = "Deleting account...";
  try {
    await api("/users/me/account", {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({ password }),
    });
    deleteAccountDialog.close();
    accountDialog.close();
    logout();
  } catch (error) {
    deleteAccountStatus.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    accountDeletionPending = false;
    deleteAccountPassword.value = "";
    deleteAccountDialog.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  }
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

