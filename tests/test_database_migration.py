"""Migration safety tests use synthetic SQLite data and disposable PG schemas."""

from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.db import init_db as initialization
from backend.db.base import Base
from backend.db.session import create_database_engine, database_url
from backend.db.types import LegacyDateTime
from backend.models.user import User
from backend.schemas.user import UserRead
from scripts.database_migration import (
    MigrationValidationError,
    copy_to_postgres,
    read_source,
    read_target,
    require_target_schema,
    verify_rows,
)

AT = datetime(2026, 3, 28, 23, 30, tzinfo=timezone.utc)


@pytest.fixture
def migration_source(tmp_path):
    path = tmp_path / "source.db"
    engine = create_database_engine(f"sqlite:///{path}")
    Base.metadata.create_all(engine)
    payloads = {
        "users": [
            {
                "id": 42,
                "email": "migration@example.com",
                "username": "migration",
                "hashed_password": "synthetic-hash",
                "role": "test",
                "bio": None,
                "last_login_at": AT,
            },
            {
                "id": 84,
                "email": "second@example.com",
                "username": "second",
                "hashed_password": "another-synthetic-hash",
            },
        ],
        "user_profiles": [
            {
                "id": 51,
                "user_id": 42,
                "data": {
                    "capabilities": {"journal": True, "map": True},
                    "custom": [None, False, 0, "Grüße"],
                    "self_authorship_map": {
                        "topic_spaces": [
                            {
                                "id": "topic-parent",
                                "parent_topic_id": None,
                                "related_topic_ids": ["topic-child"],
                                "chat_ids": ["chat-preserved"],
                                "journal_dates": ["2026-03-29"],
                                "entries": [],
                            },
                            {
                                "id": "topic-child",
                                "parent_topic_id": "topic-parent",
                                "related_topic_ids": ["topic-parent"],
                                "entries": [
                                    {
                                        "id": "practice-id",
                                        "category": "practice",
                                        "practice_status": "completed",
                                        "reflection": "I took a walk.",
                                        "source_chat_id": "chat-preserved",
                                        "source_journal_date": "2026-03-29",
                                    }
                                ],
                            },
                        ],
                        "unassigned_entries": [],
                    },
                },
            }
        ],
        "chat_sessions": [
            {
                "id": 73,
                "user_id": 42,
                "chat_id": "chat-preserved",
                "info": {
                    "messages": [
                        {"role": "user", "content": "Hello", "created_at": AT.isoformat()},
                        {"role": "assistant", "content": "Hi", "created_at": AT.isoformat()},
                    ],
                    "message_count": 1,
                    "topic_space_ids": ["topic-child"],
                },
            }
        ],
        "daily_llm_usage": [
            {"id": 75, "user_id": 42, "usage_date": "2026-03-28", "message_count": 1}
        ],
        "journal_entries": [
            {
                "id": 85,
                "user_id": 42,
                "entry_date": "2026-03-29",
                "content": "A local calendar day across the DST boundary.",
                "analysis": {"suggestions": [], "analysed_at": AT.isoformat()},
            }
        ],
        "billing_subscriptions": [
            {
                "id": 99,
                "user_id": 42,
                "status": "active",
                "current_period_end": AT,
                "stripe_customer_id": None,
                "stripe_subscription_id": None,
            }
        ],
        "processed_stripe_events": [
            {"id": 100, "stripe_event_id": "evt_synthetic", "event_type": "invoice.paid"}
        ],
        "feedback": [{"id": 56, "user_id": 42, "category": "idea", "message": "Synthetic"}],
        "terms_acceptances": [
            {
                "id": 92,
                "user_id": 42,
                "version": "preserved-v1",
                "document_url": "https://example.com/terms.pdf",
                "document_sha256": "a" * 64,
                "client": "web",
            }
        ],
        "mail_messages": [
            {
                "id": 101,
                "delivery_key": "mail/synthetic",
                "folder": "inbox",
                "sender": "sender@example.com",
                "recipient": "receiver@example.com",
                "subject": "Synthetic",
                "body": "Hello",
                "raw": b"From: sender@example.com\r\n\r\nHello\x00\xff",
                "is_read": False,
            }
        ],
    }
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            rows = payloads.get(table.name, [])
            for row in rows:
                for column in table.columns:
                    if isinstance(column.type, LegacyDateTime) and not column.nullable:
                        row[column.name] = AT
                connection.execute(table.insert(), row)
    engine.dispose()
    return path


