"""Back up and upgrade a native, unversioned SQLite database without stamping history."""

from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import os

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect

from app.core.config import settings
from app.db.session import create_database_engine, database_url
from migrations.chat_storage_v2 import upgrade_chat_storage


def main():
    url = database_url(settings.database_url)
    if url.get_backend_name() != "sqlite" or not url.database or url.database == ":memory:":
        raise RuntimeError(
            "This helper is for native SQLite. Use alembic upgrade head for PostgreSQL."
        )
    source = Path(url.database).resolve()
    if not source.is_file():
        raise RuntimeError("The configured SQLite database does not exist.")
    backup = source.with_name(
        source.name + "." + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ") + ".backup"
    )
    os.close(os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
    with sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True) as reader:
        with sqlite3.connect(backup) as writer:
            reader.backup(writer)
    backup.chmod(0o600)
    engine = create_database_engine(url)
    try:
        with engine.connect() as connection:
            # Reserve the writer lock before any schema/data conversion.
            connection.exec_driver_sql("BEGIN EXCLUSIVE")
            try:
                if "alembic_version" in inspect(connection).get_table_names():
                    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
                    config.attributes["connection"] = connection
                    command.upgrade(config, "head")
                else:
                    upgrade_chat_storage(Operations(MigrationContext.configure(connection)))
                connection.commit()
            except BaseException:
                connection.rollback()
                raise
    finally:
        engine.dispose()
    print(f"Chat storage upgraded. SQLite backup: {backup.name}. Restart the backend.")


if __name__ == "__main__":
    main()
