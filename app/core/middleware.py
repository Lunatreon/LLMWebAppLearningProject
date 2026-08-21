import base64
import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.config import settings


logger = logging.getLogger(__name__)


class RejectedCorsPreflightLoggingMiddleware:
    """Log the headers Starlette needs to diagnose rejected CORS preflights."""

    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope.get("type") != "http" or scope.get("method") != "OPTIONS":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])

        async def send_with_diagnostic(message: dict[str, Any]) -> None:
            if message.get("type") == "http.response.start" and int(
                message.get("status", 0)
            ) >= 400:
                logger.warning(
                    "Rejected CORS preflight: origin=%r method=%r headers=%r path=%s",
                    headers.get(b"origin", b"").decode("latin-1"),
                    headers.get(b"access-control-request-method", b"").decode("latin-1"),
                    headers.get(b"access-control-request-headers", b"").decode("latin-1"),
                    scope.get("path", ""),
                )
            await send(message)

        await self.app(scope, receive, send_with_diagnostic)


class RequestSizeLimitMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]], max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope["type"] != "http" or self.max_body_bytes <= 0:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                body_size = int(content_length.decode("ascii"))
            except ValueError:
                body_size = 0
            if body_size > self.max_body_bytes:
                await send_json_error(
                    send,
                    status_code=413,
                    detail="Request body is too large.",
                )
                return

        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: dict[str, Any]) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                existing = {name.lower() for name, _ in headers}
                security_headers = {
                    b"x-content-type-options": b"nosniff",
                    b"x-frame-options": b"DENY",
                    b"referrer-policy": b"same-origin",
                    b"permissions-policy": b"camera=(), microphone=(), geolocation=()",
                    b"cross-origin-resource-policy": b"same-site",
                }
                for name, value in security_headers.items():
                    if name not in existing:
                        headers.append((name, value))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BasicAuthMiddleware:
    def __init__(self, app: Callable[..., Awaitable[None]]) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, Any], receive: Callable, send: Callable) -> None:
        if scope["type"] != "http" or not settings.basic_auth_enabled:
            await self.app(scope, receive, send)
            return

        # CORS preflights and Stripe-signed webhooks use their own authentication.
        stripe_webhook_path = f"{settings.api_v1_prefix}/billing/webhook"
        if scope.get("method") == "OPTIONS" or scope.get("path") == stripe_webhook_path:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        authorization = headers.get(b"authorization")
        if authorization is None:
            await self._unauthorized(send)
            return

        try:
            scheme, encoded = authorization.decode("ascii").split(" ", 1)
        except (ValueError, UnicodeDecodeError):
            await self._unauthorized(send)
            return

        if scheme.lower() != "basic":
            await self._unauthorized(send)
            return

        try:
            decoded = base64.b64decode(encoded.encode("ascii")).decode("utf-8")
        except (ValueError, UnicodeDecodeError):
            await self._unauthorized(send)
            return

        username, separator, password = decoded.partition(":")
        expected_username = settings.basic_auth_username or ""
        expected_password = settings.basic_auth_password or ""
        if separator != ":" or username != expected_username or password != expected_password:
            await self._unauthorized(send)
            return

        await self.app(scope, receive, send)

    async def _unauthorized(self, send: Callable) -> None:
        body = json.dumps({"detail": "Authentication required."}).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("ascii")),
                    (b"www-authenticate", b'Basic realm="Restricted"'),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


async def send_json_error(send: Callable, *, status_code: int, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status_code,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
