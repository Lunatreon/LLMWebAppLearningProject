"""Public website: serve only explicitly approved assets, never a directory."""
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from app.core.middleware import HttpRateLimitMiddleware, SecurityHeadersMiddleware

WEBSITE_ROOT = Path(__file__).resolve().parents[1] / "website"
PUBLIC_FILES = frozenset({
    "index.html", "chat.html", "admin.html", "app.js", "admin.js",
    "styles.css", "admin.css", "assets/feely-landscape.jpg", "assets/feely-favicon.png",
})

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(HttpRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)


@app.api_route("/{path:path}", methods=["GET", "HEAD"])
def public_file(path: str):
    name = path or "index.html"
    if name not in PUBLIC_FILES:
        raise HTTPException(status_code=404, detail="Not found")
    root = WEBSITE_ROOT.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(target)
