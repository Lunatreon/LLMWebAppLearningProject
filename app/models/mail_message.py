from datetime import datetime, timezone

from sqlalchemy import Boolean, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.types import LegacyDateTime


class MailMessage(Base):
    __tablename__ = "mail_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    delivery_key: Mapped[str] = mapped_column(String(100), unique=True)
    folder: Mapped[str] = mapped_column(String(20), index=True)
    sender: Mapped[str] = mapped_column(Text)
    recipient: Mapped[str] = mapped_column(Text)
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    raw: Mapped[bytes] = mapped_column(LargeBinary)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
