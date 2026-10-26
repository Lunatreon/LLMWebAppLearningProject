"""Read-only database probes and disposable permission probes, streamed into CI containers."""

import hashlib
import json
import os
from pathlib import Path
import smtplib
import sys
import tempfile

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, Table, inspect, select

from backend.core.config import settings
from backend.db.session import engine

from backend.db.base import Base
from backend import models  # Register every table for schema inventory checks.

TABLES = set(Base.metadata.tables)


def database_snapshot():
    """Compare all stored columns across restart without exporting user data."""
    with engine.connect() as connection:
        tables = set(inspect(connection).get_table_names(schema="public"))
        assert tables == TABLES | {"alembic_version"}, "Unexpected database tables"
        heads = set(ScriptDirectory.from_config(Config("alembic.ini")).get_heads())
        current = set(MigrationContext.configure(connection).get_current_heads())
        assert current == heads and heads, "Alembic current does not match heads"
        counts = {}
        digests = {}
        for name in sorted(TABLES):
            table = Table(name, MetaData(), autoload_with=connection)
            rows = [dict(row) for row in connection.execute(select(table)).mappings()]
            serialized = sorted(json.dumps(row, sort_keys=True, default=str) for row in rows)
            counts[name] = len(rows)
            digests[name] = hashlib.sha256("\n".join(serialized).encode()).hexdigest()
        return {"heads": sorted(heads), "counts": counts, "digests": digests}


def check_runtime():
    assert os.getuid() == os.geteuid() == 10001, "Backend must use UID 10001"
    assert os.getgid() == 10001, "Unexpected backend GID"
    status = Path("/proc/self/status").read_text()
    assert "NoNewPrivs:\t1" in status, "no-new-privileges missing"
    assert "CapEff:\t0000000000000000" in status, "Effective capabilities present"
    assert not os.access("/app/backend", os.W_OK), "Application directory is writable"
    assert not os.access("/app", os.W_OK), "Application root is writable"
    # Probe only files owned by this check, preserving all administrator prompt edits.
    for directory in ("/app/prompts", "/tmp"):
        with tempfile.NamedTemporaryFile(prefix="feely-ci-", dir=directory) as probe:
            probe.write(b"permission probe")
            probe.flush()
            assert Path(probe.name).read_bytes() == b"permission probe"
    prompt_stat = Path("/app/prompts").stat()
    assert prompt_stat.st_uid == 10001 and not prompt_stat.st_mode & 0o002
    assert engine.dialect.name == "postgresql" and engine.url.host == "postgres"
    assert settings.smtp_host == "mailpit" and settings.smtp_port == 1025
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=5) as smtp:
        assert smtp.ehlo()[0] == 250, "Mailpit SMTP EHLO failed"
    assert settings.llm_provider == "mock"
    assert not settings.openai_api_key and not settings.anthropic_api_key
    assert not settings.smtp_password
    assert all(
        not provider or provider == "mock"
        for provider in (
            settings.chat_llm_provider,
            settings.topic_llm_provider,
        )
    )
    assert not Path("/app/.env").exists(), "Host environment was baked into image"
    assert not Path("/app/feely.db").exists(), "SQLite reference was baked into image"
    # SELECTs use the configured authenticated PostgreSQL connection, not pg_isready.
    snapshot = database_snapshot()
    return {"uid": os.geteuid(), "heads": snapshot["heads"]}


if __name__ == "__main__":
    try:
        result = check_runtime() if sys.argv[1] == "runtime" else database_snapshot()
        print(json.dumps(result, sort_keys=True))
    finally:
        engine.dispose()
