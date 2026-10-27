"""One versioned document containing the allowlisted application preferences."""

from sqlalchemy import CheckConstraint, Integer, JSON
from sqlalchemy.orm import Mapped, mapped_column
from backend.db.base import Base


class AppSettings(Base):
    __tablename__ = "app_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_app_settings_singleton"),
        CheckConstraint("revision >= 1", name="ck_app_settings_revision"),
    )
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    values: Mapped[dict] = mapped_column(JSON, nullable=False)
