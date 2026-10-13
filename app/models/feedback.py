from datetime import datetime

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import LegacyDateTime
from app.models.user import User, utc_now


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(24))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    user: Mapped[User] = relationship(back_populates="feedback_entries")
