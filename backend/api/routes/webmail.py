import uuid
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_admin, get_db
from backend.core.config import settings
from backend.integrations.email import send_mail
from backend.core.rate_limit import enforce_rate_limit
from backend.models.mail_message import MailMessage
from backend.schemas.webmail import Compose
from backend.services.webmail import parse_mail, sync_state


def enabled():
    if not settings.webmail_enabled:
        raise HTTPException(404, "Webmail is disabled.")


router = APIRouter(dependencies=[Depends(get_current_admin), Depends(enabled)])


def find(db, message_id):
    row = db.get(MailMessage, message_id)
    if row is None:
        raise HTTPException(404, "Message not found.")
    return row


def summary(row):
    return {
        k: getattr(row, k)
        for k in ("id", "folder", "sender", "recipient", "subject", "is_read", "created_at")
    }


@router.get("/status")
def status():
    return {"address": settings.webmail_address, **sync_state}


@router.get("/messages")
def listing(
    folder: Literal["inbox", "sent", "pending", "uncertain", "trash"] = "inbox",
    before: int | None = Query(None, gt=0),
    db: Session = Depends(get_db),
):
    query = select(MailMessage).where(MailMessage.folder == folder)
    if before:
        query = query.where(MailMessage.id < before)
    return [summary(row) for row in db.scalars(query.order_by(MailMessage.id.desc()).limit(50))]


@router.get("/messages/{message_id}")
def detail(message_id: int, db: Session = Depends(get_db)):
    row = find(db, message_id)
    msg, _ = parse_mail(row.raw)
    row.is_read = True
    db.commit()
    return {
        **summary(row),
        "body": row.body,
        "reply_to": parseaddr(str(msg.get("Reply-To") or msg.get("From") or ""))[1],
        "attachments": [
            {"index": i, "name": p.get_filename() or "attachment"}
            for i, p in enumerate(msg.iter_attachments())
        ],
    }


@router.get("/messages/{message_id}/raw")
def raw_message(message_id: int, db: Session = Depends(get_db)):
    return Response(
        find(db, message_id).raw,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="message.eml"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/messages/{message_id}/attachments/{index}")
def attachment(message_id: int, index: int, db: Session = Depends(get_db)):
    msg, _ = parse_mail(find(db, message_id).raw)
    parts = list(msg.iter_attachments())
    if index < 0 or index >= len(parts):
        raise HTTPException(404, "Attachment not found.")
    data = parts[index].get_payload(decode=True)
    if data is None:
        data = parts[index].as_bytes()
    return Response(
        data,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="attachment.bin"',
            "Cache-Control": "no-store",
        },
    )


@router.post("/messages/{message_id}/trash")
def trash(message_id: int, db: Session = Depends(get_db)):
    row = find(db, message_id)
    row.folder = "trash"
    db.commit()
    return {"ok": True}


@router.post("/send")
def send(payload: Compose, admin: str = Depends(get_current_admin), db: Session = Depends(get_db)):
    enforce_rate_limit(f"webmail-send:{admin}", max_attempts=30, window_seconds=3600)
    message = EmailMessage()
    message["From"] = settings.webmail_address
    message["To"] = str(payload.to)
    message["Subject"] = payload.subject
    message["Date"] = formatdate()
    message["Message-ID"] = make_msgid(domain=settings.webmail_address.split("@")[-1])
    if payload.reply_to_id:
        original, _ = parse_mail(find(db, payload.reply_to_id).raw)
        msg_id = str(original.get("Message-ID", ""))
        if msg_id and not any(c in msg_id for c in "\r\n"):
            message["In-Reply-To"] = msg_id
            message["References"] = msg_id
    message.set_content(payload.body)
    row = MailMessage(
        delivery_key=str(uuid.uuid4()),
        folder="pending",
        sender=settings.webmail_address,
        recipient=str(payload.to),
        subject=payload.subject,
        body=payload.body,
        raw=message.as_bytes(),
        is_read=True,
    )
    db.add(row)
    db.commit()
    try:
        send_mail(message, sender=settings.webmail_address)
    except Exception:
        row.folder = "uncertain"
        db.commit()
        raise HTTPException(
            502,
            "Sending was not confirmed. Your message is saved in Unconfirmed; check delivery before resending.",
        ) from None
    row.folder = "sent"
    db.commit()
    return {"id": row.id, "detail": "Accepted by the outgoing mail server."}
