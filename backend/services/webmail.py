"""Pull durable incoming mail from Cloudflare; acknowledge only after DB commit."""

import asyncio
import logging
import re
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.core.config import settings
from backend.db.session import SessionLocal
from backend.models.mail_message import MailMessage

MAX_MAIL_BYTES = 25 * 1024 * 1024
logger = logging.getLogger(__name__)
sync_state = {"last_success": None, "error": None}


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        if tag in ("br", "p", "div", "li"):
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def parse_mail(raw):
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    part = msg.get_body(preferencelist=("plain", "html"))
    body = ""
    if part:
        try:
            body = part.get_content()
        except (LookupError, UnicodeError):
            body = (part.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        if part.get_content_type() == "text/html":
            parser = PlainHTML()
            parser.feed(body)
            body = "".join(parser.parts)
    return msg, body


def save_incoming(db, key, raw):
    if db.scalar(select(MailMessage.id).where(MailMessage.delivery_key == key)):
        return
    msg, body = parse_mail(raw)
    db.add(
        MailMessage(
            delivery_key=key,
            folder="inbox",
            sender=str(msg.get("From", "")),
            recipient=settings.webmail_address,
            subject=str(msg.get("Subject", "(No subject)")),
            body=body,
            raw=raw,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if not db.scalar(select(MailMessage.id).where(MailMessage.delivery_key == key)):
            raise


def pull_mail():
    from datetime import datetime, timezone

    base = settings.webmail_worker_url.rstrip("/")
    if not base or len(settings.webmail_bridge_secret) < 32:
        sync_state["error"] = "Incoming mail bridge is not configured."
        return
    if not base.startswith("https://"):
        sync_state["error"] = "The mail bridge must use HTTPS."
        return
    try:
        with httpx.Client(
            base_url=base,
            headers={"Authorization": f"Bearer {settings.webmail_bridge_secret}"},
            timeout=30,
            follow_redirects=False,
        ) as client:
            response = client.get("/messages")
            response.raise_for_status()
            for key in response.json()["keys"]:
                # The Worker returns UUID-based object keys, never URLs.
                if not re.fullmatch(r"mail/[a-f0-9-]{36}", key):
                    raise ValueError("Invalid bridge key")
                with client.stream("GET", f"/messages/{key}") as response:
                    response.raise_for_status()
                    raw = bytearray()
                    for chunk in response.iter_bytes():
                        raw.extend(chunk)
                        if len(raw) > MAX_MAIL_BYTES:
                            raise ValueError("Message too large")
                with SessionLocal() as db:
                    save_incoming(db, key, bytes(raw))
                response = client.delete(f"/messages/{key}")
                response.raise_for_status()
        sync_state.update(last_success=datetime.now(timezone.utc).isoformat(), error=None)
    except Exception:
        sync_state["error"] = "Incoming sync failed; unacknowledged messages remain in Cloudflare."
        logger.warning("Webmail sync failed; check bridge configuration and connectivity.")


async def poll_mail():
    while True:
        await asyncio.to_thread(pull_mail)
        await asyncio.sleep(60)
