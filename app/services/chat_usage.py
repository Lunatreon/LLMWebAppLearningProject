"""Persistent daily message quotas shared by chat endpoints."""

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.user import ChatSession, ChatTurn, DailyLLMUsage


def _message_date(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).date().isoformat()


def saved_user_messages_for_date(db: Session, user_id: int, usage_date: str) -> int:
    """Count saved messages when initializing quotas for existing installations."""

    start = datetime.fromisoformat(usage_date).replace(tzinfo=timezone.utc)
    return (
        db.scalar(
            select(func.count(ChatTurn.id))
            .join(ChatSession)
            .where(
                ChatSession.user_id == user_id,
                ChatTurn.status.in_(("completed", "legacy")),
                ChatTurn.user_input.is_not(None),
                ChatTurn.created_at >= start,
                ChatTurn.created_at < start + timedelta(days=1),
            )
        )
        or 0
    )


def reserve_daily_message(
    db: Session,
    *,
    user_id: int,
    daily_limit: int,
    premium_access: bool,
) -> str | None:
    """Reserve one persistent daily message slot and return its UTC date."""

    if not settings.rate_limit_enabled or daily_limit <= 0:
        return None

    now = datetime.now(timezone.utc)
    usage_date = now.date().isoformat()
    usage = db.execute(
        select(DailyLLMUsage).where(
            DailyLLMUsage.user_id == user_id,
            DailyLLMUsage.usage_date == usage_date,
        )
    ).scalar_one_or_none()
    # The persisted reservation counter is authoritative after initialization.
    # Do not rescan years of conversation history for each new message.
    saved_count = saved_user_messages_for_date(db, user_id, usage_date) if usage is None else 0
    used_messages = max(usage.message_count if usage else 0, saved_count)
    if used_messages >= daily_limit:
        tomorrow = datetime.combine(
            now.date() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        retry_after = max(1, int((tomorrow - now).total_seconds()))
        detail = (
            "Daily message limit reached. Please try again tomorrow."
            if premium_access
            else (
                f"You have reached today's {daily_limit} free messages. "
                "Subscribe to Premium for more messages, or continue tomorrow."
            )
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )

    if usage is None:
        usage = DailyLLMUsage(
            user_id=user_id,
            usage_date=usage_date,
            message_count=used_messages + 1,
        )
        db.add(usage)
    else:
        usage.message_count = used_messages + 1
    db.commit()
    return usage_date


def release_daily_message(db: Session, *, user_id: int, usage_date: str | None) -> None:
    """Return a reserved slot when no assistant response was saved."""

    if usage_date is None:
        return
    db.rollback()
    usage = db.execute(
        select(DailyLLMUsage).where(
            DailyLLMUsage.user_id == user_id,
            DailyLLMUsage.usage_date == usage_date,
        )
    ).scalar_one_or_none()
    if usage is not None and usage.message_count > 0:
        usage.message_count -= 1
        db.commit()
