"""Persistence, bounded reads and lossless conversion of existing chat history."""

from datetime import datetime, timezone

import pytest
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.autogenerate import compare_metadata
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session

from backend.api.dependencies import get_db
from backend.core.config import settings
from backend.db.base import Base
from backend.db.session import create_database_engine
from backend.models.user import ChatSession, ChatTurn, User
from backend.services.chat_storage import chat_context


def auth(client):
    payload = {
        "email": "turns@example.com",
        "username": "turns",
        "password": "testing-password-123",
    }
    assert client.post("/api/v1/auth/register", json=payload).status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": payload["email"], "password": payload["password"]},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_exchange_has_columns_and_no_history_json(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    headers = auth(client)
    result = client.post(
        "/api/v1/llm/message",
        headers=headers,
        json={"chat_id": "one", "context": "I feel tired today"},
    )
    assert result.status_code == 200, result.text
    with next(client.app.dependency_overrides[get_db]()) as db:
        chat = db.scalar(select(ChatSession).where(ChatSession.chat_id == "one"))
        turn = db.scalar(select(ChatTurn).where(ChatTurn.chat_session_id == chat.id))
        assert chat.title != "New chat"
        assert chat.message_count == 1
        assert not {"messages", "title", "message_count", "conversation_summary"} & chat.info.keys()
        assert (turn.position, turn.user_input, turn.status) == (
            1,
            "I feel tired today",
            "completed",
        )
        assert turn.llm_response == result.json()["assistant_message"]
    page = client.get("/api/v1/llm/chats?paginated=true", headers=headers).json()
    assert page["items"][0]["messages"] == []
    assert page["items"][0]["title"]


