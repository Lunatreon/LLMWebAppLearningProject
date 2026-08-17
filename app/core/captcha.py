import uuid
from typing import Any

import httpx
from fastapi import HTTPException, Request, status

from app.core.config import TURNSTILE_TEST_SECRET_KEYS, settings
from app.core.rate_limit import client_ip


def captcha_public_config() -> dict[str, str | bool | None]:
    return {
        "enabled": settings.captcha_enabled,
        "provider": settings.captcha_provider.lower() if settings.captcha_enabled else None,
        "site_key": settings.turnstile_site_key if settings.captcha_enabled else None,
        "action": settings.turnstile_action if settings.captcha_enabled else None,
    }


def verify_registration_captcha(token: str | None, request: Request) -> None:
    if not settings.captcha_enabled:
        return

    if settings.captcha_provider.lower() != "turnstile":
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CAPTCHA provider is not supported.",
        )

    if not settings.turnstile_secret_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="CAPTCHA is not configured.",
        )

    if not token or not token.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please complete the verification before creating an account.",
        )

    try:
        with httpx.Client(timeout=settings.turnstile_timeout_seconds) as client:
            response = client.post(
                settings.turnstile_verify_url,
                data={
                    "secret": settings.turnstile_secret_key,
                    "response": token.strip(),
                    "remoteip": client_ip(request),
                    "idempotency_key": str(uuid.uuid4()),
                },
            )
            response.raise_for_status()
            payload = response.json()
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Verification timed out. Please try again.",
        ) from exc
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Verification service rejected the request.",
        ) from exc
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Verification service is unavailable. Please try again.",
        ) from exc

    uses_test_secret = settings.turnstile_secret_key.strip() in TURNSTILE_TEST_SECRET_KEYS
    if not turnstile_succeeded(
        payload,
        expected_action=settings.turnstile_action,
        allow_missing_action=uses_test_secret,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification failed. Please try again.",
        )


def turnstile_succeeded(
    payload: Any,
    *,
    expected_action: str,
    allow_missing_action: bool = False,
) -> bool:
    if not isinstance(payload, dict) or payload.get("success") is not True:
        return False

    action = payload.get("action")
    return (
        action == expected_action
        or (allow_missing_action and not action)
    )
