from datetime import timezone
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StrictBool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.core.config import settings
from app.models.terms import TermsAcceptance
from app.models.user import User

router = APIRouter()


def terms_config():
    url = urlsplit(settings.terms_document_url)
    configured = bool(settings.terms_version.strip() and settings.terms_document_sha256
                      and url.scheme == "https" and url.hostname and not url.username
                      and not url.password and len(settings.terms_document_url) <= 2048)
    return {"configured": configured, "version": settings.terms_version if configured else None,
            "document_url": settings.terms_document_url if configured else None,
            "document_sha256": settings.terms_document_sha256 if configured else None,
            "enforced": False}


def acceptance_read(row):
    at = row.accepted_at
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return {"version": row.version, "document_url": row.document_url,
            "document_sha256": row.document_sha256, "accepted_at": at, "client": row.client}


@router.get("/config")
def config():
    return terms_config()


@router.get("/me")
def my_acceptances(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(db.scalars(select(TermsAcceptance).where(TermsAcceptance.user_id == user.id)
                           .order_by(TermsAcceptance.id.desc())))
    current = terms_config()
    return {"current": current, "accepted_current": bool(current["configured"] and any(
        row.version == current["version"] and row.document_sha256 == current["document_sha256"]
        and row.document_url == current["document_url"] for row in rows)),
        "acceptances": [acceptance_read(row) for row in rows]}


class AcceptTerms(BaseModel):
    accepted: StrictBool
    version: str = Field(min_length=1, max_length=80)
    client: Literal["web", "android", "api"] = "api"


@router.post("/accept")
def accept(payload: AcceptTerms, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current = terms_config()
    if not current["configured"]:
        raise HTTPException(503, "AGB document is not configured yet.")
    if not payload.accepted:
        raise HTTPException(400, "Explicit acceptance is required.")
    if payload.version != current["version"]:
        raise HTTPException(409, "The AGB version changed. Display the current document before accepting.")
    query = select(TermsAcceptance).where(TermsAcceptance.user_id == user.id,
                                        TermsAcceptance.version == payload.version)
    row = db.scalar(query)
    if row is None:
        row = TermsAcceptance(user_id=user.id, version=payload.version,
                              document_url=current["document_url"], document_sha256=current["document_sha256"],
                              client=payload.client)
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.scalar(query)
            if row is None:
                raise
    if row.document_url != current["document_url"] or row.document_sha256 != current["document_sha256"]:
        raise HTTPException(409, "This document changed without a new version. Contact the FeelY team.")
    return acceptance_read(row)
