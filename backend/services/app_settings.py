"""Database-backed preferences, with request-scoped application and revision checks."""

from fastapi import HTTPException
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from backend.core.config import settings
from backend.models.app_settings import AppSettings
from backend.schemas.app_settings import AppPreferences

FLAGS = (
    "feedback_enabled",
    "password_reset_enabled",
    "premium_features_enabled",
    "rate_limit_llm_free_user_per_day",
    "rate_limit_llm_user_per_day",
)


def deployment_defaults():
    base = settings.model_dump()
    result = {key: base[key] for key in FLAGS}
    for role in ("chat", "topic"):
        provider = (base[role + "_llm_provider"] or base["llm_provider"]).lower()
        result[role + "_provider"] = provider
        result[role + "_model"] = (
            (base.get(f"{provider}_{role}_model") or base.get(f"{provider}_model", ""))
            if provider not in {"mock", "local"}
            else ""
        )
    return result


def preferences(row):
    return AppPreferences.model_validate({**deployment_defaults(), **(row.values if row else {})})


def overrides(row):
    if row is None or not row.values:
        return {}
    value = preferences(row).model_dump()
    result = {key: value[key] for key in FLAGS}
    for role in ("chat", "topic"):
        provider = value[role + "_provider"]
        result[role + "_llm_provider"] = provider
        if provider not in {"mock", "local"}:
            result[f"{provider}_{role}_model"] = value[role + "_model"]
    return result


def read_settings(db):
    row = db.get(AppSettings, 1)
    base = settings.model_dump()
    return {
        "revision": row.revision if row else 0,
        "overridden": bool(row and row.values),
        "values": preferences(row).model_dump(),
        "defaults": deployment_defaults(),
        "providers": {
            "mock": True,
            "local": True,
            "openai": bool(base["openai_api_key"]),
            "anthropic": bool(base["anthropic_api_key"]),
            "ollama": bool(base["ollama_base_url"]),
        },
        "default_models": {
            provider: {
                role: base[f"{provider}_{role}_model"] or base[f"{provider}_model"]
                for role in ("chat", "topic")
            }
            for provider in ("openai", "anthropic", "ollama")
        },
        "email_delivery_configured": settings.email_delivery_configured,
    }


def save_settings(db, values, expected_revision):
    if values:
        value = AppPreferences.model_validate(values)
        available = read_settings(db)["providers"]
        for role in ("chat", "topic"):
            if not available[getattr(value, role + "_provider")]:
                raise HTTPException(
                    422,
                    f"Configure credentials for the {role} provider in the deployment environment first.",
                )
        if value.password_reset_enabled and not settings.email_delivery_configured:
            raise HTTPException(422, "Configure SMTP before enabling password reset.")
        values = value.model_dump()
    try:
        if expected_revision == 0:
            db.add(AppSettings(id=1, revision=1, values=values))
        else:
            changed = db.execute(
                update(AppSettings)
                .where(AppSettings.id == 1, AppSettings.revision == expected_revision)
                .values(values=values, revision=expected_revision + 1)
            )
            if changed.rowcount != 1:
                raise HTTPException(409, "App settings changed. Reload before saving again.")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "App settings changed. Reload before saving again.") from None
    db.expire_all()
    return read_settings(db)
