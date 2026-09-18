import asyncio
from copy import deepcopy

import pytest
from fastapi import HTTPException

from app.api.dependencies import get_db
from app.api.routes import users
from app.models.user import User, UserProfile
from app.services import map_refresh
from app.services.llm import OllamaBaseClient
from test_auth_and_llm import grant_premium_access


@pytest.fixture
def legacy_map(client):
    client.post("/api/v1/auth/register", json={"email": "refresh@example.com", "username": "refresh", "password": "super-secret"})
    token = client.post("/api/v1/auth/login", json={"email_or_username": "refresh", "password": "super-secret"}).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    grant_premium_access(client, "refresh@example.com")
    client.get("/api/v1/users/me/profile", headers=headers)
    original = {"self_authorship_map": {
        "updated_at": "2026-09-01",
        "topic_spaces": [
            {"id": "old", "title": "My girlfriend and her support", "description": "A long older description. " * 60,
             "chat_ids": ["chat-1"], "journal_dates": ["2026-09-01"], "related_topic_ids": ["healing"],
             "parent_topic_id": "healing", "entries": [{"id": "entry-1", "category": "value", "text": "Honesty matters."}]},
            {"id": "healing", "title": "Healing", "description": "You are recovering.", "category": "experience", "related_topic_ids": ["old"], "entries": []},
        ], "unassigned_entries": [{"id": "overall-1", "category": "evidence", "text": "I rested."}],
    }}
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        db.query(User).filter_by(email="refresh@example.com").one().role = "test"
        profile = db.query(UserProfile).first()
        profile.data = deepcopy(original)
        db.commit()
    finally:
        dependency.close()
    return headers, original


def test_legacy_long_description_can_be_edited_and_saved(client, legacy_map):
    headers, original = legacy_map
    description = original["self_authorship_map"]["topic_spaces"][0]["description"]
    assert len(description) > 1000
    response = client.patch("/api/v1/users/me/map/topics/old", headers=headers,
                            json={"title": "Girlfriend", "category": "person", "description": description})
    assert response.status_code == 200
    saved = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"][0]
    assert saved["description"] == description.strip()
    assert saved["category"] == "person"
    assert saved["entries"][0]["id"] == "entry-1"
    assert saved["related_topic_ids"] == ["healing"]


def test_refresh_preview_apply_and_undo_preserve_map_contents(client, legacy_map, monkeypatch):
    headers, original = legacy_map

    async def proposal(topic):
        assert topic["id"] == "old"
        return {"title": "Girlfriend", "description": "You feel supported by her.", "category": "person"}

    monkeypatch.setattr(users, "suggest_topic_refresh", proposal)
    before = client.get("/api/v1/users/me/map", headers=headers).json()
    preview = client.post("/api/v1/users/me/map/topics/old/refresh-preview", headers=headers)
    assert preview.status_code == 200
    preview = preview.json()
    assert preview["original"]["category"] == "other"
    assert client.get("/api/v1/users/me/map", headers=headers).json() == before
    response = client.post("/api/v1/users/me/map/refresh/apply", headers=headers,
                           json={"revision": preview["revision"], "topics": [preview["suggested"]]})
    assert response.status_code == 200
    refreshed = response.json()
    topic = refreshed["map"]["topic_spaces"][0]
    assert topic["title"] == "Girlfriend"
    assert topic["category"] == "person"
    for field in ("id", "chat_ids", "journal_dates", "related_topic_ids", "parent_topic_id", "entries"):
        assert topic[field] == before["topic_spaces"][0][field]
    assert refreshed["map"]["topic_spaces"][1] == before["topic_spaces"][1]
    assert refreshed["map"]["unassigned_entries"] == before["unassigned_entries"]
    undo = client.post("/api/v1/users/me/map/refresh/apply", headers=headers,
                       json={"revision": refreshed["revision"], "topics": [preview["original"]]})
    assert undo.status_code == 200
    assert undo.json()["map"]["topic_spaces"] == before["topic_spaces"]


def test_refresh_rejects_stale_partial_invalid_and_duplicate_updates(client, legacy_map):
    headers, original = legacy_map
    revision = map_refresh.map_revision(original)
    changed = {"id": "old", "title": "Girlfriend", "description": "Supported.", "category": "person"}
    before = client.get("/api/v1/users/me/map", headers=headers).json()
    for invalid in [dict(changed, id="missing"), dict(changed, title="   "), changed]:
        result = client.post("/api/v1/users/me/map/refresh/apply", headers=headers,
                             json={"revision": revision, "topics": [changed, invalid]})
        assert result.status_code == 400
        assert client.get("/api/v1/users/me/map", headers=headers).json() == before
    client.patch("/api/v1/users/me/map/topics/healing", headers=headers, json={"description": "A newer edit."})
    result = client.post("/api/v1/users/me/map/refresh/apply", headers=headers,
                         json={"revision": revision, "topics": [changed]})
    assert result.status_code == 409
    assert client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"][0]["title"] == before["topic_spaces"][0]["title"]


def test_refresh_auth_and_unknown_topic_do_not_call_ai(client, legacy_map, monkeypatch):
    headers, _ = legacy_map

    async def should_not_run(_):
        pytest.fail("AI must not run for unauthorized or missing topics")

    monkeypatch.setattr(users, "suggest_topic_refresh", should_not_run)
    assert client.post("/api/v1/users/me/map/topics/old/refresh-preview").status_code == 401
    assert client.post("/api/v1/users/me/map/topics/missing/refresh-preview", headers=headers).status_code == 404
    client.post("/api/v1/auth/register", json={"email": "free-refresh@example.com", "username": "free_refresh", "password": "super-secret"})
    token = client.post("/api/v1/auth/login", json={"email_or_username": "free_refresh", "password": "super-secret"}).json()["access_token"]
    free_headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/v1/users/me/map/topics/old/refresh-preview", headers=free_headers).status_code == 402
    grant_premium_access(client, "free-refresh@example.com")
    assert client.post("/api/v1/users/me/map/topics/old/refresh-preview", headers=free_headers).status_code == 403


@pytest.mark.parametrize("bad", [{}, {"title": "", "description": "Note", "category": "person"},
                                {"title": "Dad", "description": "Note", "category": []}])
def test_refresh_rejects_invalid_model_results(monkeypatch, bad):
    model = object.__new__(OllamaBaseClient)

    async def request(**kwargs):
        assert "saved_topic" in kwargs["user_payload"]
        assert "untrusted data" in kwargs["system_prompt"]
        return bad

    model.request_json = request
    monkeypatch.setattr(map_refresh, "get_topic_llm_client", lambda: model)
    with pytest.raises(HTTPException) as error:
        asyncio.run(map_refresh.suggest_topic_refresh({"title": "Dad", "entries": []}))
    assert error.value.status_code == 502


def test_refresh_model_output_only_changes_allowed_fields(monkeypatch):
    model = object.__new__(OllamaBaseClient)

    async def request(**_):
        return {"title": " Dad ", "description": " You feel heard. ", "category": "person",
                "id": "invented", "entries": [], "related_topic_ids": ["invented"]}

    model.request_json = request
    monkeypatch.setattr(map_refresh, "get_topic_llm_client", lambda: model)
    assert asyncio.run(map_refresh.suggest_topic_refresh({"title": "Dad"})) == {
        "title": "Dad", "description": "You feel heard.", "category": "person",
    }
