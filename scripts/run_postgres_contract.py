"""Run the unchanged React contract fixture in a disposable PostgreSQL schema.

Example: python -m scripts.run_postgres_contract --chat
Requires FEELY_TEST_POSTGRES_URL naming a dedicated database ending in _test.
The fixture retains its existing modes, fake transports, ports and HTTP contracts.
"""

import os
import runpy
import sys
from pathlib import Path
from uuid import uuid4

import sqlalchemy
from alembic import command
from alembic.config import Config
from sqlalchemy.schema import CreateSchema, DropSchema


def main() -> None:
    os.environ["SECRET_KEY"] = "isolated-registration-key-never-for-deployment"
    os.environ["ENVIRONMENT"] = "local"
    for name in ("LLM_PROVIDER", "CHAT_LLM_PROVIDER", "TOPIC_LLM_PROVIDER", "JOURNAL_LLM_PROVIDER"):
        os.environ[name] = "mock"
    from app.db.base import Base
    from app.db.session import create_database_engine, database_url

    root = Path(__file__).resolve().parents[1]
    login_fixture = "--login-fixture" in sys.argv
    if login_fixture:
        sys.argv.remove("--login-fixture")
    filename = "isolated-auth-server.py" if login_fixture else "isolated-registration-server.py"
    fixture = root / "frontend-react/scripts" / filename
    url = database_url(os.environ["FEELY_TEST_POSTGRES_URL"])
    if url.get_backend_name() != "postgresql" or not (url.database or "").endswith("_test"):
        raise ValueError("FEELY_TEST_POSTGRES_URL must name a dedicated PostgreSQL _test database")
    schema = f"feely_contract_{uuid4().hex}"
    admin = create_database_engine(url)
    with admin.begin() as connection:
        connection.execute(CreateSchema(schema))
    engine = create_database_engine(
        url, connect_args={"options": f"-c timezone=UTC -c search_path={schema}"}
    )
    original_create = sqlalchemy.create_engine
    original_create_all = Base.metadata.create_all

    def fixture_engine(*args, **kwargs):
        return engine

    def fixture_migrations(*args, **kwargs):
        with engine.begin() as connection:
            config = Config(str(root / "alembic.ini"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")

    # Patch only the fixture's database construction/initialization, not application workflows.
    sqlalchemy.create_engine = fixture_engine
    Base.metadata.create_all = fixture_migrations
    sys.argv[0] = str(fixture)
    try:
        runpy.run_path(str(fixture), run_name="__main__")
    finally:
        sqlalchemy.create_engine = original_create
        Base.metadata.create_all = original_create_all
        engine.dispose()
        with admin.begin() as connection:
            connection.execute(DropSchema(schema, cascade=True))
        admin.dispose()


if __name__ == "__main__":
    main()
