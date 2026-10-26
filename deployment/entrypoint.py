"""Wait for the database, apply Alembic once, then replace this process with Uvicorn."""

import os
import subprocess
import sys
import time

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from backend.core.config import settings
from backend.db.session import create_database_engine, database_url


def wait_for_database(timeout_seconds: float = 60, retry_seconds: float = 2) -> None:
    url = database_url(settings.database_url)
    connect_args = (
        {"connect_timeout": 3, "options": "-c statement_timeout=3000"}
        if url.get_backend_name() == "postgresql"
        else {}
    )
    engine = create_database_engine(url, connect_args=connect_args)
    deadline = time.monotonic() + timeout_seconds
    try:
        while True:
            try:
                with engine.connect() as connection:
                    connection.execute(text("SELECT 1"))
                    if not settings.is_local_environment:
                        privileges = connection.execute(
                            text(
                                "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
                                "FROM pg_roles WHERE rolname = current_user"
                            )
                        ).one()
                        if any(privileges):
                            raise RuntimeError(
                                "The production application role must not have PostgreSQL administrative privileges."
                            )
                return
            except SQLAlchemyError:
                if time.monotonic() >= deadline:
                    raise RuntimeError(
                        "Database readiness timed out; check the service and credentials."
                    ) from None
                time.sleep(min(retry_seconds, max(0, deadline - time.monotonic())))
    finally:
        engine.dispose()


def main() -> None:
    settings.validate_runtime_security()
    wait_for_database()
    print("Database ready; applying Alembic migrations.", flush=True)
    # One backend process per local container. Migrations never run per request/worker.
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)
    # The minimal Alembic config has no global logging setup. Show the resulting
    # revision explicitly without enabling SQL/parameter logging in migrations/tests.
    subprocess.run([sys.executable, "-m", "alembic", "current"], check=True)
    if len(sys.argv) < 2:
        raise RuntimeError("Container entrypoint needs a command to execute.")
    print("Schema migrated; starting backend command.", flush=True)
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        # Validation/readiness errors contain field names, never configured secret values.
        print(f"Backend startup refused: {error}", file=sys.stderr)
        raise SystemExit(1) from None
    except subprocess.CalledProcessError:
        print(
            "Backend startup failed. Check database readiness, Alembic and runtime configuration.",
            file=sys.stderr,
        )
        raise SystemExit(1) from None
