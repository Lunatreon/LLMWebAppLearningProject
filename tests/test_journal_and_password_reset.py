import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import select

from app.api.dependencies import get_db
from app.api.routes import auth as auth_routes
from app.core.config import settings
from app.models.billing import BillingSubscription
from app.models.user import User
from app.services.llm.tasks import journal as llm_service


def register_and_login(client, email: str, username: str):
    assert client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": "original-pass"},
    ).status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": email, "password": "original-pass"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def grant_premium(client, email: str) -> None:
    dependency = client.app.dependency_overrides[get_db]
    session_generator = dependency()
    db = next(session_generator)
    try:
        user = db.scalar(select(User).where(User.email == email))
        db.add(
            BillingSubscription(
                user_id=user.id,
                status="active",
                current_period_end=datetime.now(timezone.utc) + timedelta(days=30),
            )
        )
        db.commit()
    finally:
        session_generator.close()


def test_password_reset_email_changes_password_once(client, monkeypatch):
    sent_tokens = []
    register_and_login(client, "reset@example.com", "reset-user")
    monkeypatch.setattr(settings, "password_reset_enabled", True)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "hello@feel-y.com")
    monkeypatch.setattr(
        auth_routes,
        "send_password_reset_message",
        lambda user, token: sent_tokens.append((user.email, token)),
    )

    requested = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "reset@example.com"},
    )
    assert requested.status_code == 200
    assert requested.json()["sent"] is True
    assert sent_tokens[0][0] == "reset@example.com"

    confirmed = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent_tokens[0][1], "new_password": "replacement-pass"},
    )
    assert confirmed.status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "reset@example.com", "password": "replacement-pass"},
    ).status_code == 200
    assert client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent_tokens[0][1], "new_password": "another-pass"},
    ).status_code == 400


def test_ollama_journal_retries_an_incomplete_json_response(monkeypatch):
    attempts = []

    monkeypatch.setattr(settings, "journal_llm_provider", "ollama")
    monkeypatch.setattr(settings, "ollama_journal_max_tokens", 384)

    async def request_json(client, **_kwargs):
        attempts.append(client.max_tokens)
        if len(attempts) == 1:
            raise HTTPException(status_code=502, detail="LLM returned invalid JSON")
        return {"suggestions": []}

    monkeypatch.setattr(llm_service.OllamaBaseClient, "request_json", request_json)
    result = asyncio.run(
        llm_service.analyse_journal_text(
            "I wrote enough detail here to ask the journal analyser for grounded suggestions.",
            "2026-09-01",
        )
    )

    assert result.suggestions == []
    assert attempts == [384, 768]


def test_daily_journal_is_premium_autosave_ready_and_user_confirmed(client):
    headers = register_and_login(client, "journal@example.com", "journal-user")
    assert client.get("/api/v1/journal/entries/2026-08-31", headers=headers).status_code == 402
    grant_premium(client, "journal@example.com")

    content = (
        "I value calm and honest communication in my relationships. Today I noticed that "
        "writing before reacting gave me enough room to make a choice I actually respect. "
        "I want to practice pausing before my next difficult conversation."
    )
    saved = client.put(
        "/api/v1/journal/entries/2026-08-31",
        headers=headers,
        json={"content": content},
    )
    assert saved.status_code == 200
    assert saved.json()["entry_date"] == "2026-08-31"
    assert saved.json()["word_count"] > 20

    analysis = client.post(
        "/api/v1/journal/entries/2026-08-31/analyse",
        headers=headers,
    )
    assert analysis.status_code == 200
    suggestions = analysis.json()["entry"]["suggestions"]
    assert {suggestion["kind"] for suggestion in suggestions} >= {"topic", "map_entry"}

    topic = next(suggestion for suggestion in suggestions if suggestion["kind"] == "topic")
    saved_topic = client.post(
        f"/api/v1/journal/entries/2026-08-31/suggestions/{topic['id']}",
        headers=headers,
        json={"accepted": True, "topic_category": "experience"},
    )
    assert saved_topic.status_code == 200
    topic_id = saved_topic.json()["suggestion"]["saved_item_id"]
    created_topic = saved_topic.json()["map"]["topic_spaces"][0]
    assert created_topic["journal_dates"] == ["2026-08-31"]
    assert created_topic["category"] == "experience"

    map_entry = next(suggestion for suggestion in suggestions if suggestion["kind"] == "map_entry")
    saved_entry = client.post(
        f"/api/v1/journal/entries/2026-08-31/suggestions/{map_entry['id']}",
        headers=headers,
        json={"accepted": True, "topic_space_id": topic_id},
    )
    assert saved_entry.status_code == 200
    topic_space = saved_entry.json()["map"]["topic_spaces"][0]
    assert topic_space["entries"][0]["source_journal_date"] == "2026-08-31"
    assert topic_space["journal_dates"] == ["2026-08-31"]

    earlier_content = (
        "I returned to the same relationship theme today and noticed how much calmer I feel "
        "when I pause before answering. I want this journal page connected to the topic I "
        "already created instead of making a duplicate topic for the same part of my life."
    )
    assert client.put(
        "/api/v1/journal/entries/2026-08-30",
        headers=headers,
        json={"content": earlier_content},
    ).status_code == 200
    earlier_analysis = client.post(
        "/api/v1/journal/entries/2026-08-30/analyse",
        headers=headers,
    )
    earlier_topic = next(
        suggestion
        for suggestion in earlier_analysis.json()["entry"]["suggestions"]
        if suggestion["kind"] == "topic"
    )
    linked_topic = client.post(
        f"/api/v1/journal/entries/2026-08-30/suggestions/{earlier_topic['id']}",
        headers=headers,
        json={"accepted": True, "topic_space_id": topic_id},
    )
    assert linked_topic.status_code == 200
    linked_map = linked_topic.json()["map"]
    assert len(linked_map["topic_spaces"]) == 1
    assert linked_map["topic_spaces"][0]["journal_dates"] == [
        "2026-08-31",
        "2026-08-30",
    ]

    history = client.get("/api/v1/journal/entries", headers=headers)
    assert history.status_code == 200
    assert history.json()[0]["entry_date"] == "2026-08-31"

    new_day = client.get("/api/v1/journal/entries/2026-09-01", headers=headers)
    assert new_day.status_code == 200
    assert new_day.json()["content"] == ""
