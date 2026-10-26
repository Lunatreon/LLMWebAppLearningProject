"""Relational ownership, migration, progress, catalog and encryption contracts."""

import base64
import json
from copy import deepcopy

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.core.content_crypto import encrypt, decrypt
from backend.db.session import create_database_engine
from backend.models.user import User, UserProfile
from backend.models.map import TABLES
from backend.services.map_storage import MapConflictError
from backend.services.map_categories import activate
from backend.services.self_authorship import create_topic_space
from tests.test_email_and_feedback import database
from tests.test_admin import configure_and_login_admin


@pytest.fixture
def map_user(client, monkeypatch):
    monkeypatch.setattr(settings, "premium_features_enabled", False)
    assert (
        client.post(
            "/api/v1/auth/register",
            json={"email": "map@example.com", "username": "mapper", "password": "test-password"},
        ).status_code
        == 201
    )
    token = client.post(
        "/api/v1/auth/login", json={"email_or_username": "mapper", "password": "test-password"}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_rows_are_relational_and_encrypted_and_progress_can_move(client, map_user):
    topic = client.post(
        "/api/v1/users/me/map/topics", headers=map_user, json={"title": "Private topic"}
    ).json()["topic"]
    response = client.post(
        "/api/v1/users/me/map/entries",
        headers=map_user,
        json={"category": "task", "text": "Private task text", "completion_percent": 35},
    )
    assert response.status_code == 200
    entry = response.json()["entry"]
    with database(client) as db:
        assert (
            "self_authorship_map"
            not in db.execute(select(UserProfile.__table__.c.data)).scalar_one()
        )
        row = db.execute(select(TABLES["map_entries"])).mappings().one()
        assert row["completion_percent"] == 35 and row["topic_id"] is None
        assert b"Private task text" not in row["text_ciphertext"]
        assert isinstance(row["text_ciphertext"], bytes)
    endpoint = f"/api/v1/users/me/map/entries/{entry['id']}"
    moved = client.patch(
        endpoint, headers=map_user, json={"topic_space_id": topic["id"], "completion_percent": 80}
    )
    assert moved.status_code == 200
    assert moved.json()["map"]["topic_spaces"][0]["entries"][0]["completion_percent"] == 80
    unassigned = client.patch(endpoint, headers=map_user, json={"topic_space_id": None})
    assert unassigned.json()["map"]["unassigned_entries"][0]["text"] == "Private task text"


@pytest.mark.parametrize("value", [-1, 101, 20.5, True, "20"])
def test_completion_rejects_out_of_range_or_noninteger_values(client, map_user, value):
    response = client.post(
        "/api/v1/users/me/map/entries",
        headers=map_user,
        json={"category": "task", "text": "Task", "completion_percent": value},
    )
    assert response.status_code == 422


def test_working_on_persists_and_can_be_cleared_without_changing_progress(client, map_user):
    endpoint = "/api/v1/users/me/map/entries"
    result = client.post(
        endpoint,
        headers=map_user,
        json={
            "category": "task",
            "text": "Read a book",
            "working_on": True,
            "completion_percent": 35,
        },
    )
    assert result.status_code == 200
    entry = result.json()["entry"]
    with database(client) as db:
        assert db.execute(select(TABLES["map_entries"].c.working_on)).scalar_one() is True
    saved = client.get("/api/v1/users/me/map", headers=map_user).json()["unassigned_entries"][0]
    assert saved["working_on"] is True
    cleared = client.patch(
        f"{endpoint}/{entry['id']}", headers=map_user, json={"working_on": False}
    )
    assert cleared.status_code == 200
    assert cleared.json()["entry"]["working_on"] is False
    assert cleared.json()["entry"]["completion_percent"] == 35
    invalid = client.patch(
        f"{endpoint}/{entry['id']}", headers=map_user, json={"working_on": "yes"}
    )
    assert invalid.status_code == 422


def test_practice_completion_matches_status(client, map_user):
    entry = client.post(
        "/api/v1/users/me/map/entries",
        headers=map_user,
        json={"category": "practice", "text": "Go for a walk"},
    ).json()["entry"]
    response = client.patch(
        f"/api/v1/users/me/map/practices/{entry['id']}",
        headers=map_user,
        json={"status": "completed"},
    )
    assert response.json()["practice"]["completion_percent"] == 100
    response = client.patch(
        f"/api/v1/users/me/map/entries/{entry['id']}",
        headers=map_user,
        json={"completion_percent": 45},
    )
    assert response.json()["entry"]["status"] == "active"


def test_admin_catalog_drives_api_and_llm_and_preserves_disabled_categories(
    client, map_user, monkeypatch
):
    admin = configure_and_login_admin(monkeypatch, client)
    payload = {
        "label": "Goal",
        "description": "An intention chosen by the user.",
        "supports_completion": True,
    }
    endpoint = "/api/v1/admin/map/categories/entry/goal"
    assert client.put(endpoint, headers=map_user, json=payload).status_code == 401
    assert client.put(endpoint, headers=admin, json=payload).status_code == 200
    response = client.post(
        "/api/v1/users/me/map/entries",
        headers=map_user,
        json={"category": "goal", "text": "Learn something"},
    )
    assert response.status_code == 200
    entry = response.json()["entry"]
    assert entry["completion_percent"] == 0
    with database(client) as db:
        activate(db.connection())
        from backend.llm.context import topic_request_payload
        from backend.llm.responses import topic_response_schema, map_suggestion_from_payload

        value = json.loads(topic_request_payload({}, [], None))
        assert any(
            c["key"] == "goal" and c["description"] == payload["description"]
            for c in value["allowed_map_categories"]["entry"]
        )
        assert (
            "goal"
            in topic_response_schema()["properties"]["map_suggestion"]["anyOf"][1]["properties"][
                "category"
            ]["enum"]
        )
        assert map_suggestion_from_payload(
            {"category": "goal", "text": "Learn", "reason": "User intention"}
        )
    assert client.put(endpoint, headers=admin, json={**payload, "active": False}).status_code == 200
    assert (
        client.post(
            "/api/v1/users/me/map/entries",
            headers=map_user,
            json={"category": "goal", "text": "New"},
        ).status_code
        == 422
    )
    assert (
        client.patch(
            f"/api/v1/users/me/map/entries/{entry['id']}",
            headers=map_user,
            json={"text": "Keep my old goal"},
        ).status_code
        == 200
    )
    saved = client.get("/api/v1/users/me/map", headers=map_user).json()
    assert saved["unassigned_entries"][0]["category"] == "goal"
    with database(client) as db:
        activate(db.connection())
        assert (
            map_suggestion_from_payload(
                {"category": "goal", "text": "Learn", "reason": "User intention"}
            )
            is None
        )


def test_ciphertext_cannot_be_moved_between_owners_fields_or_rows(monkeypatch):
    value = encrypt("Private", owner=1, row="topic-a", field="title", key_id="primary")
    assert decrypt(value, owner=1, row="topic-a", field="title", key_id="primary") == "Private"
    assert value != encrypt("Private", owner=1, row="topic-a", field="title", key_id="primary")
    for args in [(2, "topic-a", "title"), (1, "topic-b", "title"), (1, "topic-a", "description")]:
        with pytest.raises(RuntimeError, match="integrity"):
            decrypt(value, owner=args[0], row=args[1], field=args[2], key_id="primary")
    with pytest.raises(RuntimeError, match="integrity"):
        decrypt(
            value[:-1] + bytes([value[-1] ^ 1]),
            owner=1,
            row="topic-a",
            field="title",
            key_id="primary",
        )
    monkeypatch.setattr(settings, "content_encryption_keys", {})
    with pytest.raises(RuntimeError, match="CONTENT_ENCRYPTION_KEYS"):
        decrypt(value, owner=1, row="topic-a", field="title", key_id="primary")


def test_stale_concurrent_map_write_rolls_back(database_engine, client, map_user):
    client.post("/api/v1/users/me/map/topics", headers=map_user, json={"title": "Start"})
    with Session(database_engine) as first, Session(database_engine) as second:
        a = first.scalar(select(UserProfile))
        b = second.scalar(select(UserProfile))
        before_a = a.data
        before_b = b.data
        a.data = create_topic_space(before_a, title="First edit")[0]
        first.commit()
        b.data = create_topic_space(before_b, title="Stale edit")[0]
        with pytest.raises(MapConflictError):
            second.commit()
        second.rollback()
    result = client.get("/api/v1/users/me/map", headers=map_user).json()
    assert [t["title"] for t in result["topic_spaces"]] == ["Start", "First edit"]


def test_raw_database_rejects_completion_outside_range_and_cross_owner_links(client, map_user):
    topic = client.post(
        "/api/v1/users/me/map/topics", headers=map_user, json={"title": "Owner topic"}
    ).json()["topic"]
    entry = client.post(
        "/api/v1/users/me/map/entries", headers=map_user, json={"category": "task", "text": "Task"}
    ).json()["entry"]
    with database(client) as db:
        with pytest.raises(IntegrityError):
            db.execute(TABLES["map_entries"].update().values(completion_percent=101))
            db.commit()
        db.rollback()
        with pytest.raises(IntegrityError):
            db.execute(TABLES["map_entries"].update().values(topic_id="missing-topic"))
            db.commit()
        db.rollback()


def test_migration_preserves_map_data_and_encrypts_text(tmp_path):
    engine = create_database_engine(f"sqlite:///{tmp_path/'legacy.db'}")
    config = Config("alembic.ini")
    original = {
        "topic_spaces": [
            {
                "id": "a",
                "title": "Private title",
                "description": "Private description",
                "category": "experience",
                "entries": [
                    {
                        "id": "e",
                        "category": "practice",
                        "text": "Private observation",
                        "status": "paused",
                        "reflection": "Private reflection",
                        "source_chat_id": "deleted-chat",
                        "source_journal_date": "2026-01-01",
                    }
                ],
                "chat_ids": ["deleted-chat"],
                "journal_dates": ["2026-01-01"],
                "related_topic_ids": [],
            }
        ],
        "unassigned_entries": [],
        "updated_at": "2026-01-01T12:00:00Z",
    }
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0002")
        connection.execute(
            User.__table__.insert().values(
                id=1, email="legacy@example.com", username="legacy", hashed_password="hash"
            )
        )
        connection.execute(
            UserProfile.__table__.insert().values(
                id=1, user_id=1, data={"ordinary": "memory", "self_authorship_map": original}
            )
        )
        command.upgrade(config, "head")
        assert connection.execute(select(UserProfile.__table__.c.data)).scalar_one() == {
            "ordinary": "memory"
        }
        encrypted = connection.execute(select(TABLES["map_entries"].c.text_ciphertext)).scalar_one()
        assert b"Private observation" not in encrypted
    with Session(engine) as db:
        restored = db.get(UserProfile, 1).data["self_authorship_map"]
        restored.pop("revision")
        assert restored == original
    engine.dispose()


def test_expected_revision_prevents_stale_client_edit_and_generic_profile_keeps_map(
    client, map_user
):
    first = client.post(
        "/api/v1/users/me/map/topics",
        headers=map_user,
        json={"title": "Current", "expected_revision": 0},
    )
    assert first.status_code == 200
    revision = first.json()["map"]["revision"]
    assert revision == 1
    stale = client.post(
        "/api/v1/users/me/map/topics",
        headers=map_user,
        json={"title": "Stale", "expected_revision": 0},
    )
    assert stale.status_code == 409
    response = client.put(
        "/api/v1/users/me/profile",
        headers=map_user,
        json={
            "data": {
                "ordinary": "memory",
                "self_authorship_map": {"topic_spaces": [], "unassigned_entries": []},
            }
        },
    )
    assert response.status_code == 200
    current = client.get("/api/v1/users/me/map", headers=map_user).json()
    assert current["revision"] == revision and current["topic_spaces"][0]["title"] == "Current"


def test_legacy_sqlite_startup_requires_backed_up_migration(tmp_path, monkeypatch):
    from backend.db import init_db as initialization
    from backend.db.base import Base

    engine = create_database_engine(f"sqlite:///{tmp_path/'legacy-startup.db'}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            User.__table__.insert().values(
                id=1, email="old@example.com", username="old", hashed_password="hash"
            )
        )
        connection.execute(
            UserProfile.__table__.insert().values(
                id=1,
                user_id=1,
                data={"self_authorship_map": {"topic_spaces": [], "unassigned_entries": []}},
            )
        )
    monkeypatch.setattr(initialization, "engine", engine)
    monkeypatch.setattr(settings, "environment", "local")
    with pytest.raises(RuntimeError, match="migrate_chat_storage"):
        initialization.init_db()
    with engine.connect() as connection:
        assert (
            "self_authorship_map"
            in connection.execute(select(UserProfile.__table__.c.data)).scalar_one()
        )
    engine.dispose()


def test_legacy_sqlite_helper_backs_up_and_upgrades_map_and_chat_together(tmp_path, monkeypatch):
    from scripts.migrate_chat_storage import main

    path = tmp_path / "old-unversioned.db"
    engine = create_database_engine(f"sqlite:///{path}")
    config = Config("alembic.ini")
    value = {
        "topic_spaces": [
            {"id": "topic", "title": "Legacy private title", "category": "other", "entries": []}
        ],
        "unassigned_entries": [],
    }
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0001")
        connection.exec_driver_sql("DROP TABLE alembic_version")
        connection.execute(
            User.__table__.insert().values(
                id=1, email="old@example.com", username="old", hashed_password="hash"
            )
        )
        connection.execute(
            UserProfile.__table__.insert().values(
                id=1, user_id=1, data={"self_authorship_map": value}
            )
        )
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{path}")
    main()
    assert list(tmp_path.glob("old-unversioned.db.*.backup"))
    with engine.connect() as connection:
        assert (
            "self_authorship_map"
            not in connection.execute(select(UserProfile.__table__.c.data)).scalar_one()
        )
        assert connection.execute(select(TABLES["map_topics"].c.id)).scalar_one() == "topic"
    engine.dispose()
