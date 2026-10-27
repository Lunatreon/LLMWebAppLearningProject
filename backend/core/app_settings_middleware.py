"""Apply a fresh preference snapshot to each request without mutating global settings."""

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse
from backend.core.config import runtime_setting_values, settings


class AppSettingsMiddleware:
    def __init__(self, app, owner):
        self.app, self.owner = app, owner

    def load(self):
        from backend.api.dependencies import get_db
        from backend.models.app_settings import AppSettings
        from backend.services.app_settings import overrides

        factory = self.owner.dependency_overrides.get(get_db, get_db)
        generator = factory()
        try:
            db = next(generator)
            return overrides(db.get(AppSettings, 1))
        finally:
            generator.close()

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or scope.get("method") == "OPTIONS"
            or not path.startswith(settings.api_v1_prefix + "/")
            or path == settings.api_v1_prefix + "/health"
        ):
            return await self.app(scope, receive, send)
        try:
            values = await run_in_threadpool(self.load)
        except Exception:
            response = JSONResponse(
                {"detail": "Application settings could not be loaded."}, status_code=503
            )
            return await response(scope, receive, send)
        token = runtime_setting_values.set(values)
        try:
            await self.app(scope, receive, send)
        finally:
            runtime_setting_values.reset(token)
