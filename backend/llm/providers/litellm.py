"""Connection settings for a remote LiteLLM OpenAI-compatible proxy."""

from urllib.parse import urlsplit

from fastapi import HTTPException

from backend.core.config import settings


def valid_litellm_base_url(value: str | None) -> bool:
    try:
        url = urlsplit(value or "")
        return bool(
            url.scheme in {"http", "https"}
            and url.hostname
            and not url.username
            and not url.password
            and not url.query
            and not url.fragment
            and (url.port is None or 0 < url.port <= 65535)
        )
    except ValueError:
        return False


def litellm_options(role: str) -> dict:
    if not valid_litellm_base_url(settings.litellm_base_url):
        raise HTTPException(500, "LITELLM_BASE_URL must be a valid HTTP(S) proxy URL.")
    if not (settings.litellm_api_key or "").strip():
        raise HTTPException(500, "LITELLM_API_KEY must be configured for the LiteLLM provider.")
    model = getattr(settings, f"litellm_{role}_model") or settings.litellm_model
    if not model.strip():
        raise HTTPException(500, f"LITELLM_{role.upper()}_MODEL or LITELLM_MODEL is required.")
    return {
        "api_key": settings.litellm_api_key,
        "base_url": settings.litellm_base_url.rstrip("/"),
        "model": model.strip(),
        "timeout_seconds": settings.litellm_timeout_seconds,
        "max_retries": settings.litellm_max_retries,
        "provider_name": "LiteLLM",
    }
