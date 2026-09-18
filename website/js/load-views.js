// Compatibility for a browser that still has the previous shell cached.
// The new index.html already contains all views, styles, and application scripts.
const completePage = new URL(window.location.href);
completePage.searchParams.set("_feely_page", "complete");
window.location.replace(completePage.toString());
