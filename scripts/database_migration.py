"""Read-only SQLite audit/copy and exact PostgreSQL migration verification.

Run with python -m scripts.database_migration; never against a writable source.
"""

import argparse
import json
import math
import os
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import Boolean, DateTime, Integer, JSON, LargeBinary, String, select, text
from sqlalchemy import UniqueConstraint, create_engine, inspect
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.types import TypeDecorator

from backend.db.base import Base
from backend.db.session import create_database_engine
from backend.models import billing, feedback, mail_message, terms, user  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
TABLES = Base.metadata.sorted_tables


class MigrationValidationError(ValueError):
    """Validation errors identify fields, never disclose stored personal data."""


def fail(location: str, reason: str) -> None:
    raise MigrationValidationError(f"{location}: {reason}")


def utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def reject_json_constant(value: str):
    raise ValueError("Non-finite JSON number")


def column_kind(column):
    return column.type.impl if isinstance(column.type, TypeDecorator) else column.type


def validate_json(value, location: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        fail(location, "non-finite JSON number")
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                fail(location, "JSON object key must be a string")
            validate_json(item, location)
    elif isinstance(value, list):
        for item in value:
            validate_json(item, location)


def source_value(column, value, *, assume_naive_utc: bool):
    location = f"{column.table.name}.{column.name}"
    if value is None:
        if not column.nullable:
            fail(location, "SQL NULL in a required column")
        return None
    kind = column_kind(column)
    if isinstance(kind, Boolean):
        if type(value) is not int or value not in (0, 1):
            fail(location, "Boolean must be exactly 0 or 1")
        return bool(value)
    if isinstance(kind, Integer):
        if type(value) is not int or not -(2**31) <= value < 2**31:
            fail(location, "value is not a PostgreSQL 32-bit integer")
        return value
    if isinstance(kind, DateTime):
        try:
            parsed = datetime.fromisoformat(value)
        except (ValueError, TypeError):
            fail(location, "malformed timestamp")
        if parsed.tzinfo is None and not assume_naive_utc:
            fail(location, "naive timestamp requires explicit --assume-naive-utc")
        return utc_datetime(parsed)
    if isinstance(kind, JSON):
        try:
            parsed = json.loads(value, parse_constant=reject_json_constant)
        except (ValueError, TypeError):
            fail(location, "malformed JSON")
        validate_json(parsed, location)
        return parsed
    if isinstance(kind, String):
        if not isinstance(value, str) or "\x00" in value:
            fail(location, "invalid text or NUL character")
        if kind.length is not None and len(value) > kind.length:
            fail(location, "text exceeds declared column length")
        if column.name in {"entry_date", "usage_date"}:
            try:
                if date.fromisoformat(value).isoformat() != value:
                    fail(location, "calendar date must be YYYY-MM-DD")
            except ValueError:
                fail(location, "malformed calendar date")
        return value
    if isinstance(kind, LargeBinary):
        if not isinstance(value, bytes):
            fail(location, "invalid binary data")
        return value
    fail(location, "unsupported column type")


def validate_constraints(rows: dict) -> None:
    for table in TABLES:
        table_rows = rows[table.name]
        groups = [list(table.primary_key.columns)]
        groups.extend(
            list(constraint.columns)
            for constraint in table.constraints
            if isinstance(constraint, UniqueConstraint)
        )
        groups.extend(list(index.columns) for index in table.indexes if index.unique)
        for columns in groups:
            seen = set()
            for row in table_rows:
                values = tuple(row[column.name] for column in columns)
                if any(value is None for value in values):
                    continue
                if values in seen:
                    fail(table.name, "duplicate primary/unique key")
                seen.add(values)
        for foreign_key in table.foreign_key_constraints:
            elements = list(foreign_key.elements)
            parent = elements[0].column.table.name
            parent_keys = {
                tuple(row[element.column.name] for element in elements) for row in rows[parent]
            }
            for row in table_rows:
                key = tuple(row[element.parent.name] for element in elements)
                if all(value is not None for value in key) and key not in parent_keys:
                    fail(table.name, "broken foreign key")


def validate_embedded_timestamps(value, location: str) -> None:
    if isinstance(value, list):
        for item in value:
            validate_embedded_timestamps(item, location)
    elif isinstance(value, dict):
        for key, item in value.items():
            if key in {"created_at", "updated_at", "analysed_at", "completed_at"} and item:
                try:
                    datetime.fromisoformat(item)
                except (TypeError, ValueError):
                    fail(location, "malformed embedded timestamp")
            elif isinstance(item, (dict, list)):
                validate_embedded_timestamps(item, location)


def validate_map(data: dict) -> None:
    if "self_authorship_map" not in data:
        return
    location = "user_profiles.data.self_authorship_map"
    map_data = data["self_authorship_map"]
    if not isinstance(map_data, dict):
        fail(location, "Map must be an object")
    topics = map_data.get("topic_spaces", [])
    unassigned = map_data.get("unassigned_entries", [])
    if not isinstance(topics, list) or not isinstance(unassigned, list):
        fail(location, "Map collections must be arrays")
    topic_ids = []
    entries = list(unassigned)
    for topic in topics:
        if not isinstance(topic, dict) or not isinstance(topic.get("id"), str):
            fail(location, "missing topic identifier")
        topic_ids.append(topic["id"])
        if not isinstance(topic.get("entries", []), list):
            fail(location, "topic entries must be an array")
        entries.extend(topic.get("entries", []))
    if len(set(topic_ids)) != len(topic_ids):
        fail(location, "duplicate topic identifier")
    parents = {}
    for topic in topics:
        parent = topic.get("parent_topic_id")
        related = topic.get("related_topic_ids", [])
        if not isinstance(related, list) or any(item not in topic_ids for item in related):
            fail(location, "broken related-topic reference")
        if parent is not None and parent not in topic_ids:
            fail(location, "broken parent-topic reference")
        parents[topic["id"]] = parent
    for topic_id in parents:
        visited = set()
        current = topic_id
        while current is not None:
            if current in visited:
                fail(location, "cyclic topic hierarchy")
            visited.add(current)
            current = parents[current]
    entry_ids = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str):
            fail(location, "missing entry identifier")
        entry_ids.append(entry["id"])
    if len(set(entry_ids)) != len(entry_ids):
        fail(location, "duplicate entry identifier")
    validate_embedded_timestamps(map_data, location)


