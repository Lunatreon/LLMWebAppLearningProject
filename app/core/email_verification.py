import hmac
import secrets
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from hashlib import sha256
from urllib.parse import quote

from fastapi import HTTPException, status

from app.core.config import settings
from app.core.mail import send_mail
from app.models.user import User


def current_timestamp() -> datetime:
    return datetime.now(timezone.utc)


def create_email_verification_token(user: User) -> str:
    token = f"{secrets.randbelow(1_000_000):06d}"
    user.email_verification_token_hash = hash_email_verification_pin(user.email, token)
    user.email_verification_sent_at = current_timestamp()
    user.email_verification_attempts = 0
    return token


def hash_email_verification_pin(email: str, pin: str) -> str:
    # Scope short codes to an address so identical PINs cannot verify another user.
    return hash_email_verification_token(f"email-pin:{email.strip().lower()}:{pin}")


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
    return f"{app_url}/?verify_email_token={quote(token)}"


def send_email_verification_message(user: User, token: str) -> None:
    if not settings.email_verification_enabled:
        return
    if not settings.email_delivery_configured:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Email verification is enabled, but SMTP is not configured.",
        )

    message = EmailMessage()
    message["Subject"] = "Your FeelY activation code"
    message["To"] = user.email
    message.set_content(
        f"Hi {user.display_name or user.username},\n\n"
        f"Your FeelY activation PIN is: {token}\n\n"
        "Enter this six-digit code in FeelY to activate your account.\n"
        f"It expires in {settings.email_verification_pin_expire_minutes} minutes "
        "and can only be used once.\n\n"
        "If you did not request this code, you can ignore this email.\n"
    )
    send_mail(message)
