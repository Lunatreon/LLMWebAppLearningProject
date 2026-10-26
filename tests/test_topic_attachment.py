from sqlalchemy import select
from backend.api.routes import llm as llm_routes
from backend.llm.types import (
    ChatLLMResult,
)
from backend.services.self_authorship import create_topic_space

from backend.models.user import ChatSession, User
from tests.test_auth_and_llm import grant_premium_access
from tests.test_email_and_feedback import database


def setup_topic(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "topics@example.com", "username": "topics", "password": "test-password"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email_or_username": "topics", "password": "test-password"}
    ).json()["access_token"]
    headers = {"Authorization": "Bearer " + token}
    grant_premium_access(client, "topics@example.com")
    topic = client.post(
        "/api/v1/users/me/map/topics",
        headers=headers,
        json={
            "title": "Work",
            "description": "Original description",
            "category": "experience",
        },
    ).json()["topic"]
    with database(client) as db:
        user = db.scalar(select(User).where(User.email == "topics@example.com"))
        db.add(
            ChatSession(
                user_id=user.id,
                chat_id="attachment",
                info={
                    "pending_topics": [
                        {"suggestion_id": "first", "status": "pending", "topic": "Work values"},
                        {
                            "suggestion_id": "second",
                            "status": "pending",
                            "topic": "Work boundaries",
                        },
                    ]
                },
            )
        )
        db.commit()
    return headers, topic


def test_new_topic_confirmation_persists_and_returns_destination(client):
    headers, parent = setup_topic(client)
    response = client.post(
        "/api/v1/llm/topics/confirm",
        headers=headers,
        json={
            "chat_id": "attachment",
            "suggestion_id": "first",
            "topic": "Music",
            "description": "I enjoy playing music.",
            "category": "trait",
            "parent_topic_space_id": parent["id"],
            "require_map_access": True,
        },
    )
    assert response.status_code == 200, response.text
    destination = response.json()["saved_topic_space_id"]
    saved = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"]
    topic = next(t for t in saved if t["id"] == destination)
    assert topic["title"] == "Music"
    assert topic["category"] == "trait"
    assert topic["parent_topic_id"] == parent["id"]
    assert topic["chat_ids"] == ["attachment"]


def test_explicit_map_save_without_access_does_not_consume_suggestion(client, monkeypatch):
    headers, _ = setup_topic(client)
    monkeypatch.setattr(llm_routes, "has_premium_feature_access", lambda *args: False)
    response = client.post(
        "/api/v1/llm/topics/confirm",
        headers=headers,
        json={
            "chat_id": "attachment",
            "suggestion_id": "first",
            "topic": "Music",
            "description": "Music matters",
            "require_map_access": True,
        },
    )
    assert response.status_code == 402
    with database(client) as db:
        chat = db.scalar(select(ChatSession).where(ChatSession.chat_id == "attachment"))
        assert len(chat.info["pending_topics"]) == 2


def test_map_edit_during_chat_generation_is_not_overwritten(client, monkeypatch):
    headers, _ = setup_topic(client)

    class EditingClient:
        async def respond(self, **kwargs):
            with database(client) as db:
                user = db.scalar(select(User).where(User.email == "topics@example.com"))
                user.profile.data, _ = create_topic_space(
                    user.profile.data,
                    title="Saved while generating",
                    description="Keep me",
                    category="person",
                )
                db.commit()
            return ChatLLMResult(assistant_message="A reply", profile={})

    monkeypatch.setattr(llm_routes, "get_chat_llm_client", EditingClient)
    response = client.post(
        "/api/v1/llm/message",
        headers=headers,
        json={"chat_id": "attachment", "context": "I am thinking about music."},
    )
    assert response.status_code == 200, response.text
    saved = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"]
    assert any(t["title"] == "Saved while generating" for t in saved)


def test_existing_topic_stores_note_and_consumes_only_selected_suggestion(client):
    headers, topic = setup_topic(client)
    payload = {
        "chat_id": "attachment",
        "topic": "Work values",
        "description": "I value clear expectations.",
        "existing_topic_space_id": topic["id"],
        "suggestion_id": "second",
        "entry_category": "value",
    }
    invalid = client.post(
        "/api/v1/llm/topics/confirm",
        headers=headers,
        json={**payload, "existing_topic_space_id": "missing"},
    )
    assert invalid.status_code == 404
    response = client.post("/api/v1/llm/topics/confirm", headers=headers, json=payload)
    assert response.status_code == 200
    saved = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"][0]
    assert saved["description"] == "Original description"
    assert saved["category"] == "experience"
    assert saved["entries"][0]["text"] == "I value clear expectations."
    assert saved["entries"][0]["category"] == "value"
    assert saved["entries"][0]["source_chat_id"] == "attachment"
    assert (
        client.post("/api/v1/llm/topics/confirm", headers=headers, json=payload).status_code == 409
    )
    with database(client) as db:
        chat = db.scalar(select(ChatSession).where(ChatSession.chat_id == "attachment"))
        assert [item["suggestion_id"] for item in chat.info["pending_topics"]] == ["first"]


def test_same_name_reuse_preserves_description_and_selected_type(client):
    headers, topic = setup_topic(client)
    response = client.post(
        "/api/v1/llm/topics/confirm",
        headers=headers,
        json={
            "chat_id": "attachment",
            "topic": " Work ",
            "description": " New insight ",
            "category": "other",
            "entry_category": "evidence",
            "suggestion_id": "first",
        },
    )
    assert response.status_code == 200
    spaces = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"]
    assert len(spaces) == 1
    assert spaces[0]["category"] == "other"
    assert spaces[0]["description"] == "Original description"
    assert spaces[0]["entries"][0]["text"] == "New insight"
