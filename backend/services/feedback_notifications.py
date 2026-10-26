"""Best-effort email notifications; the database remains the feedback inbox."""

import logging
from email.message import EmailMessage

from backend.core.config import settings
from backend.integrations.email import send_mail

logger = logging.getLogger(__name__)


def send_feedback_notification(entry_id: int, email: str, category: str, body: str) -> None:
    if not settings.feedback_email_to:
        return
    try:
        message = EmailMessage()
        message["To"] = settings.feedback_email_to
        message["Reply-To"] = email
        message["Subject"] = f"FeelY feedback #{entry_id}: {category}"
        message.set_content(
            f"Feedback #{entry_id}\nCategory: {category}\nFrom: {email}\n\n{body}\n"
        )
        send_mail(message)
    except Exception:
        # Do not log user content, SMTP responses, credentials, or reset tokens.
        logger.warning(
            "Email notification failed for feedback %s; saved feedback remains in admin.", entry_id
        )
