import hmac
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from hashlib import sha256
from urllib.parse import quote

from fastapi import HTTPException, status

from app.core.config import settings
from app.models.user import User


def current_timestamp() -> datetime:
    return datetime.now(timezone.utc)


def create_email_verification_token(user: User) -> str:
    token = secrets.token_urlsafe(32)
    user.email_verification_token_hash = hash_email_verification_token(token)
    user.email_verification_sent_at = current_timestamp()
    return token


def hash_email_verification_token(token: str) -> str:
    return hmac.new(
        settings.secret_key.encode("utf-8"),
        token.strip().encode("utf-8"),
        sha256,
    ).hexdigest()


def email_verification_is_expired(sent_at: datetime | None) -> bool:
    if sent_at is None:
        return True
    if sent_at.tzinfo is None:
        sent_at = sent_at.replace(tzinfo=timezone.utc)
    expires_at = sent_at + timedelta(hours=settings.email_verification_token_expire_hours)
    return current_timestamp() > expires_at


def email_verification_link(token: str) -> str:
    app_url = settings.public_app_url.rstrip("/")
    return f"{app_url}/chat.html?verify_email_token={quote(token)}"


def send_email_verification_message(user: User, token: str) -> None:
    if not settings.email_verification_enabled:
        return
    if not settings.email_delivery_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email verification is enabled, but SMTP is not configured.",
        )

    message = EmailMessage()
    message["Subject"] = "Verify your FeelY email"
    message["From"] = settings.smtp_from_email
    message["To"] = user.email
    link = email_verification_link(token)
    message.set_content(
        "\n".join(
            [
                f"Hi {user.display_name or user.username},",
                "",
                "Please verify your FeelY email address by opening this link:",
                link,
                "",
                "If you did not create this account, you can ignore this email.",
            ]
        )
    )

    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)
    except OSError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send verification email. Please try again later.",
        ) from exc

