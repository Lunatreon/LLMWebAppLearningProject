// Mandatory review of the exact published version, after any sign-in method.
let registrationTerms = null;

async function loadRegistrationTerms() {
  const current = await api("/terms/config");
  const checkbox = document.querySelector("#registration-terms-accepted");
  if (current.version !== registrationTerms?.version || current.document_sha256 !== registrationTerms?.document_sha256) {
    checkbox.checked = false;
  }
  registrationTerms = current;
  checkbox.disabled = !current.configured;
  checkbox.required = state.mode === "register" && current.configured;
  document.querySelector("#registration-terms-link").href = current.document_url || "/agb.html";
  document.querySelector("#registration-terms-status").textContent = current.configured
    ? (current.version.startsWith("test-")
      ? `Unfinished test terms (${current.version}). You will need to accept the finished release terms separately.`
      : `Version ${current.version}. Please read the terms and check the box yourself.`)
    : "Terms are still being prepared. No acceptance is recorded for the draft.";
}

async function registrationTermsPayload() {
  // Recheck before submitting; changed terms always reset the checkbox.
  await loadRegistrationTerms();
  if (!registrationTerms.configured) return {};
  if (!document.querySelector("#registration-terms-accepted").checked) {
    throw new Error("Please read and accept the FeelY terms before creating an account.");
  }
  return { terms_accepted: true, terms_version: registrationTerms.version,
    terms_document_sha256: registrationTerms.document_sha256 };
}

async function ensureTermsAccepted() {
  const token = state.token;
  const result = await api("/terms/me", { headers: authHeaders() });
  if (token !== state.token) return false;
  const old = document.querySelector("#terms-review");
  if (!result.current.enforced || result.accepted_current) {
    old?.close();
    old?.remove();
    return true;
  }
  if (old?.open) return false;
  old?.remove();
  stopPolling();
  const dialog = document.createElement("dialog");
  dialog.id = "terms-review";
  dialog.className = "app-dialog";
  dialog.setAttribute("aria-labelledby", "terms-heading");
  dialog.innerHTML = `<form class="terms-review-form">
    <h2 id="terms-heading">FeelY terms of use (AGB)</h2>
    <p>Please read and accept the current terms before continuing.</p>
    <p><a id="terms-document" target="_blank" rel="noopener">Read / save the terms</a></p>
    <label class="terms-consent-label"><input id="terms-consent" type="checkbox" required><span>I accept this version of the FeelY terms of use (AGB).</span></label>
    <p id="terms-error" role="alert"></p>
    <button class="primary-button" id="terms-continue" type="submit" disabled>Accept and continue</button>
    <button class="secondary-button" id="terms-signout" type="button">Sign out</button>
    <p>You can <button id="terms-account" type="button" class="auth-link-button">manage or delete your account</button>
    or <button id="terms-billing" type="button" class="auth-link-button">manage your subscription</button> without accepting.</p>
  </form>`;
  document.body.append(dialog);
  const link = dialog.querySelector("#terms-document");
  link.href = result.current.document_url;
  link.textContent = `Read / save the terms (${result.current.version})`;
  const checkbox = dialog.querySelector("#terms-consent");
  const submit = dialog.querySelector("#terms-continue");
  const error = dialog.querySelector("#terms-error");
  checkbox.addEventListener("change", () => { submit.disabled = !checkbox.checked; });
  dialog.addEventListener("cancel", event => event.preventDefault());
  dialog.querySelector("#terms-signout").addEventListener("click", logout);
  dialog.querySelector("#terms-account").addEventListener("click", async () => {
    try { await openAccountDialog(); } catch (failure) { error.textContent = failure.message; }
  });
  dialog.querySelector("#terms-billing").addEventListener("click", async () => {
    try {
      const portal = await api("/billing/portal", { method: "POST", headers: authHeaders() });
      window.location.assign(portal.url);
    } catch (failure) { error.textContent = failure.message; }
  });
  dialog.querySelector("form").addEventListener("submit", async event => {
    event.preventDefault();
    if (!checkbox.checked || submit.disabled || token !== state.token) return;
    submit.disabled = true;
    checkbox.disabled = true;
    error.textContent = "";
    try {
      await api("/terms/accept", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ accepted: true, version: result.current.version,
          document_sha256: result.current.document_sha256, client: "web" }),
      });
      if (token !== state.token) return;
      dialog.close();
      dialog.remove();
      await showChat();
    } catch (failure) {
      error.textContent = failure.message;
      if (failure.status === 409) {
        dialog.close();
        dialog.remove();
        await ensureTermsAccepted();
      }
    } finally {
      checkbox.disabled = false;
      submit.disabled = !checkbox.checked;
    }
  });
  dialog.showModal();
  link.focus();
  return false;
}
