"""Shared, authenticated SMTP delivery for account emails."""

import smtplib
import ssl
from email.message import EmailMessage

from fastapi import HTTPException

from backend.core.config import settings


def send_mail(message: EmailMessage, *, sender: str | None = None) -> None:
    if not settings.email_delivery_configured:
        raise HTTPException(status_code=503, detail="Email delivery is not configured.")
    if "From" in message:
        del message["From"]
    message["From"] = sender or settings.smtp_from_email
    context = ssl.create_default_context()
    try:
        if settings.smtp_use_ssl:
            connection = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=15,
                context=context,
            )
        else:
            connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
        with connection as smtp:
            if settings.smtp_use_tls and not settings.smtp_use_ssl:
                smtp.starttls(context=context)
            if settings.smtp_username:
                smtp.login(settings.smtp_username, settings.smtp_password or "")
            smtp.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise HTTPException(
            status_code=502,
            detail="Could not send the email. Please try again later.",
        ) from exc