def test_database_url_keeps_credentials_and_selects_psycopg():
    url = database_url("postgresql://example:p%40ss%25@localhost:55432/feely_dev")
    assert url.drivername == "postgresql+psycopg"
    assert url.password == "p@ss%"
    assert database_url("postgres://localhost/example").drivername == "postgresql+psycopg"
    assert database_url("postgresql+psycopg://localhost/example").drivername == "postgresql+psycopg"
    assert database_url("sqlite:///example.db").drivername == "sqlite"


def test_initial_revision_matches_metadata_on_sqlite(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'migrated.db'}")
    try:
        with engine.begin() as connection:
            config = Config("alembic.ini")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
            assert len(inspect(connection).get_table_names()) == 12  # Eleven domain tables plus Alembic's version.
    finally:
        engine.dispose()


def test_nonlocal_startup_refuses_unmigrated_schema(tmp_path, monkeypatch):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    monkeypatch.setattr(initialization, "engine", engine)
    monkeypatch.setattr(settings, "environment", "production")
    try:
        with pytest.raises(RuntimeError, match="alembic upgrade head"):
            initialization.init_db()
        assert inspect(engine).get_table_names() == []
    finally:
        engine.dispose()


def test_exact_legacy_timestamp_response_format(database_engine):
    with Session(database_engine) as db:
        row = User(
            email="timestamp@example.com",
            username="timestamp",
            hashed_password="synthetic",
            created_at=AT,
            updated_at=AT,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        assert UserRead.model_validate(row).model_dump(mode="json")["created_at"] == (
            "2026-03-28T23:30:00"
        )
        if database_engine.dialect.name == "postgresql":
            assert db.scalar(text("SELECT created_at::text FROM users")) == "2026-03-28 23:30:00+00"


def test_source_is_read_only_and_requires_timestamp_acknowledgement(migration_source):
    before = sha256(migration_source.read_bytes()).digest()
    with pytest.raises(MigrationValidationError, match="assume-naive-utc"):
        read_source(migration_source)
    rows = read_source(migration_source, assume_naive_utc=True)
    assert set(rows) == set(Base.metadata.tables)
    assert rows["journal_entries"][0]["entry_date"] == "2026-03-29"
    assert rows["mail_messages"][0]["raw"].endswith(b"\x00\xff")
    assert sha256(migration_source.read_bytes()).digest() == before


@pytest.mark.parametrize(
    "statement,error",
    [
        ("UPDATE users SET is_active=2 WHERE id=42", "Boolean"),
        ("UPDATE users SET created_at='bad' WHERE id=42", "malformed timestamp"),
        ("UPDATE users SET username='" + "x" * 81 + "' WHERE id=42", "column length"),
        ("UPDATE journal_entries SET user_id=999", "foreign key"),
        ("UPDATE journal_entries SET entry_date='2026-02-30'", "calendar date"),
        ("UPDATE user_profiles SET data='{broken'", "malformed JSON"),
        ("UPDATE user_profiles SET data='{\"number\": NaN}'", "malformed JSON"),
    ],
)
def test_source_validation_rejects_sqlite_permissiveness(migration_source, statement, error):
    engine = create_database_engine(f"sqlite:///{migration_source}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(statement)
    finally:
        engine.dispose()
    with pytest.raises(MigrationValidationError, match=error):
        read_source(migration_source, assume_naive_utc=True)


@pytest.mark.parametrize(
    "change",
    [
        "missing_user",
        "duplicate_user",
        "changed_id",
        "changed_null",
        "changed_timestamp",
        "terms_hash",
        "terms_version",
        "capabilities",
        "journal",
        "map_entry",
        "map_relationship",
        "chat_history",
    ],
)
def test_verifier_detects_lost_or_changed_data(migration_source, change):
    source = read_source(migration_source, assume_naive_utc=True)
    target = deepcopy(source)
    profile = target["user_profiles"][0]["data"]
    if change == "missing_user":
        target["users"].pop()
    elif change == "duplicate_user":
        target["users"].append(deepcopy(target["users"][0]))
    elif change == "changed_id":
        target["users"][0]["id"] = 900
    elif change == "changed_null":
        target["users"][0]["bio"] = ""
    elif change == "changed_timestamp":
        target["users"][0]["created_at"] = datetime(2025, 1, 1, tzinfo=timezone.utc)
    elif change == "terms_hash":
        target["terms_acceptances"][0]["document_sha256"] = "b" * 64
    elif change == "terms_version":
        target["terms_acceptances"][0]["version"] = "different"
    elif change == "capabilities":
        profile.pop("capabilities")
    elif change == "journal":
        target["journal_entries"].clear()
    elif change == "map_entry":
        profile["self_authorship_map"]["topic_spaces"][1]["entries"].clear()
    elif change == "map_relationship":
        profile["self_authorship_map"]["topic_spaces"][1]["parent_topic_id"] = None
    elif change == "chat_history":
        target["chat_sessions"][0]["info"]["messages"].pop()
    with pytest.raises(MigrationValidationError):
        verify_rows(source, target)


@pytest.mark.parametrize("attempt", [1, 2])
def test_postgres_copy_round_trip_counts_values_and_sequences(
    migration_source, database_engine, attempt
):
    if database_engine.dialect.name != "postgresql":
        pytest.skip("Requires FEELY_TEST_POSTGRES_URL and a fresh migrated PostgreSQL schema")
    before = sha256(migration_source.read_bytes()).digest()
    source = read_source(migration_source, assume_naive_utc=True)
    counts = copy_to_postgres(source, database_engine)
    assert all(row["source"] == row["destination"] for row in counts.values())
    assert sum(row["source"] for row in counts.values()) == 11
    with database_engine.connect() as connection:
        require_target_schema(connection)
        verify_rows(source, read_target(connection))
        for table in Base.metadata.sorted_tables:
            value = connection.scalar(
                text("SELECT nextval(pg_get_serial_sequence(:table_name, 'id'))"),
                {"table_name": table.name},
            )
            assert value > max(row["id"] for row in source[table.name])
    with pytest.raises(MigrationValidationError, match="empty"):
        copy_to_postgres(source, database_engine)
    assert sha256(migration_source.read_bytes()).digest() == before


def test_postgres_failed_verification_rolls_back_all_inserts(
    migration_source, database_engine, monkeypatch
):
    if database_engine.dialect.name != "postgresql":
        pytest.skip("Requires FEELY_TEST_POSTGRES_URL and a fresh migrated PostgreSQL schema")
    from scripts import database_migration

    source = read_source(migration_source, assume_naive_utc=True)
    actual_reader = database_migration.read_target

    def corrupted_reader(connection):
        rows = actual_reader(connection)
        rows["terms_acceptances"][0]["document_sha256"] = "b" * 64
        return rows

    monkeypatch.setattr(database_migration, "read_target", corrupted_reader)
    with pytest.raises(MigrationValidationError, match="destination value"):
        copy_to_postgres(source, database_engine)
    with database_engine.connect() as connection:
        assert all(not connection.execute(select(t)).first() for t in Base.metadata.sorted_tables)


def test_source_rejects_broken_embedded_map_relationship(migration_source):
    import json

    source = read_source(migration_source, assume_naive_utc=True)
    data = source["user_profiles"][0]["data"]
    data["self_authorship_map"]["topic_spaces"][1]["parent_topic_id"] = "missing-topic"
    engine = create_database_engine(f"sqlite:///{migration_source}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("UPDATE user_profiles SET data=?", (json.dumps(data),))
    finally:
        engine.dispose()
    with pytest.raises(MigrationValidationError, match="parent-topic reference"):
        read_source(migration_source, assume_naive_utc=True)


def test_postgres_copy_preserves_json_null(migration_source, database_engine):
    if database_engine.dialect.name != "postgresql":
        pytest.skip("Requires FEELY_TEST_POSTGRES_URL and a fresh migrated PostgreSQL schema")
    source_engine = create_database_engine(f"sqlite:///{migration_source}")
    try:
        with source_engine.begin() as connection:
            connection.exec_driver_sql("UPDATE user_profiles SET data='null'")
    finally:
        source_engine.dispose()
    source = read_source(migration_source, assume_naive_utc=True)
    copy_to_postgres(source, database_engine)
    with database_engine.connect() as connection:
        row = connection.execute(text("SELECT data IS NULL, data::text FROM user_profiles")).one()
        assert row == (False, "null")
