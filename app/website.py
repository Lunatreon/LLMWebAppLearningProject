"""Public website: serve only explicitly approved assets, never a directory."""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

from app.core.middleware import HttpRateLimitMiddleware, SecurityHeadersMiddleware

WEBSITE_ROOT = Path(__file__).resolve().parents[1] / "website"
PUBLIC_FILES = frozenset({
    "webmail.html", "webmail.js", "webmail.css",
    "index.html", "chat.html", "admin.html", "app.js", "admin.js",
    "styles.css", "admin.css", "assets/feely-favicon.png",
    "assets/feely-lake.png",
    "js/auth.js", "js/account.js", "js/chat.js", "js/journal.js",
    "js/map.js", "js/navigation.js", "js/start.js", "js/load-views.js", "js/dialogs.js", "js/terms.js",
    "views/auth.html", "views/sidebar.html", "views/chat.html", "views/map.html",
    "views/journal.html", "views/account.html", "views/password-reset.html",
    "views/reflection.html", "views/delete-account.html",
    "views/subscription-cancel.html",
    "views/email-verification.html", "views/feedback.html", "js/feedback.js",
})

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(HttpRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
def public_file(path: str, request: Request):
    if path in {"chat.html", "index.html"}:
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"/{query}", status_code=307, headers={"Cache-Control": "no-store"})
    name = path or "index.html"
    if name not in PUBLIC_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    root = WEBSITE_ROOT.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    cache_control = "no-store" if name == "index.html" else "no-cache"
    return FileResponse(target, headers={"Cache-Control": cache_control})
