from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.middleware import RequestSizeLimitMiddleware, SecurityHeadersMiddleware
from app.db.init_db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI, init_database: bool = True):
    if init_database:
        init_db()
    yield


def create_app(init_database: bool = True) -> FastAPI:
    settings.validate_runtime_security()

    async def app_lifespan(app: FastAPI):
        async with lifespan(app, init_database=init_database):
            yield

    app = FastAPI(title=settings.app_name, lifespan=app_lifespan)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(
        RequestSizeLimitMiddleware,
        max_body_bytes=settings.max_request_body_bytes,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=(
            r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
            if settings.environment.lower() == "local"
            else None
        ),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_app()
