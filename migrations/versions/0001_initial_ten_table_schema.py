"""Initial ten-table schema

Revision ID: 0001
Revises:
"""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mail_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("delivery_key", sa.String(length=100), nullable=False),
        sa.Column("folder", sa.String(length=20), nullable=False),
        sa.Column("sender", sa.Text(), nullable=False),
        sa.Column("recipient", sa.Text(), nullable=False),
        sa.Column("subject", sa.Text(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("raw", sa.LargeBinary(), nullable=False),
        sa.Column("is_read", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("delivery_key"),
    )
    with op.batch_alter_table("mail_messages", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_mail_messages_folder"), ["folder"], unique=False)

    op.create_table(
        "processed_stripe_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stripe_event_id", sa.String(length=255), nullable=False),
        sa.Column("event_type", sa.String(length=120), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("processed_stripe_events", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_processed_stripe_events_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_processed_stripe_events_stripe_event_id"),
            ["stripe_event_id"],
            unique=True,
        )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("hashed_password", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("bio", sa.String(length=500), nullable=True),
        sa.Column("avatar_url", sa.String(length=500), nullable=True),
        sa.Column("auth_provider", sa.String(length=40), nullable=False),
        sa.Column("is_email_verified", sa.Boolean(), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_verification_token_hash", sa.String(length=128), nullable=True),
        sa.Column("email_verification_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("email_verification_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("password_reset_token_hash", sa.String(length=128), nullable=True),
        sa.Column("password_reset_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("role", sa.String(length=16), server_default="member", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email_verification_token_hash"),
        sa.UniqueConstraint("password_reset_token_hash"),
    )
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_users_email"), ["email"], unique=True)
        batch_op.create_index(batch_op.f("ix_users_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_users_username"), ["username"], unique=True)

    op.create_table(
        "billing_subscriptions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True),
        sa.Column("stripe_price_id", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("billing_subscriptions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_billing_subscriptions_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_billing_subscriptions_stripe_customer_id"),
            ["stripe_customer_id"],
            unique=True,
        )
        batch_op.create_index(
            batch_op.f("ix_billing_subscriptions_stripe_subscription_id"),
            ["stripe_subscription_id"],
            unique=True,
        )
        batch_op.create_index(
            batch_op.f("ix_billing_subscriptions_user_id"), ["user_id"], unique=True
        )

    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("chat_id", sa.String(length=120), nullable=False),
        sa.Column("info", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "chat_id", name="uq_chat_sessions_user_chat"),
    )
    with op.batch_alter_table("chat_sessions", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_chat_sessions_chat_id"), ["chat_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_chat_sessions_id"), ["id"], unique=False)

    op.create_table(
        "daily_llm_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("usage_date", sa.String(length=10), nullable=False),
        sa.Column("message_count", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "usage_date", name="uq_daily_llm_usage_user_date"),
    )
    with op.batch_alter_table("daily_llm_usage", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_daily_llm_usage_id"), ["id"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_daily_llm_usage_usage_date"), ["usage_date"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_daily_llm_usage_user_id"), ["user_id"], unique=False)

    op.create_table(
        "feedback",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("category", sa.String(length=24), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("feedback", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_feedback_user_id"), ["user_id"], unique=False)

    op.create_table(
        "journal_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("entry_date", sa.String(length=10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("analysis", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "entry_date", name="uq_journal_entries_user_date"),
    )
    with op.batch_alter_table("journal_entries", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_journal_entries_entry_date"), ["entry_date"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_journal_entries_id"), ["id"], unique=False)
        batch_op.create_index(batch_op.f("ix_journal_entries_user_id"), ["user_id"], unique=False)

    op.create_table(
        "terms_acceptances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.String(length=80), nullable=False),
        sa.Column("document_url", sa.String(length=2048), nullable=False),
        sa.Column("document_sha256", sa.String(length=64), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("client", sa.String(length=16), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "version", name="uq_terms_user_version"),
    )
    with op.batch_alter_table("terms_acceptances", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_terms_acceptances_user_id"), ["user_id"], unique=False)

    op.create_table(
        "user_profiles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.create_index(batch_op.f("ix_user_profiles_id"), ["id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("user_profiles", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_user_profiles_id"))

    op.drop_table("user_profiles")
    with op.batch_alter_table("terms_acceptances", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_terms_acceptances_user_id"))

    op.drop_table("terms_acceptances")
    with op.batch_alter_table("journal_entries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_journal_entries_user_id"))
        batch_op.drop_index(batch_op.f("ix_journal_entries_id"))
        batch_op.drop_index(batch_op.f("ix_journal_entries_entry_date"))

    op.drop_table("journal_entries")
    with op.batch_alter_table("feedback", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_feedback_user_id"))

    op.drop_table("feedback")
    with op.batch_alter_table("daily_llm_usage", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_daily_llm_usage_user_id"))
        batch_op.drop_index(batch_op.f("ix_daily_llm_usage_usage_date"))
        batch_op.drop_index(batch_op.f("ix_daily_llm_usage_id"))

    op.drop_table("daily_llm_usage")
    with op.batch_alter_table("chat_sessions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_chat_sessions_id"))
        batch_op.drop_index(batch_op.f("ix_chat_sessions_chat_id"))

    op.drop_table("chat_sessions")
    with op.batch_alter_table("billing_subscriptions", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_billing_subscriptions_user_id"))
        batch_op.drop_index(batch_op.f("ix_billing_subscriptions_stripe_subscription_id"))
        batch_op.drop_index(batch_op.f("ix_billing_subscriptions_stripe_customer_id"))
        batch_op.drop_index(batch_op.f("ix_billing_subscriptions_id"))

    op.drop_table("billing_subscriptions")
    with op.batch_alter_table("users", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_users_username"))
        batch_op.drop_index(batch_op.f("ix_users_id"))
        batch_op.drop_index(batch_op.f("ix_users_email"))

    op.drop_table("users")
    with op.batch_alter_table("processed_stripe_events", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_processed_stripe_events_stripe_event_id"))
        batch_op.drop_index(batch_op.f("ix_processed_stripe_events_id"))

    op.drop_table("processed_stripe_events")
    with op.batch_alter_table("mail_messages", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_mail_messages_folder"))

    op.drop_table("mail_messages")
