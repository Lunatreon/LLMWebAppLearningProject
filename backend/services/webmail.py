"""Import mail from IMAP or the optional Cloudflare bridge into the local inbox."""

import asyncio
import hashlib
import imaplib
import logging
import re
import ssl
from datetime import datetime, timezone
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


def pull_imap():
    if not all(
        (
            settings.webmail_imap_host,
            settings.webmail_imap_username,
            settings.webmail_imap_password,
            settings.webmail_imap_folder,
        )
    ):
        raise ValueError("IMAP is not configured")
    context = ssl.create_default_context()
    if settings.webmail_imap_use_ssl:
        mailbox = imaplib.IMAP4_SSL(
            settings.webmail_imap_host, settings.webmail_imap_port,
            ssl_context=context, timeout=30,
        )
    else:
        mailbox = imaplib.IMAP4(settings.webmail_imap_host, settings.webmail_imap_port, timeout=30)
    with mailbox:
        if not settings.webmail_imap_use_ssl:
            mailbox.starttls(ssl_context=context)
        mailbox.login(settings.webmail_imap_username, settings.webmail_imap_password)
        status, _ = mailbox.select(settings.webmail_imap_folder, readonly=True)
        if status != "OK":
            raise ValueError("Cannot open IMAP folder")
        _, validity = mailbox.response("UIDVALIDITY")
        if not validity or not validity[0]:
            raise ValueError("Missing IMAP UIDVALIDITY")
        status, data = mailbox.uid("search", None, "ALL")
        if status != "OK":
            raise ValueError("IMAP search failed")
        for uid in data[0].split():
            identity = repr(
                (
                    settings.webmail_imap_host,
                    settings.webmail_imap_port,
                    settings.webmail_imap_username,
                    settings.webmail_imap_folder,
                    validity[0],
                    uid,
                )
            ).encode()
            key = "imap/" + hashlib.sha256(identity).hexdigest()
            with SessionLocal() as db:
                if db.scalar(select(MailMessage.id).where(MailMessage.delivery_key == key)):
                    continue
                status, sizes = mailbox.uid("fetch", uid, "(RFC822.SIZE)")
                size = re.search(
                    rb"RFC822.SIZE (\d+)",
                    b" ".join(part for part in sizes if isinstance(part, bytes)),
                )
                if status != "OK" or not size:
                    raise ValueError("Cannot read IMAP message size")
                if int(size[1]) > MAX_MAIL_BYTES:
                    raise ValueError("Message too large")
                status, parts = mailbox.uid("fetch", uid, "(BODY.PEEK[])")
                raw = next((part[1] for part in parts if isinstance(part, tuple)), None)
                if status != "OK" or raw is None or len(raw) > MAX_MAIL_BYTES:
                    raise ValueError("Cannot read IMAP message")
                save_incoming(db, key, raw)
    # Read-only import: never delete, expunge or change read state on the server.


def pull_mail():
    if settings.incoming_mail_provider == "imap":
        try:
            pull_imap()
            sync_state.update(last_success=datetime.now(timezone.utc).isoformat(), error=None)
        except Exception:
            sync_state["error"] = "Incoming IMAP sync failed; check mail settings and connectivity."
            logger.warning("Webmail IMAP sync failed; messages remain on the mail server.")
        return

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
