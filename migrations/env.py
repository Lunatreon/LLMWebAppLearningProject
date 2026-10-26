"""Alembic shares the application's synchronous engine and registered metadata."""

from alembic import context

from backend.core.config import settings
from backend.db.base import Base
from backend.db.session import create_database_engine, database_url
from backend.db.types import LegacyDateTime
from backend.models import billing, feedback, mail_message, terms, user  # noqa: F401

target_metadata = Base.metadata


def render_schema_item(kind, item, autogen_context):
    if kind == "type" and isinstance(item, LegacyDateTime):
        return f"sa.DateTime(timezone={item.impl.timezone!r})"
    return False


def run_migrations_offline() -> None:
    context.configure(
        url=database_url(settings.database_url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        render_item=render_schema_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = context.config.attributes.get("connection")
    if connection is not None:
        configure_connection(connection)
        return
    engine = create_database_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            configure_connection(connection)
    finally:
        engine.dispose()


def configure_connection(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        render_as_batch=connection.dialect.name == "sqlite",
        render_item=render_schema_item,
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
