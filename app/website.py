"""Public website application; HTTP handlers live in api/routes/website.py."""

from fastapi import FastAPI

from app.api.routes.website import PUBLIC_FILES, WEBSITE_ROOT, public_file, router
from app.core.middleware import HttpRateLimitMiddleware, SecurityHeadersMiddleware

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(HttpRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(router)
