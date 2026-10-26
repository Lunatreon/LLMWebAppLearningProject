"""Deployment checks must fail safely without changing application contracts."""

from io import BytesIO
import subprocess
import time

from dotenv import dotenv_values
import pytest

from backend.core.config import Settings, settings
from backend.db.session import database_url
from deployment import entrypoint, healthcheck
from scripts.setup_docker_env import create_environment
from scripts.create_deployment_snapshot import create_snapshot, SNAPSHOT_PASSWORD
from scripts.database_migration import read_source
from backend.core.security import verify_password


def test_docker_environment_generation_is_separate_and_never_overwrites(tmp_path):
    host_config = tmp_path / ".env"
    host_config.write_text('DATABASE_URL="sqlite:///original.db"\nSECRET_KEY="existing"\n')
    target = tmp_path / ".env.docker"
    assert create_environment(target) is True
    values = dotenv_values(target)
    assert len(values["SECRET_KEY"]) >= 32
    assert "__SECRET_KEY__" not in target.read_text()
    assert database_url(values["DATABASE_URL"]).password == values["POSTGRES_PASSWORD"]
    first = target.read_bytes()
    assert create_environment(target) is False
    assert target.read_bytes() == first
    assert (
        host_config.read_text() == 'DATABASE_URL="sqlite:///original.db"\nSECRET_KEY="existing"\n'
    )


def test_snapshot_contains_all_tables_valid_credentials_and_never_overwrites(tmp_path):
    path = tmp_path / "synthetic.db"
    create_snapshot(path)
    before = path.read_bytes()
    rows = read_source(path, assume_naive_utc=True)
    assert len(rows) == 11 and all(len(table) == 1 for table in rows.values())
    assert rows["users"][0]["id"] == 42
    assert verify_password(SNAPSHOT_PASSWORD, rows["users"][0]["hashed_password"])
    assert rows["users"][0]["is_email_verified"] is True
    assert rows["journal_entries"][0]["entry_date"] == "2026-10-13"
    with pytest.raises(FileExistsError):
        create_snapshot(path)
    assert path.read_bytes() == before


def test_docker_settings_allow_mock_startup_and_runtime_openai_injection(tmp_path):
    path = tmp_path / ".env.docker"
    create_environment(path)
    mock = Settings(_env_file=path)
    mock.validate_runtime_security()
    assert mock.llm_provider == "mock"
    assert not mock.openai_api_key
    assert mock.email_delivery_configured
    assert mock.smtp_host == "mailpit" and mock.smtp_port == 1025
    assert not mock.smtp_use_tls and not mock.smtp_use_ssl and not mock.smtp_username
    assert mock.public_app_url == "http://127.0.0.1:5173"
    injected = Settings(
        _env_file=path, llm_provider="openai", openai_api_key="synthetic-runtime-key"
    )
    assert injected.openai_api_key == "synthetic-runtime-key"
    # Constructing settings/startup must not send a provider request or require a real key.
    injected.validate_runtime_security()


def test_database_wait_succeeds_against_selected_database(database_engine, monkeypatch):
    monkeypatch.setattr(
        settings, "database_url", database_engine.url.render_as_string(hide_password=False)
    )
    entrypoint.wait_for_database(timeout_seconds=5, retry_seconds=0.01)


def test_database_wait_times_out_without_disclosing_credentials(monkeypatch):
    monkeypatch.setattr(
        settings, "database_url", "postgresql://probe:private-test-only@127.0.0.1:1/feely_test"
    )
    started = time.monotonic()
    with pytest.raises(RuntimeError, match="readiness timed out") as error:
        entrypoint.wait_for_database(timeout_seconds=0.05, retry_seconds=0.01)
    assert "private-test-only" not in str(error.value)
    assert time.monotonic() - started < 5


def test_unready_database_prevents_migrations_and_server_launch(monkeypatch):
    def unavailable():
        raise RuntimeError("Database is not ready")

    monkeypatch.setattr(entrypoint, "wait_for_database", unavailable)
    monkeypatch.setattr(
        entrypoint.subprocess,
        "run",
        lambda *args, **kwargs: pytest.fail("Migration ran before DB readiness"),
    )
    monkeypatch.setattr(
        entrypoint.os, "execvp", lambda *args: pytest.fail("Server launched before DB readiness")
    )
    with pytest.raises(RuntimeError, match="not ready"):
        entrypoint.main()


def test_migration_failure_prevents_server_launch(monkeypatch):
    monkeypatch.setattr(entrypoint, "wait_for_database", lambda: None)

    def failure(*args, **kwargs):
        raise subprocess.CalledProcessError(1, "alembic upgrade head")

    monkeypatch.setattr(entrypoint.subprocess, "run", failure)
    monkeypatch.setattr(
        entrypoint.os, "execvp", lambda *args: pytest.fail("Server launched after failed migration")
    )
    with pytest.raises(subprocess.CalledProcessError):
        entrypoint.main()


def response(body, status=200):
    stream = BytesIO(body)
    stream.status = status
    return stream


def test_health_requires_http_and_database_readiness(database_engine, monkeypatch):
    monkeypatch.setattr(
        settings, "database_url", database_engine.url.render_as_string(hide_password=False)
    )
    monkeypatch.setattr(
        healthcheck, "urlopen", lambda *args, **kwargs: response(b'{"status":"ok"}')
    )
    healthcheck.check_health()
    monkeypatch.setattr(
        settings, "database_url", "postgresql://probe:private-test-only@127.0.0.1:1/feely_test"
    )
    with pytest.raises(Exception):
        healthcheck.check_health()


@pytest.mark.parametrize(
    "body,status", [(b'{"status":"starting"}', 200), (b'{"status":"ok"}', 503)]
)
def test_health_rejects_unready_http(body, status, monkeypatch):
    monkeypatch.setattr(healthcheck, "urlopen", lambda *args, **kwargs: response(body, status))
    with pytest.raises(RuntimeError, match="Application is not ready"):
        healthcheck.check_health()