def test_history_pagination_preserves_more_than_eighty_messages(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    headers = auth(client)
    messages = [
        {"role": role, "content": f"{role}-{i}", "created_at": f"2026-01-01T00:{i:02d}:00+00:00"}
        for i in range(55)
        for role in ("user", "assistant")
    ]
    with next(client.app.dependency_overrides[get_db]()) as db:
        user = db.scalar(select(User).where(User.email == "turns@example.com"))
        chat = ChatSession(
            user_id=user.id,
            chat_id="long",
            info={"title": "Long chat", "message_count": 55, "messages": messages},
        )
        db.add(chat)
        db.commit()
    first = client.get("/api/v1/llm/chats/long", headers=headers).json()
    assert len(first["messages"]) == 50
    assert first["messages"][0]["content"] == "user-30"
    second = client.get(
        f"/api/v1/llm/chats/long?before_position={first['next_before_position']}", headers=headers
    ).json()
    third = client.get(
        f"/api/v1/llm/chats/long?before_position={second['next_before_position']}", headers=headers
    ).json()
    combined = third["messages"] + second["messages"] + first["messages"]
    assert [m["content"] for m in combined] == [m["content"] for m in messages]
    assert third["next_before_position"] is None
    # Reactions address an older durable reply without loading/replacing its history.
    old_reply = third["messages"][1]
    assert (
        client.put(
            "/api/v1/llm/chats/long/reaction",
            headers=headers,
            json={
                "created_at": old_reply["created_at"],
                "turn_id": old_reply["turn_id"],
                "reaction": "like",
            },
        ).status_code
        == 200
    )
    assert (
        client.get("/api/v1/llm/chats/long?before_position=6", headers=headers).json()["messages"][
            1
        ]["reaction"]
        == "like"
    )

    result = client.post(
        "/api/v1/llm/message",
        headers=headers,
        json={"chat_id": "long", "context": "One more exchange"},
    )
    assert result.status_code == 200, result.text
    assert result.json()["chat_info"]["next_before_position"] is not None
    with next(client.app.dependency_overrides[get_db]()) as db:
        from sqlalchemy import func

        assert db.scalar(select(func.count(ChatTurn.id))) == 56
        assert db.scalar(select(ChatTurn).order_by(ChatTurn.position)).user_input == "user-0"


def test_failed_model_request_retains_input_without_counting_a_reply(client, monkeypatch):
    from backend.api.routes import llm

    class Broken:
        async def respond(self, **kwargs):
            raise RuntimeError("upstream failed")

    monkeypatch.setattr(llm, "get_chat_llm_client", lambda: Broken())
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    headers = auth(client)
    with pytest.raises(RuntimeError, match="upstream failed"):
        client.post(
            "/api/v1/llm/message",
            headers=headers,
            json={"chat_id": "failed", "context": "Keep this input"},
        )
    with next(client.app.dependency_overrides[get_db]()) as db:
        turn = db.scalar(select(ChatTurn))
        assert (turn.user_input, turn.llm_response, turn.status) == (
            "Keep this input",
            None,
            "failed",
        )
        assert db.get(ChatSession, turn.chat_session_id).message_count == 0


def test_alembic_backfills_legacy_history_and_matches_models(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    messages = [
        {"role": "user", "content": "hello", "created_at": "2026-01-01T00:00:00Z"},
        {
            "role": "assistant",
            "content": "reply",
            "created_at": "2026-01-01T00:00:01Z",
            "reaction": "like",
        },
        {"role": "user", "content": "unanswered"},
    ]
    config = Config("alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        import sqlalchemy as sa

        metadata = sa.MetaData()
        users = sa.Table("users", metadata, autoload_with=connection)
        chats = sa.Table("chat_sessions", metadata, autoload_with=connection)
        connection.execute(
            users.insert().values(
                id=1,
                email="old@example.com",
                username="old",
                hashed_password="x",
                auth_provider="password",
                is_email_verified=False,
                is_active=True,
                created_at=at,
                updated_at=at,
            )
        )
        connection.execute(
            chats.insert().values(
                id=1,
                user_id=1,
                chat_id="old",
                created_at=at,
                updated_at=at,
                info={
                    "title": "Original title",
                    "message_count": 100,
                    "messages": messages,
                    "pending_topics": [{"topic": "Work"}],
                },
            )
        )
        command.upgrade(config, "head")
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    with Session(engine) as db:
        chat = db.get(ChatSession, 1)
        assert chat.title == "Original title"
        assert chat.message_count == 100
        assert chat.info == {"pending_topics": [{"topic": "Work"}]}
        restored = chat_context(db, chat)["messages"]
        assert [
            {k: v for k, v in m.items() if k not in {"turn_id", "position"}} for m in restored
        ] == messages
        assert db.scalars(select(ChatTurn).order_by(ChatTurn.position)).first().position == 99
    engine.dispose()


def test_cursor_pages_have_no_duplicates_and_do_not_include_another_user(client):
    headers = auth(client)
    at = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with next(client.app.dependency_overrides[get_db]()) as db:
        user = db.scalar(select(User).where(User.email == "turns@example.com"))
        other = User(email="other@example.com", username="other", hashed_password="unused")
        db.add(other)
        db.flush()
        db.add_all(
            [
                ChatSession(user_id=user.id, chat_id=f"c{i}", title=f"Title {i}", updated_at=at)
                for i in range(65)
            ]
        )
        db.add(ChatSession(user_id=other.id, chat_id="private", updated_at=at))
        db.commit()
    cursor = None
    ids = []
    while True:
        page = client.get(
            "/api/v1/llm/chats",
            headers=headers,
            params={"paginated": "true", "limit": 10, **({"cursor": cursor} if cursor else {})},
        ).json()
        assert len(page["items"]) <= 10
        assert all(not chat["messages"] for chat in page["items"])
        ids.extend(chat["chat_id"] for chat in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(ids) == len(set(ids)) == 65
    assert "private" not in ids
    assert client.get("/api/v1/llm/chats?cursor=invalid", headers=headers).status_code == 422


def test_unversioned_sqlite_upgrade_is_idempotent_and_preserves_history(tmp_path):
    import sqlalchemy as sa
    from alembic.operations import Operations
    from migrations.chat_storage_v2 import upgrade_chat_storage

    engine = create_database_engine(f"sqlite:///{tmp_path / 'old.db'}")
    config = Config("alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        # Simulate a native database that predates Alembic version tracking.
        connection.exec_driver_sql("DROP TABLE alembic_version")
        upgrade_chat_storage(Operations(MigrationContext.configure(connection)))
        upgrade_chat_storage(Operations(MigrationContext.configure(connection)))
        assert "alembic_version" not in inspect(connection).get_table_names()
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    engine.dispose()


def test_native_upgrade_helper_creates_an_old_schema_backup(tmp_path, monkeypatch):
    from scripts.migrate_chat_storage import main

    path = tmp_path / "native.db"
    url = f"sqlite:///{path}"
    engine = create_database_engine(url)
    config = Config("alembic.ini")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        connection.exec_driver_sql("DROP TABLE alembic_version")
    engine.dispose()
    monkeypatch.setattr(settings, "database_url", url)
    main()
    backups = list(tmp_path.glob("*.backup"))
    assert len(backups) == 1
    old = create_database_engine(f"sqlite:///{backups[0]}")
    current = create_database_engine(url)
    try:
        assert "chat_turns" not in inspect(old).get_table_names()
        assert "chat_turns" in inspect(current).get_table_names()
        assert "alembic_version" not in inspect(current).get_table_names()
    finally:
        old.dispose()
        current.dispose()
