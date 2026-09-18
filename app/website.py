"""Public website: serve only explicitly approved assets, never a directory."""
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse

from app.frontend import render_page
from app.core.middleware import HttpRateLimitMiddleware, SecurityHeadersMiddleware

WEBSITE_ROOT = Path(__file__).resolve().parents[1] / "website"
PUBLIC_FILES = frozenset({
    "index.html", "chat.html", "admin.html", "app.js", "admin.js",
    "styles.css", "admin.css", "assets/feely-landscape.jpg", "assets/feely-favicon.png",
    "assets/feely-lake.png",
    "js/auth.js", "js/account.js", "js/chat.js", "js/journal.js",
    "js/map.js", "js/navigation.js", "js/start.js", "js/load-views.js",
    "views/auth.html", "views/sidebar.html", "views/chat.html", "views/map.html",
    "views/journal.html", "views/account.html", "views/password-reset.html",
    "views/practice.html", "views/reflection.html", "views/delete-account.html",
    "views/subscription-cancel.html",
})

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(HttpRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


def render_index() -> str:
    # Read source files on each request, while also supporting small isolated tests.
    if (WEBSITE_ROOT / "shell.html").is_file():
        return render_page(WEBSITE_ROOT)
    return (WEBSITE_ROOT / "index.html").read_text(encoding="utf-8")


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
    if name == "index.html":
        return HTMLResponse(render_index(), headers={"Cache-Control": "no-store"})
    return FileResponse(target, headers={"Cache-Control": "no-cache"})
