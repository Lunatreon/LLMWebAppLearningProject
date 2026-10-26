from pathlib import Path
from sqlalchemy import inspect, select

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from backend.core.config import settings
from backend.db.base import Base
from backend.db.session import engine
from backend.models import billing, feedback, mail_message, terms, user  # noqa: F401


def init_db() -> None:
    if engine.dialect.name != "sqlite" or not settings.is_local_environment:
        require_migrated_schema()
        return
    inspector = inspect(engine)
    if "alembic_version" in inspector.get_table_names():
        require_migrated_schema()
        return
    if "chat_sessions" in inspector.get_table_names():
        if "title" not in {column["name"] for column in inspector.get_columns("chat_sessions")}:
            raise RuntimeError(
                "Legacy chat storage needs migration. Stop the backend and run python -m scripts.migrate_chat_storage (creates a SQLite backup), or alembic upgrade head for a versioned database."
            )
    if "user_profiles" in inspector.get_table_names():
        from backend.models.user import UserProfile

        with engine.connect() as connection:
            if any(
                isinstance(data, dict) and "self_authorship_map" in data
                for data in connection.execute(select(UserProfile.__table__.c.data)).scalars()
            ):
                raise RuntimeError(
                    "Legacy map storage needs migration. Stop the backend and run python -m scripts.migrate_chat_storage with the content key configured (creates a SQLite backup)."
                )
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_user_columns()


def require_migrated_schema() -> None:
    """Startup verifies migrations; it never applies production DDL."""
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    scripts = ScriptDirectory.from_config(config)
    with engine.connect() as connection:
        current = set(MigrationContext.configure(connection).get_current_heads())
    if current != set(scripts.get_heads()):
        raise RuntimeError("Database schema is not at Alembic head. Run alembic upgrade head.")


def ensure_sqlite_user_columns() -> None:
    if engine.dialect.name != "sqlite":
        return

    column_definitions = {
        "role": "VARCHAR(16) NOT NULL DEFAULT 'member'",
        "display_name": "VARCHAR(120)",
        "bio": "VARCHAR(500)",
        "avatar_url": "VARCHAR(500)",
        "auth_provider": "VARCHAR(40) NOT NULL DEFAULT 'password'",
        "is_email_verified": "BOOLEAN NOT NULL DEFAULT 0",
        "email_verified_at": "DATETIME",
        "email_verification_token_hash": "VARCHAR(128)",
        "email_verification_sent_at": "DATETIME",
        "email_verification_attempts": "INTEGER NOT NULL DEFAULT 0",
        "password_reset_token_hash": "VARCHAR(128)",
        "password_reset_sent_at": "DATETIME",
        "last_login_at": "DATETIME",
    }
    with engine.begin() as connection:
        user_columns = {
            column["name"]
            for column in engine.dialect.get_columns(
                connection,
                "users",
            )
        }
        for column_name, definition in column_definitions.items():
            if column_name not in user_columns:
                connection.exec_driver_sql(
                    f"ALTER TABLE users ADD COLUMN {column_name} {definition}"
                )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_verification_token_hash "
            "ON users (email_verification_token_hash)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_password_reset_token_hash "
            "ON users (password_reset_token_hash)"
        )
