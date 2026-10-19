"""Frozen additive schema/data conversion shared with the unversioned SQLite upgrader.

Do not change this conversion after release; add a new revision instead.
"""

from datetime import datetime, timezone

import sqlalchemy as sa

SESSION_COLUMNS = (
    ("title", sa.String(120), False, "New chat"),
    ("title_source", sa.String(32), False, "automatic"),
    ("initial_topic_title_set", sa.Boolean(), False, "0"),
    ("message_count", sa.Integer(), False, "0"),
    ("next_position", sa.Integer(), False, "0"),
    ("conversation_summary", sa.Text(), True, None),
    ("summary_message_count", sa.Integer(), False, "0"),
    ("analysis_status", sa.String(32), False, "idle"),
    ("analysed_message_count", sa.Integer(), True, None),
    ("analysis_error", sa.Text(), True, None),
)
SCALAR_FIELDS = {name for name, *_ in SESSION_COLUMNS} - {"next_position"}
DERIVED_FIELDS = {
    "messages",
    "user_id",
    "chat_id",
    "created_at",
    "updated_at",
    "last_user_message",
    "last_assistant_message",
    "next_before_position",
}


def parsed_time(value, fallback):
    if isinstance(value, str):
        try:
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return (
                result.replace(tzinfo=timezone.utc)
                if result.tzinfo is None
                else result.astimezone(timezone.utc)
            )
        except ValueError:
            pass
    if isinstance(fallback, str):
        return parsed_time(fallback, datetime.now(timezone.utc))
    return fallback or datetime.now(timezone.utc)


def split_messages(messages, session_id, fallback, total_count=0):
    """Pair adjacent user/assistant messages; preserve unusual legacy records intact."""
    rows = []
    for message in messages:
        if not isinstance(message, dict):
            raise RuntimeError(
                "Legacy chat history contains a non-object message; migration stopped."
            )
        role, content = message.get("role"), message.get("content")
        attach = role == "assistant" and rows and rows[-1]["status"] == "pending"
        if not attach:
            rows.append(
                dict(
                    chat_session_id=session_id,
                    position=len(rows) + 1,
                    user_input=None,
                    llm_response=None,
                    status="legacy",
                    created_at=parsed_time(message.get("created_at"), fallback),
                    responded_at=None,
                    user_timestamp=None,
                    response_timestamp=None,
                    user_metadata={},
                    response_metadata={},
                    reaction=None,
                )
            )
        row = rows[-1]
        extras = {
            key: value
            for key, value in message.items()
            if key not in {"role", "content", "created_at"}
        }
        timestamp = message.get("created_at")
        if (
            role not in {"user", "assistant"}
            or not isinstance(content, str)
            or ("created_at" in message and not isinstance(timestamp, str))
        ):
            extras = {"_original": dict(message)}
        if role == "assistant":
            row.update(
                llm_response=content if isinstance(content, str) else "",
                response_timestamp=timestamp if isinstance(timestamp, str) else None,
                response_metadata=extras,
                responded_at=parsed_time(timestamp, fallback),
                reaction=message.get("reaction"),
            )
            if attach:
                row["status"] = "completed"
        else:
            row.update(
                user_input=content if isinstance(content, str) else "",
                user_timestamp=timestamp if isinstance(timestamp, str) else None,
                user_metadata=extras,
            )
            row["status"] = "pending" if role == "user" else "legacy"
    offset = max(0, total_count - len(rows))
    for row in rows:
        row["position"] += offset
        if row["status"] == "pending":
            row["status"] = "legacy"
    return rows


def message_from_side(content, role, timestamp, extras, reaction=None):
    if content is None:
        return None
    if "_original" in extras:
        result = dict(extras["_original"])
    else:
        result = {"role": role, "content": content, **extras}
        if timestamp is not None:
            result["created_at"] = timestamp
    if role == "assistant" and (reaction is not None or "reaction" in result):
        result["reaction"] = reaction
    return result


def row_messages(row):
    values = []
    for content, role, timestamp, extras in (
        (row["user_input"], "user", row["user_timestamp"], row["user_metadata"]),
        (row["llm_response"], "assistant", row["response_timestamp"], row["response_metadata"]),
    ):
        value = message_from_side(content, role, timestamp, extras, row["reaction"])
        if value is not None:
            values.append(value)
    return values


