// Load HTML fragments first: app.js binds to their elements during evaluation.
(() => {
  const APP_SCRIPTS = [
    "app.js",
    "js/account.js",
    "js/dialogs.js",
    "js/auth.js",
    "js/terms.js",
    "js/chat.js",
    "js/journal.js",
    "js/map.js",
    "js/navigation.js",
    "js/feedback.js",
    "js/start.js"
  ];
  const LOAD_TIMEOUT_MS = 15000;
  const MAX_LOAD_ATTEMPTS = 6;
  const TRANSIENT_STATUSES = new Set([408, 502, 503, 504]);

  async function retryDownload(download) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await download();
      } catch (error) {
        if (!error.retryable || attempt >= MAX_LOAD_ATTEMPTS) throw error;
        await new Promise(resolve => setTimeout(resolve, 300 * attempt));
      }
    }
  }

  function downloadError(message, retryable) {
    const error = new Error(message);
    error.retryable = retryable;
    return error;
  }

  async function fetchView(placeholder) {
    const source = placeholder.dataset.view;
    if (!/^views\/[a-z0-9-]+\.html$/.test(source)) {
      throw new Error("Invalid view reference.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    try {
      let response;
      try {
        response = await fetch(source, { signal: controller.signal, cache: "no-cache" });
      } catch (error) {
        throw downloadError(`Could not download ${source}: ${error.message}`, true);
      }
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
        throw downloadError(`Could not load ${source} (HTTP ${response.status}).`, TRANSIENT_STATUSES.has(response.status));
      }
      const markup = await response.text();
      if (!markup.trim() || /<!doctype|<html\b/i.test(markup)) {
        throw new Error(`Invalid HTML view: ${source}.`);
      }
      const template = document.createElement("template");
      template.innerHTML = markup;
      if (template.content.querySelector("script, style, template[data-view]")) {
        throw new Error(`Views must contain only markup: ${source}.`);
      }
      return { placeholder, content: template.content };
    } finally {
      clearTimeout(timeout);
    }
  }

  function loadScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => {
        script.remove();
        reject(new Error(`Loading ${source} timed out.`));
      }, LOAD_TIMEOUT_MS);
      script.src = source;
      script.async = false;
      script.onload = () => { clearTimeout(timeout); resolve(); };
      script.onerror = () => {
        clearTimeout(timeout);
        script.remove();
        reject(downloadError(`Could not load ${source}.`, true));
      };
      document.head.append(script);
    });
  }

  async function loadApplication() {
    const loading = document.querySelector("#app-loading");
    const message = document.querySelector("#app-loading-message");
    const retry = document.querySelector("#app-loading-retry");
    retry.addEventListener("click", () => window.location.reload());
    try {
      const placeholders = [...document.querySelectorAll("template[data-view]")];
      const views = await Promise.all(placeholders.map(placeholder =>
        retryDownload(() => fetchView(placeholder))));
      // Do not start or display a partially loaded application.
      for (const { placeholder, content } of views) placeholder.replaceWith(content);
      for (const source of APP_SCRIPTS) await retryDownload(() => loadScript(source));
      document.querySelector("[data-app-shell]").hidden = false;
      loading.hidden = true;
      return true;
    } catch (error) {
      console.error("FeelY startup failed", error);
      message.textContent = "FeelY could not finish loading. Please try again.";
      loading.setAttribute("role", "alert");
      retry.hidden = false;
      return false;
    }
  }

  window.feelyReady = loadApplication();
})();
