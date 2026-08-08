from typing import Any

from fastapi import HTTPException, status

from app.core.config import settings


def google_public_config() -> dict[str, str | bool | None]:
    return {
        "enabled": settings.google_auth_enabled,
        "client_id": settings.google_client_id if settings.google_auth_enabled else None,
    }


def verify_google_credential(credential: str) -> dict[str, Any]:
    if not settings.google_auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google sign-in is not enabled.",
        )
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Google sign-in is not configured.",
        )

    try:
        from google.auth.transport import requests
        from google.oauth2 import id_token

        payload = id_token.verify_oauth2_token(
            credential,
            requests.Request(),
            settings.google_client_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google credential could not be verified.",
        ) from exc

    hosted_domain = payload.get("hd")
    if (
        settings.google_allowed_hosted_domain
        and hosted_domain != settings.google_allowed_hosted_domain
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This Google account is not allowed for this app.",
        )

    if not payload.get("sub") or not payload.get("email"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Google credential is missing required account information.",
        )

    return payload


def google_email_is_authoritative(payload: dict[str, Any]) -> bool:
    email = str(payload.get("email") or "").lower()
    return bool(payload.get("email_verified")) and (
        email.endswith("@gmail.com") or bool(payload.get("hd"))
    )

