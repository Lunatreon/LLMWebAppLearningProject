from copy import deepcopy

import pytest

from backend.api.dependencies import get_db
from backend.models.user import User, UserProfile
from test_auth_and_llm import grant_premium_access


def test_map_refresh_endpoints_are_removed(client):
    assert client.post("/api/v1/users/me/map/topics/old/refresh-preview").status_code == 404
    assert client.post("/api/v1/users/me/map/refresh/apply", json={}).status_code == 404


@pytest.fixture
def legacy_map(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "refresh@example.com", "username": "refresh", "password": "super-secret"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email_or_username": "refresh", "password": "super-secret"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    grant_premium_access(client, "refresh@example.com")
    client.get("/api/v1/users/me/profile", headers=headers)
    original = {
        "self_authorship_map": {
            "updated_at": "2026-09-01",
            "topic_spaces": [
                {
                    "id": "old",
                    "title": "My girlfriend and her support",
                    "description": "A long older description. " * 60,
                    "chat_ids": ["chat-1"],
                    "journal_dates": ["2026-09-01"],
                    "related_topic_ids": ["healing"],
                    "parent_topic_id": "healing",
                    "entries": [{"id": "entry-1", "category": "value", "text": "Honesty matters."}],
                },
                {
                    "id": "healing",
                    "title": "Healing",
                    "description": "You are recovering.",
                    "category": "experience",
                    "related_topic_ids": ["old"],
                    "entries": [],
                },
            ],
            "unassigned_entries": [
                {"id": "overall-1", "category": "evidence", "text": "I rested."}
            ],
        }
    }
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
    response = client.patch(
        "/api/v1/users/me/map/topics/old",
        headers=headers,
        json={"title": "Girlfriend", "category": "person", "description": description},
    )
    assert response.status_code == 200
    saved = client.get("/api/v1/users/me/map", headers=headers).json()["topic_spaces"][0]
    assert saved["description"] == description.strip()
    assert saved["category"] == "person"
    assert saved["entries"][0]["id"] == "entry-1"
    assert saved["related_topic_ids"] == ["healing"]