def validate_rows(rows: dict) -> None:
    validate_constraints(rows)
    for row in rows["user_profiles"]:
        if isinstance(row["data"], dict):
            validate_map(row["data"])
    for table, column in (
        ("chat_sessions", "info"),
        ("chat_turns", "user_metadata"),
        ("chat_turns", "response_metadata"),
        ("journal_entries", "analysis"),
    ):
        for row in rows[table]:
            validate_embedded_timestamps(row[column], f"{table}.{column}")


def read_source(path: Path, *, assume_naive_utc: bool = False) -> dict:
    path = path.resolve(strict=True)
    uri = path.as_uri() + "?mode=ro"
    engine = create_engine("sqlite://", creator=lambda: sqlite3.connect(uri, uri=True))
    try:
        with engine.connect() as connection:
            # Explicit BEGIN fixes one read snapshot across all tables, including WAL sources.
            connection.exec_driver_sql("BEGIN")
            table_names = set(inspect(connection).get_table_names()) - {"alembic_version"}
            if table_names != set(Base.metadata.tables):
                fail(
                    "source",
                    "table inventory differs from the current schema; migrate and audit a source copy first",
                )
            rows = {}
            for table in TABLES:
                quoted = connection.dialect.identifier_preparer.quote(table.name)
                result = connection.exec_driver_sql(f"SELECT * FROM {quoted}")
                if set(result.keys()) != set(table.columns.keys()):
                    fail(
                        table.name,
                        "source columns differ from current schema; audit a backup first",
                    )
                rows[table.name] = [
                    {
                        column.name: source_value(
                            column, row[column.name], assume_naive_utc=assume_naive_utc
                        )
                        for column in table.columns
                    }
                    for row in result.mappings()
                ]
            validate_rows(rows)
            return rows
    finally:
        engine.dispose()


def require_target_schema(connection) -> None:
    if connection.dialect.name != "postgresql":
        fail("target", "only PostgreSQL targets are accepted")
    scripts = ScriptDirectory.from_config(Config(str(ROOT / "alembic.ini")))
    migration = MigrationContext.configure(connection, opts={"compare_server_default": True})
    if set(migration.get_current_heads()) != set(scripts.get_heads()):
        fail("target", "run alembic upgrade head first")
    if compare_metadata(migration, Base.metadata):
        fail("target", "schema differs from application metadata")


def read_target(connection) -> dict:
    rows = {
        table.name: [dict(row) for row in connection.execute(select(table)).mappings()]
        for table in TABLES
    }
    validate_rows(rows)
    return rows


def comparable(column, value):
    if value is None:
        return None
    if isinstance(column_kind(column), DateTime):
        return utc_datetime(value).isoformat()
    if isinstance(column.type, JSON):
        return json.dumps(value, ensure_ascii=True, sort_keys=True, allow_nan=False)
    return value


