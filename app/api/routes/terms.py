from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.services.terms import terms_config
from app.models.terms import TermsAcceptance
from app.models.user import User
from app.schemas.terms import AcceptTerms

router = APIRouter()


def acceptance_read(row):
    at = row.accepted_at
    if at.tzinfo is None:
        at = at.replace(tzinfo=timezone.utc)
    return {
        "version": row.version,
        "document_url": row.document_url,
        "document_sha256": row.document_sha256,
        "accepted_at": at,
        "client": row.client,
    }


@router.get("/config")
def config():
    return terms_config()


@router.get("/me")
def my_acceptances(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = list(
        db.scalars(
            select(TermsAcceptance)
            .where(TermsAcceptance.user_id == user.id)
            .order_by(TermsAcceptance.id.desc())
        )
    )
    current = terms_config()
    return {
        "current": current,
        "accepted_current": bool(
            current["configured"]
            and any(
                row.version == current["version"]
                and row.document_sha256 == current["document_sha256"]
                and row.document_url == current["document_url"]
                for row in rows
            )
        ),
        "acceptances": [acceptance_read(row) for row in rows],
    }


@router.post("/accept")
def accept(
    payload: AcceptTerms, user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    current = terms_config()
    if not current["configured"]:
        raise HTTPException(503, "AGB document is not configured yet.")
    if not payload.accepted:
        raise HTTPException(400, "Explicit acceptance is required.")
    if payload.version != current["version"]:
        raise HTTPException(
            409, "The AGB version changed. Display the current document before accepting."
        )
    if (
        payload.document_sha256 is not None
        and payload.document_sha256 != current["document_sha256"]
    ):
        raise HTTPException(
            409, "The AGB document changed. Read the current document before accepting."
        )
    query = select(TermsAcceptance).where(
        TermsAcceptance.user_id == user.id, TermsAcceptance.version == payload.version
    )
    row = db.scalar(query)
    if row is None:
        row = TermsAcceptance(
            user_id=user.id,
            version=payload.version,
            document_url=current["document_url"],
            document_sha256=current["document_sha256"],
            client=payload.client,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            row = db.scalar(query)
            if row is None:
                raise
    if (
        row.document_url != current["document_url"]
        or row.document_sha256 != current["document_sha256"]
    ):
        raise HTTPException(
            409, "This document changed without a new version. Contact the FeelY team."
        )
    return acceptance_read(row)
