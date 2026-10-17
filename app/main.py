import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.middleware import (
    BasicAuthMiddleware,
    HttpRateLimitMiddleware,
    RejectedCorsPreflightLoggingMiddleware,
    RequestSizeLimitMiddleware,
    SecurityHeadersMiddleware,
)
from app.db.init_db import init_db
from app.llm.providers.ollama import warm_ollama_model
from app.services.webmail import poll_mail


@asynccontextmanager
async def lifespan(app: FastAPI, init_database: bool = True):
    if init_database:
        init_db()
    warm_task = None
    mail_task = (
        asyncio.create_task(poll_mail()) if settings.webmail_enabled and init_database else None
    )
    if settings.ollama_prewarm:
        warm_task = asyncio.create_task(warm_ollama_model())
    try:
        yield
    finally:
        if mail_task is not None:
            mail_task.cancel()
            with suppress(asyncio.CancelledError):
                await mail_task
        if warm_task is not None and not warm_task.done():
            warm_task.cancel()
            with suppress(asyncio.CancelledError):
                await warm_task


def create_app(init_database: bool = True) -> FastAPI:
    settings.validate_runtime_security()

    async def app_lifespan(app: FastAPI):
        async with lifespan(app, init_database=init_database):
            yield

    app = FastAPI(
        title=settings.app_name,
        lifespan=app_lifespan,
        openapi_url="/openapi.json" if settings.api_docs_enabled else None,
        docs_url="/docs" if settings.api_docs_enabled else None,
        redoc_url=None,
    )

    app.add_middleware(BasicAuthMiddleware)
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_body_bytes=settings.max_request_body_bytes,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=(
            r"^(https?://([a-z0-9-]+\.)*(feel-y\.com|selinabernard\.com)"
            r"|https?://(localhost|127\.0\.0\.1|0\.0\.0\.0|.*\.trycloudflare\.com)"
            r"(:\d+)?)$"
            if settings.environment.lower() == "local"
            else None
        ),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RejectedCorsPreflightLoggingMiddleware)
    app.add_middleware(HttpRateLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    if settings.allowed_hosts:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.allowed_hosts)

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    # Native installations can serve the same compiled React build as Caddy.
    # This router only exposes built assets and known application routes.
    from app.api.routes.website import router as frontend_router

    app.include_router(frontend_router, include_in_schema=False)
    return app


app = create_app()
