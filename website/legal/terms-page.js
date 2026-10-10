(async () => {
  const status = document.querySelector("#status");
  try {
    const local = ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(location.hostname);
    const base = location.hostname === "app.feel-y.com" ? "https://api.feel-y.com/api/v1"
      : local ? "http://127.0.0.1:8000/api/v1" : `${location.origin}/api/v1`;
    const response = await fetch(`${base}/terms/config`);
    if (!response.ok) throw new Error("The terms could not be loaded. Please try again.");
    const config = await response.json();
    status.textContent = config.configured ? `Current version: ${config.version}` : "The FeelY terms are being prepared and have not been published yet.";
    if (config.configured) {
      const link = document.querySelector("#document");
      link.href = config.document_url;
      link.hidden = false;
    }
  } catch (error) { status.textContent = error.message; }
})();
