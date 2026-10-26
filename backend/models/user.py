from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.base import Base
from backend.db.types import LegacyDateTime

if TYPE_CHECKING:
    from backend.models.billing import BillingSubscription
    from backend.models.terms import TermsAcceptance


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
    __table_args__ = (
        UniqueConstraint("user_id", "chat_id", name="uq_chat_sessions_user_chat"),
        Index("ix_chat_sessions_user_updated_id", "user_id", "updated_at", "id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    chat_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(120), default="New chat", server_default="New chat")
    title_source: Mapped[str] = mapped_column(
        String(32), default="automatic", server_default="automatic"
    )
    initial_topic_title_set: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default="0"
    )
    message_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    next_position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    conversation_summary: Mapped[str | None] = mapped_column(Text)
    summary_message_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    analysis_status: Mapped[str] = mapped_column(String(32), default="idle", server_default="idle")
    analysed_message_count: Mapped[int | None] = mapped_column(Integer)
    analysis_error: Mapped[str | None] = mapped_column(Text)
    # Only bounded, structured suggestion metadata belongs here; never message bodies.
    info: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        LegacyDateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
    )

    user: Mapped[User] = relationship(back_populates="chat_sessions")
    turns: Mapped[list["ChatTurn"]] = relationship(
        back_populates="chat_session",
        cascade="all, delete-orphan",
        lazy="raise",
    )

    def __init__(self, **kwargs):
        # Accept legacy application/test constructors while keeping storage normalized.
        from migrations.chat_storage_v2 import DERIVED_FIELDS, SCALAR_FIELDS, split_messages

        info = dict(kwargs.pop("info", {}) or {})
        for field in SCALAR_FIELDS:
            if field in info:
                kwargs.setdefault(field, info[field])
        messages = info.get("messages", [])
        kwargs["info"] = {
            key: value for key, value in info.items() if key not in SCALAR_FIELDS | DERIVED_FIELDS
        }
        kwargs.setdefault("next_position", int(info.get("message_count", 0)))
        super().__init__(**kwargs)
        if messages:
            rows = split_messages(
                messages,
                None,
                kwargs.get("created_at", utc_now()),
                int(info.get("message_count", 0)),
            )
            self.turns = [
                ChatTurn(**{key: value for key, value in row.items() if key != "chat_session_id"})
                for row in rows
            ]
            self.next_position = rows[-1]["position"]
            self.message_count = max(
                int(info.get("message_count", 0)), sum(m.get("role") == "user" for m in messages)
            )


class ChatTurn(Base):
    """One ordered user input / assistant response, including unfinished requests."""

    __tablename__ = "chat_turns"
    __table_args__ = (
        UniqueConstraint("chat_session_id", "position", name="uq_chat_turns_session_position"),
        CheckConstraint("position > 0", name="ck_chat_turns_positive_position"),
        CheckConstraint(
            "status IN ('pending', 'completed', 'failed', 'legacy')", name="ck_chat_turns_status"
        ),
        Index("ix_chat_turns_session_status_position", "chat_session_id", "status", "position"),
        Index("ix_chat_turns_session_created", "chat_session_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)
    user_input: Mapped[str | None] = mapped_column(Text)
    llm_response: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(LegacyDateTime(timezone=True), default=utc_now)
    responded_at: Mapped[datetime | None] = mapped_column(LegacyDateTime(timezone=True))
    # Preserve original timestamp spelling and per-message extras during migration.
    user_timestamp: Mapped[str | None] = mapped_column(String(64))
    response_timestamp: Mapped[str | None] = mapped_column(String(64))
    user_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    response_metadata: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    reaction: Mapped[str | None] = mapped_column(String(16))
    chat_session: Mapped[ChatSession] = relationship(back_populates="turns")


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
    """Legacy records retained for backups/transfers; no journal feature is exposed."""

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
