from urllib.parse import urlsplit

from sqlalchemy import select

from app.core.config import settings
from app.models.terms import TermsAcceptance


def terms_config():
    url = urlsplit(settings.terms_document_url)
    configured = bool(
        settings.terms_version.strip()
        and settings.terms_document_sha256
        and url.scheme == "https"
        and url.hostname
        and not url.username
        and not url.password
        and len(settings.terms_document_url) <= 2048
    )
    return {
        "configured": configured,
        "version": settings.terms_version if configured else None,
        "document_url": settings.terms_document_url if configured else None,
        "document_sha256": settings.terms_document_sha256 if configured else None,
        "enforced": configured,
    }


def has_accepted_current(db, user_id, current):
    return (
        db.scalar(
            select(TermsAcceptance.id).where(
                TermsAcceptance.user_id == user_id,
                TermsAcceptance.version == current["version"],
                TermsAcceptance.document_url == current["document_url"],
                TermsAcceptance.document_sha256 == current["document_sha256"],
            )
        )
        is not None
    )