def upgrade_chat_storage(operations):
    connection = operations.get_bind()
    inspector = sa.inspect(connection)
    names = {column["name"] for column in inspector.get_columns("chat_sessions")}
    for name, kind, nullable, default in SESSION_COLUMNS:
        if name not in names:
            operations.add_column(
                "chat_sessions", sa.Column(name, kind, nullable=nullable, server_default=default)
            )
    if "chat_turns" not in inspector.get_table_names():
        operations.create_table(
            "chat_turns",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "chat_session_id",
                sa.Integer(),
                sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("position", sa.Integer(), nullable=False),
            sa.Column("user_input", sa.Text()),
            sa.Column("llm_response", sa.Text()),
            sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("responded_at", sa.DateTime(timezone=True)),
            sa.Column("user_timestamp", sa.String(64)),
            sa.Column("response_timestamp", sa.String(64)),
            sa.Column("user_metadata", sa.JSON(), nullable=False),
            sa.Column("response_metadata", sa.JSON(), nullable=False),
            sa.Column("reaction", sa.String(16)),
            sa.UniqueConstraint(
                "chat_session_id", "position", name="uq_chat_turns_session_position"
            ),
            sa.CheckConstraint("position > 0", name="ck_chat_turns_positive_position"),
            sa.CheckConstraint(
                "status IN ('pending', 'completed', 'failed', 'legacy')",
                name="ck_chat_turns_status",
            ),
        )
        operations.create_index(
            "ix_chat_turns_session_status_position",
            "chat_turns",
            ["chat_session_id", "status", "position"],
        )
    if "ix_chat_sessions_user_updated_id" not in {
        index["name"] for index in inspector.get_indexes("chat_sessions")
    }:
        operations.create_index(
            "ix_chat_sessions_user_updated_id", "chat_sessions", ["user_id", "updated_at", "id"]
        )
    if "ix_chat_turns_session_created" not in {
        index["name"] for index in sa.inspect(connection).get_indexes("chat_turns")
    }:
        operations.create_index(
            "ix_chat_turns_session_created", "chat_turns", ["chat_session_id", "created_at"]
        )
    metadata = sa.MetaData()
    sessions = sa.Table("chat_sessions", metadata, autoload_with=connection)
    turns = sa.Table("chat_turns", metadata, autoload_with=connection)
    for chat in connection.execute(sa.select(sessions)).mappings():
        info = dict(chat["info"] or {})
        if not (set(info) & (SCALAR_FIELDS | DERIVED_FIELDS)):
            continue
        messages = info.get("messages", [])
        if not isinstance(messages, list):
            raise RuntimeError("Legacy chat messages are not an array; migration stopped.")
        count = int(info.get("message_count", chat["message_count"]) or 0)
        converted = split_messages(messages, chat["id"], chat["created_at"], count)
        existing = list(
            connection.execute(
                sa.select(turns)
                .where(turns.c.chat_session_id == chat["id"])
                .order_by(turns.c.position)
            ).mappings()
        )
        if existing:
            if [m for row in existing for m in row_messages(row)] != messages:
                raise RuntimeError(
                    "Existing turns differ from legacy history; migration stopped without deleting the source."
                )
        elif converted:
            connection.execute(turns.insert(), converted)
        verified = list(
            connection.execute(
                sa.select(turns)
                .where(turns.c.chat_session_id == chat["id"])
                .order_by(turns.c.position)
            ).mappings()
        )
        if [m for row in verified for m in row_messages(row)] != messages:
            raise RuntimeError("Chat history verification failed; source history was not removed.")
        values = {field: info[field] for field in SCALAR_FIELDS if field in info}
        values["message_count"] = max(
            count, sum(message.get("role") == "user" for message in messages)
        )
        values["next_position"] = max(
            [values["message_count"], *[row["position"] for row in verified]]
        )
        values["info"] = {
            key: value for key, value in info.items() if key not in SCALAR_FIELDS | DERIVED_FIELDS
        }
        for field in ("created_at", "updated_at"):
            if field in info:
                values[field] = parsed_time(info[field], chat[field])
        connection.execute(sessions.update().where(sessions.c.id == chat["id"]).values(**values))
