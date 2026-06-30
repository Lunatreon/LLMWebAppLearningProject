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

    def check(self, key: str, max_attempts: int, window_seconds: int) -> tuple[bool, float]:
        if max_attempts <= 0 or window_seconds <= 0:
            return True, 0.0

        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            events = self._events[key]
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


rate_limiter = SlidingWindowRateLimiter()


def client_ip(request: Request) -> str:
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",", 1)[0].strip() or "unknown"
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()

    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def client_fingerprint(request: Request) -> str:
    user_agent = request.headers.get("user-agent", "unknown")[:120]
    return f"{client_ip(request)}:{user_agent}"


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

