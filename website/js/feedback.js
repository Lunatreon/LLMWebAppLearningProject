const feedbackButton = document.querySelector("#feedback-button");
const feedbackDialog = document.querySelector("#feedback-dialog");
const feedbackForm = document.querySelector("#feedback-form");
const feedbackMessage = document.querySelector("#feedback-message");
const feedbackStatus = document.querySelector("#feedback-status");
const feedbackSubmit = document.querySelector("#feedback-submit");

async function loadFeedbackConfig() {
  try {
    const config = await api("/feedback/config");
    feedbackButton.classList.toggle("hidden", !config.enabled);
    if (!config.enabled && feedbackDialog.open) feedbackDialog.close();
  } catch {
    feedbackButton.classList.add("hidden");
  }
}

feedbackButton.addEventListener("click", () => {
  feedbackStatus.textContent = "";
  feedbackForm.classList.remove("hidden");
  closeSidebar();
  feedbackDialog.showModal();
  feedbackMessage.focus();
});

feedbackForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (feedbackSubmit.disabled) return;
  const token = state.token;
  feedbackSubmit.disabled = true;
  feedbackStatus.textContent = "Saving feedback...";
  try {
    const response = await api("/feedback", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({
        category: document.querySelector("#feedback-category").value,
        message: feedbackMessage.value.trim(),
      }),
    });
    if (state.token !== token) return;
    feedbackForm.reset();
    feedbackStatus.textContent = response.detail;
  } catch (error) {
    if (state.token !== token) return;
    feedbackStatus.textContent = error.message;
    if (error.status === 404) {
      feedbackButton.classList.add("hidden");
      feedbackForm.classList.add("hidden");
    }
  } finally {
    feedbackSubmit.disabled = false;
  }
});
