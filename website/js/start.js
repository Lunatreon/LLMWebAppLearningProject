// FeelY start: see website/EDITING.md for file responsibilities and load order.

loginTab.addEventListener("click", () => setMode("login"));
registerTab.addEventListener("click", () => setMode("register"));
forgotPasswordButton.addEventListener("click", openPasswordResetRequest);
passwordResetRequestForm.addEventListener("submit", (event) =>
  requestPasswordReset(event).catch((error) => {
    passwordResetStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
passwordResetConfirmForm.addEventListener("submit", (event) =>
  confirmPasswordReset(event).catch((error) => {
    passwordResetStatus.textContent = error instanceof Error ? error.message : String(error);
  }),
);
logoutButton.addEventListener("click", logout);
accountButton.addEventListener("click", () => openAccountDialog().catch(renderInlineError));
document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(nextTheme, { persist: true });
  });
});
newChatButton.addEventListener("click", () => {
  switchWorkspace("chat");
  startNewChat();
});
sidebarToggle.addEventListener("click", openSidebar);
mapSidebarToggle.addEventListener("click", openSidebar);
journalSidebarToggle.addEventListener("click", openSidebar);
sidebarClose.addEventListener("click", closeSidebar);
sidebarBackdrop.addEventListener("click", closeSidebar);
chatWorkspaceButton.addEventListener("click", () => switchWorkspace("chat"));
mapWorkspaceButton.addEventListener("click", () => switchWorkspace("map"));
journalWorkspaceButton.addEventListener("click", () => switchWorkspace("journal"));
workspaceSwitch.addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = [chatWorkspaceButton, mapWorkspaceButton];
  const currentIndex = tabs.indexOf(document.activeElement);
  if (currentIndex < 0) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  tabs[(currentIndex + direction + tabs.length) % tabs.length].click();
  tabs[(currentIndex + direction + tabs.length) % tabs.length].focus();
});
journalReturnChat.addEventListener("click", () => switchWorkspace("chat"));
journalUpgradeButton.addEventListener("click", () => {
  const monthlyAvailable = state.subscription?.available_plans?.includes("monthly");
  const request = monthlyAvailable
    ? startSubscriptionCheckout("monthly")
    : openAccountDialog();
  request.catch(renderInlineError);
});
journalAnalyseButton.addEventListener("click", () =>
  analyseJournalEntry().catch((error) => {
    setJournalSaveStatus(error instanceof Error ? error.message : String(error), "error");
  }),
);
journalTodayButton.addEventListener("click", () =>
  openJournalDateFromSidebar(localDateKey()).catch(renderInlineError),
);
journalPreviousButton.addEventListener("click", () =>
  openJournalDateFromSidebar(shiftedDateKey(state.activeJournalDate || localDateKey(), -1)).catch(
    renderInlineError,
  ),
);
journalNextButton.addEventListener("click", () => {
  const nextDate = shiftedDateKey(state.activeJournalDate || localDateKey(), 1);
  if (nextDate <= localDateKey()) openJournalDateFromSidebar(nextDate).catch(renderInlineError);
});
journalText.addEventListener("input", scheduleJournalSave);
messageForm.addEventListener("submit", sendMessage);
chatPlanUpgrade.addEventListener("click", () =>
  startLimitSubscriptionCheckout(chatPlanUpgrade).catch(renderInlineError),
);
topicCategory.addEventListener("change", () => {
  if (state.pendingTopic) state.pendingTopic.category = topicCategory.value;
});
topicAccept.addEventListener("click", () => confirmTopic(true).catch(renderInlineError));
for (const kind of ["topic", "map-suggestion"]) {
  const review = document.querySelector(`#${kind}-review`);
  const dialog = document.querySelector(`#${kind}-review-dialog`);
  review.addEventListener("click", () => dialog.showModal());
  dialog.querySelector("[data-close-chat-review]").addEventListener("click", () => dialog.close());
}

topicDismiss.addEventListener("click", () => confirmTopic(false).catch(renderInlineError));
topicTarget.addEventListener("change", () => {
  updateTopicRoutePresentation();
});
mapSuggestionAccept.addEventListener("click", () =>
  confirmMapSuggestion(true).catch(renderInlineError),
);
mapSuggestionDismiss.addEventListener("click", () =>
  confirmMapSuggestion(false).catch(renderInlineError),
);
addTopicButton.addEventListener("click", () => openMapTopicPopup());
mapSidebarAddTopic.addEventListener("click", () => {
  closeSidebar();
  openMapTopicPopup();
});
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
deleteAccountButton.addEventListener("click", openDeleteAccountDialog);
deleteAccountForm.addEventListener("submit", deleteAccount);
deleteAccountDialog.addEventListener("cancel", (event) => {
  if (accountDeletionPending) event.preventDefault();
});
deleteAccountDialog.addEventListener("close", () => {
  deleteAccountPassword.value = "";
});
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
window.addEventListener("resize", () => {
  syncViewportHeight();
  closeChatActionsMenu();
});
window.addEventListener("orientationchange", syncViewportHeight);
window.visualViewport?.addEventListener("resize", syncViewportHeight);
window.visualViewport?.addEventListener("resize", autoresizeMessageInput);
window.addEventListener("beforeunload", () => {
  if (state.journalDirty) saveJournalEntry({ keepalive: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && state.journalDirty) {
    saveJournalEntry({ keepalive: true });
  }
});
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
document.querySelector("#map-analysis-retry").addEventListener("click", retryMapAnalysis);
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
  const savedToken = state.token;
  scheduleSessionExpiry();
  await Promise.all([loadCaptchaConfig(), loadGoogleConfig()]);
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  setMode(!savedToken && requestedMode === "register" ? "register" : "login");
  renderUser();
  await confirmEmailVerificationFromUrl();
  if (state.token) {
    try {
      await showChat({ startFreshChat: true });
    } catch (error) {
      // A temporary backend failure should not erase a valid saved session.
      if (error instanceof ApiError && error.status === 401) {
        expireSession();
      } else {
        renderInlineError(error);
      }
    }
  } else {
    showAuth();
  }
  if (initialPasswordResetToken) openPasswordResetConfirm();
}

enhanceTopicCategorySelect(topicCategory);

init().catch(() => {
  setMode("login");
  renderUser();
  showAuth();
});

let mapResizeTimer;
window.addEventListener("focus", validateSessionOnReturn);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") validateSessionOnReturn();
});
window.addEventListener("resize", () => {
  clearTimeout(mapResizeTimer);
  mapResizeTimer = setTimeout(() => {
    autoresizeMessageInput();
    if (!mapView.classList.contains("hidden")) renderMap();
  }, 120);
});
