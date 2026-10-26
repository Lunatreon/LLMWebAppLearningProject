import hmac
import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from hashlib import sha256
from urllib.parse import quote

from fastapi import HTTPException, status

from backend.core.config import settings
from backend.integrations.email import send_mail
from backend.models.user import User


def current_timestamp() -> datetime:
    return datetime.now(timezone.utc)


def create_password_reset_token(user: User) -> str:
    token = secrets.token_urlsafe(32)
    user.password_reset_token_hash = hash_password_reset_token(token)
    user.password_reset_sent_at = current_timestamp()
    return token


def hash_password_reset_token(token: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        f"password-reset:{token.strip()}".encode("utf-8"),
        sha256,
    ).hexdigest()


def password_reset_is_expired(sent_at: datetime | None) -> bool:
    if sent_at is None:
        return True
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    expires_at = sent_at + timedelta(minutes=settings.password_reset_token_expire_minutes)
    return current_timestamp() > expires_at


def password_reset_link(token: str) -> str:
    app_url = settings.public_app_url.rstrip("/")
    return f"{app_url}/?reset_password_token={quote(token)}"


def send_password_reset_message(user: User, token: str) -> None:
    if not settings.password_reset_enabled or not settings.email_delivery_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset email is not configured.",
        )

    message = EmailMessage()
    message["Subject"] = "Reset your FeelY password"
    message["To"] = user.email
    link = password_reset_link(token)
    message.set_content(
        "\n".join(
            [
                f"Hi {user.display_name or user.username},",
                "",
                "Open this link to choose a new FeelY password:",
                link,
                "",
                f"This link expires in {settings.password_reset_token_expire_minutes} minutes.",
                "If you did not request a reset, you can ignore this email.",
            ]
        )
    )

    send_mail(message)