def verify_rows(source: dict, target: dict) -> dict:
    counts = {}
    for table in TABLES:
        pk = [column.name for column in table.primary_key]
        expected = {tuple(row[key] for key in pk): row for row in source[table.name]}
        actual = {tuple(row[key] for key in pk): row for row in target[table.name]}
        if len(target[table.name]) != len(actual):
            fail(table.name, "duplicate destination rows")
        if expected.keys() != actual.keys():
            fail(table.name, "missing/extra rows or changed primary keys")
        for identifier, row in expected.items():
            for column in table.columns:
                if comparable(column, row[column.name]) != comparable(
                    column, actual[identifier][column.name]
                ):
                    fail(f"{table.name}.{column.name}", "destination value differs from source")
        counts[table.name] = {"source": len(expected), "destination": len(actual)}
    return counts


def copy_to_postgres(source: dict, engine) -> dict:
    validate_rows(source)
    if any(
        isinstance(row["data"], dict) and "self_authorship_map" in row["data"]
        for row in source["user_profiles"]
    ):
        fail(
            "source", "run the relational map migration on a backed-up source copy before transfer"
        )
    if any("messages" in (row["info"] or {}) for row in source["chat_sessions"]):
        fail("source", "run the chat storage migration on a backed-up source copy before transfer")
    with engine.begin() as connection:
        require_target_schema(connection)
        names = ", ".join(connection.dialect.identifier_preparer.quote(t.name) for t in TABLES)
        # Empty check, inserts and verification share locks so another writer cannot race the copy.
        connection.exec_driver_sql(f"LOCK TABLE {names} IN ACCESS EXCLUSIVE MODE")
        if any(
            connection.execute(select(*table.primary_key.columns).limit(1)).first()
            for table in TABLES
            if table.name != "map_categories"
        ):
            fail("target", "destination must be empty; no overwrite/merge is supported")
        # Fresh schemas contain only the seeded catalog. Reject modified catalogs
        # rather than silently overwriting operator configuration.
        categories = Base.metadata.tables["map_categories"]
        from migrations.map_schema_v3 import category_rows

        target_categories = [dict(row) for row in connection.execute(select(categories)).mappings()]
        if sorted(target_categories, key=lambda r: (r["kind"], r["key"])) != sorted(
            category_rows(), key=lambda r: (r["kind"], r["key"])
        ):
            fail("map_categories", "destination catalog is not an untouched seed catalog")
        connection.execute(categories.delete())
        for table in TABLES:
            prepared = []
            for row in source[table.name]:
                prepared.append(
                    {
                        column.name: (
                            JSON.NULL
                            if isinstance(column.type, JSON) and row[column.name] is None
                            else row[column.name]
                        )
                        for column in table.columns
                    }
                )
            for start in range(0, len(prepared), 1000):
                connection.execute(table.insert(), prepared[start : start + 1000])
            if (
                len(table.primary_key.columns) != 1
                or "id" not in table.c
                or not isinstance(table.c.id.type, Integer)
            ):
                continue
            sequence = connection.scalar(
                text("SELECT pg_get_serial_sequence(:table_name, 'id')"),
                {"table_name": connection.dialect.identifier_preparer.quote(table.name)},
            )
            if not sequence:
                fail(table.name, "missing primary-key sequence")
            maximum = max((row["id"] for row in source[table.name]), default=0)
            connection.execute(
                text("SELECT setval(CAST(:sequence AS regclass), :value, :is_called)"),
                {"sequence": sequence, "value": max(1, maximum), "is_called": maximum >= 1},
            )
        counts = verify_rows(source, read_target(connection))
    # A second read proves committed durable data, not merely uncommitted inserts.
    with engine.connect() as connection:
        verify_rows(source, read_target(connection))
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["check-source", "copy", "verify"])
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--assume-naive-utc", action="store_true")
    parser.add_argument("--target-url-env", default="DATABASE_URL")
    args = parser.parse_args()
    source = read_source(args.source, assume_naive_utc=args.assume_naive_utc)
    if args.action == "check-source":
        report = {name: {"source": len(rows)} for name, rows in source.items()}
    else:
        url = os.environ.get(args.target_url_env)
        if not url:
            parser.error(f"Set {args.target_url_env}; URLs/credentials are never printed")
        engine = create_database_engine(url)
        try:
            if args.action == "copy":
                report = copy_to_postgres(source, engine)
            else:
                with engine.connect() as connection:
                    require_target_schema(connection)
                    report = verify_rows(source, read_target(connection))
        finally:
            engine.dispose()
    print(json.dumps({"verified": True, "tables": report}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except MigrationValidationError as exc:
        raise SystemExit(str(exc)) from None
    except SQLAlchemyError:
        raise SystemExit(
            "Database operation failed; no source writes were attempted. "
            "Check connectivity, schema and a validated backup; stored values are not logged."
        ) from None
