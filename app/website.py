"""Optional native static server for the compiled React frontend.

Build frontend-react first. Development uses Vite on port 5173 instead.
"""

from fastapi import FastAPI
from app.api.routes.website import PUBLIC_FILES, WEBSITE_ROOT, public_file, router
from app.core.middleware import HttpRateLimitMiddleware, SecurityHeadersMiddleware

app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
app.add_middleware(HttpRateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(router)
