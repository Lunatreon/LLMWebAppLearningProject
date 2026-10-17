"""Serve the compiled React application without exposing repository files."""

from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

WEBSITE_ROOT = Path(__file__).resolve().parents[3] / "frontend-react" / "dist"
PUBLIC_FILES = frozenset(
    {
        "index.html",
        "admin.html",
        "admin.js",
        "admin.css",
        "styles.css",
        "webmail.html",
        "webmail.js",
        "webmail.css",
        "feely-favicon.png",
        "legal/terms-page.js",
        "legal/agb-draft.html",
        "legal/agb-draft.txt",
        "legal/draft-page.js",
    }
)
SPA_ROUTES = frozenset(
    {
        "",
        "index.html",
        "chat.html",
        "agb.html",
        "chat",
        "map",
        "journal",
        "reflection",
        "account",
        "feedback",
        "terms",
        "login",
        "register",
        "activate",
        "activate-link",
        "forgot-password",
        "reset-password",
    }
)
router = APIRouter()


@router.api_route("/{path:path}", methods=["GET", "HEAD"])
def public_file(path: str, request: Request):
    name = "index.html" if path.rstrip("/") in SPA_ROUTES else path
    published_terms = re.fullmatch(r"legal/agb/[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}\.html", name)
    asset = re.fullmatch(
        r"assets/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2?|ttf)", name
    )
    if name not in PUBLIC_FILES and not published_terms and not asset:
        raise HTTPException(status_code=404, detail="Not found")
    root = WEBSITE_ROOT.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(
        target,
        headers={"Cache-Control": "no-store" if name.endswith((".html", ".txt")) else "no-cache"},
    )
