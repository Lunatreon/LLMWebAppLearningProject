from __future__ import annotations

import math
from collections import defaultdict, deque
from threading import Lock
from time import monotonic

from fastapi import HTTPException, Request, status

from app.core.config import settings


class SlidingWindowRateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._expires: dict[str, float] = {}
        self._next_cleanup = 0.0

    def check(self, key: str, max_attempts: int, window_seconds: int) -> tuple[bool, float]:
        if max_attempts <= 0 or window_seconds <= 0:
            return True, 0.0

        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            if now >= self._next_cleanup:
                for expired_key in [
                    key for key, expires in self._expires.items() if expires <= now
                ]:
                    self._events.pop(expired_key, None)
                    self._expires.pop(expired_key, None)
                self._next_cleanup = now + 60
            if key not in self._events and len(self._events) >= 10_000:
                return False, 60.0
            events = self._events[key]
            self._expires[key] = now + window_seconds
            while events and events[0] <= cutoff:
                events.popleft()

            if len(events) >= max_attempts:
                retry_after = max(1.0, window_seconds - (now - events[0]))
                return False, retry_after

            events.append(now)
            return True, 0.0

    def reset(self) -> None:
        with self._lock:
            self._events.clear()
            self._expires.clear()
            self._next_cleanup = 0.0


rate_limiter = SlidingWindowRateLimiter()


def client_ip(request: Request) -> str:
    # Uvicorn resolves forwarded headers only from explicitly trusted proxies.
    # Never reinterpret client-controlled headers at the application layer.
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def client_fingerprint(request: Request) -> str:
    return client_ip(request)


def enforce_rate_limit(
    key: str,
    *,
    max_attempts: int,
    window_seconds: int,
    detail: str = "Too many requests. Please wait a moment and try again.",
) -> None:
    if not settings.rate_limit_enabled:
        return

    allowed, retry_after = rate_limiter.check(key, max_attempts, window_seconds)
    if allowed:
        return

    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=detail,
        headers={"Retry-After": str(math.ceil(retry_after))},
    )
