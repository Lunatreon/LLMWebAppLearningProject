from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.user import User, utc_now


class TermsAcceptance(Base):
    __tablename__ = "terms_acceptances"
    __table_args__ = (UniqueConstraint("user_id", "version", name="uq_terms_user_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    version: Mapped[str] = mapped_column(String(80))
    document_url: Mapped[str] = mapped_column(String(2048))
    document_sha256: Mapped[str] = mapped_column(String(64))
    accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    client: Mapped[str] = mapped_column(String(16))
    user: Mapped[User] = relationship(back_populates="terms_acceptances")
