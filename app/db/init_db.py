from app.db.base import Base
from app.db.session import engine
from app.models import billing, user  # noqa: F401


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_sqlite_user_columns()


def ensure_sqlite_user_columns() -> None:
    if engine.dialect.name != "sqlite":
        return

    column_definitions = {
        "role": "VARCHAR(16) NOT NULL DEFAULT 'member'",
        "display_name": "VARCHAR(120)",
        "bio": "VARCHAR(500)",
        "avatar_url": "VARCHAR(500)",
        "auth_provider": "VARCHAR(40) NOT NULL DEFAULT 'password'",
        "google_sub": "VARCHAR(255)",
        "is_email_verified": "BOOLEAN NOT NULL DEFAULT 0",
        "email_verified_at": "DATETIME",
        "email_verification_token_hash": "VARCHAR(128)",
        "email_verification_sent_at": "DATETIME",
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
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_verification_token_hash "
            "ON users (email_verification_token_hash)"
        )
        connection.exec_driver_sql(
            "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_password_reset_token_hash "
            "ON users (password_reset_token_hash)"
        )
