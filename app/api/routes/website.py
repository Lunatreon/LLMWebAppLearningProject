"""Public website: serve only explicitly approved assets, never a directory."""

from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

WEBSITE_ROOT = Path(__file__).resolve().parents[3] / "website"
PUBLIC_FILES = frozenset(
    {
        "webmail.html",
        "webmail.js",
        "webmail.css",
        "index.html",
        "chat.html",
        "admin.html",
        "agb.html",
        "legal/terms-page.js",
        "legal/agb-draft.html",
        "legal/agb-draft.txt",
        "legal/draft-page.js",
        "app.js",
        "admin.js",
        "styles.css",
        "admin.css",
        "assets/feely-favicon.png",
        "assets/feely-lake.png",
        "js/auth.js",
        "js/account.js",
        "js/chat.js",
        "js/journal.js",
        "js/map.js",
        "js/navigation.js",
        "js/start.js",
        "js/load-views.js",
        "js/dialogs.js",
        "js/terms.js",
        "views/auth.html",
        "views/sidebar.html",
        "views/chat.html",
        "views/map.html",
        "views/journal.html",
        "views/account.html",
        "views/password-reset.html",
        "views/reflection.html",
        "views/delete-account.html",
        "views/subscription-cancel.html",
        "views/email-verification.html",
        "views/feedback.html",
        "js/feedback.js",
    }
)

router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "HEAD"])
def public_file(path: str, request: Request):
    if path in {"chat.html", "index.html"}:
        query = f"?{request.url.query}" if request.url.query else ""
        return RedirectResponse(f"/{query}", status_code=307, headers={"Cache-Control": "no-store"})
    name = path or "index.html"
    published_terms = re.fullmatch(r"legal/agb/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.html", name)
    if name not in PUBLIC_FILES and not published_terms:
        raise HTTPException(status_code=404, detail="Not found")
    root = WEBSITE_ROOT.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    cache_control = "no-store" if name in {"index.html", "legal/agb-draft.txt"} else "no-cache"
    return FileResponse(target, headers={"Cache-Control": cache_control})
