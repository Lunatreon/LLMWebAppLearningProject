from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import Boolean, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.types import LegacyDateTime

if TYPE_CHECKING:
    from app.models.billing import BillingSubscription
    from app.models.terms import TermsAcceptance


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    auth_provider: Mapped[str] = mapped_column(String(40), default="password", nullable=False)
    is_email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    email_verified_at: Mapped[datetime | None] = mapped_column(
        LegacyDateTime(timezone=True), nullable=True
    )
    email_verification_token_hash: Mapped[str | None] = mapped_column(
        String(128),
        unique=True,
        nullable=True,
    )
    email_verification_sent_at: Mapped[datetime | None] = mapped_column(
        LegacyDateTime(timezone=True),
        nullable=True,
    )
    email_verification_attempts: Mapped[int] = mapped_column(
        Integer,
        default=0,
        server_default="0",
        nullable=False,
    )
    password_reset_token_hash: Mapped[str | None] = mapped_column(
        String(128),
        unique=True,
        nullable=True,
    )
    password_reset_sent_at: Mapped[datetime | None] = mapped_column(
        LegacyDateTime(timezone=True),
        nullable=True,
    )
    last_login_at: Mapped[datetime | None] = mapped_column(
        LegacyDateTime(timezone=True), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    role: Mapped[str] = mapped_column(
        String(16), default="member", server_default="member", nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    profile: Mapped["UserProfile"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    billing_subscription: Mapped["BillingSubscription | None"] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        uselist=False,
    )
    journal_entries: Mapped[list["JournalEntry"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    feedback_entries: Mapped[list["Feedback"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    terms_acceptances: Mapped[list["TermsAcceptance"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class UserProfile(Base):
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    user: Mapped[User] = relationship(back_populates="profile")


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (UniqueConstraint("user_id", "chat_id", name="uq_chat_sessions_user_chat"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    chat_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    info: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    user: Mapped[User] = relationship(back_populates="chat_sessions")


class DailyLLMUsage(Base):
    """Persistent per-user message usage so quotas survive process restarts."""

    __tablename__ = "daily_llm_usage"
    __table_args__ = (
        UniqueConstraint("user_id", "usage_date", name="uq_daily_llm_usage_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    usage_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    message_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "entry_date", name="uq_journal_entries_user_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    entry_date: Mapped[str] = mapped_column(String(10), index=True, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    analysis: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    user: Mapped[User] = relationship(back_populates="journal_entries")
