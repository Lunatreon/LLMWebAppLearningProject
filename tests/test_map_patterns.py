"""Goals and possible patterns survive review without becoming unconfirmed map facts."""

import pytest
from sqlalchemy import select

from backend.api.routes import llm as llm_routes
from backend.llm.context import select_topic_context, bounded_topic_map
from backend.llm.responses import map_suggestion_from_payload
from backend.llm.types import TopicLLMResult
from backend.models.map import TABLES
from tests.test_auth_and_llm import send_conversation
from tests.test_email_and_feedback import database
from tests.test_topic_attachment import setup_topic


@pytest.mark.parametrize("category", ["task", "practice"])
def test_goal_round_trip_encryption_partial_edit_and_explicit_clear(client, category):
    headers, topic = setup_topic(client)
    endpoint = "/api/v1/users/me/map/entries"
    response = client.post(
        endpoint,
        headers=headers,
        json={
            "category": category,
            "text": "Prepare what I want to say",
            "goal": "  Express my boundary clearly  ",
            "topic_space_id": topic["id"],
        },
    )
    assert response.status_code == 200, response.text
    entry = response.json()["entry"]
    assert entry["goal"] == "Express my boundary clearly"
    with database(client) as db:
        row = db.execute(select(TABLES["map_entries"])).mappings().one()
        assert isinstance(row["goal_ciphertext"], bytes)
        assert b"Express my boundary clearly" not in row["goal_ciphertext"]
    edited = client.patch(
        f"{endpoint}/{entry['id']}",
        headers=headers,
        json={
            "text": "Write down one sentence",
            "working_on": True,
        },
    )
    assert edited.json()["entry"]["goal"] == entry["goal"]
    saved = client.get("/api/v1/users/me/map", headers=headers).json()
    assert saved["topic_spaces"][0]["entries"][0]["goal"] == entry["goal"]
    cleared = client.patch(f"{endpoint}/{entry['id']}", headers=headers, json={"goal": None})
    assert cleared.json()["entry"]["goal"] is None
    assert cleared.json()["entry"]["working_on"] is True
    invalid = client.patch(f"{endpoint}/{entry['id']}", headers=headers, json={"goal": "x" * 1001})
    assert invalid.status_code == 422


def propose_pattern(client, monkeypatch):
    headers, topic = setup_topic(client)

    class PatternClient:
        async def create_topic(self, **kwargs):
            return TopicLLMResult(
                topic="Pleasing everyone",
                description="An unconfirmed interpretation",
                category="trait",
                existing_topic_id=topic["id"],
                map_suggestion={
                    "kind": "reflection",
                    "category": "own_perception",
                    "text": "I wonder whether I sometimes put others' preferences first.",
                    "question": "Do those two decisions feel connected to you?",
                    "reason": "You changed a work choice after criticism and a weekend plan after disagreement.",
                    "goal": None,
                },
            )

    monkeypatch.setattr(llm_routes, "get_topic_llm_client", PatternClient)
    response = send_conversation(
        client,
        headers,
        [
            "I changed my work choice after my colleague criticised it.",
            "I also changed my weekend plan after a friend disagreed.",
            "Both choices mattered to me, and I keep thinking about them.",
        ],
    )
    assert response.status_code == 200, response.text
    chat_id = response.json()["chat_id"]
    pending = client.get(f"/api/v1/llm/chats/{chat_id}/topic-suggestion", headers=headers).json()
    assert pending["suggestions"] == []
    suggestion = pending["map_suggestion"]
    assert suggestion["kind"] == "reflection"
    assert suggestion["topic_space_id"] == topic["id"]
    assert suggestion["suggestion_id"]
    return headers, chat_id, suggestion


def test_chosen_action_goal_reaches_review_and_confirmed_chat_context(client, monkeypatch):
    from backend.llm.context import confirmed_map_context

    headers, topic = setup_topic(client)

    class ActionClient:
        async def create_topic(self, **kwargs):
            return TopicLLMResult(
                topic="",
                description="",
                existing_topic_id=topic["id"],
                map_suggestion={
                    "kind": "observation",
                    "category": "task",
                    "question": None,
                    "text": "Prepare one sentence",
                    "goal": "Express my boundary clearly",
                    "reason": "You chose to prepare a sentence to express your boundary.",
                },
            )

    monkeypatch.setattr(llm_routes, "get_topic_llm_client", ActionClient)
    result = send_conversation(
        client,
        headers,
        [
            "I want to be clearer about my boundaries at work.",
            "This has mattered to me for a long time.",
            "I will prepare one sentence to express my boundary clearly.",
        ],
    )
    chat_id = result.json()["chat_id"]
    suggestion = client.get(
        f"/api/v1/llm/chats/{chat_id}/topic-suggestion",
        headers=headers,
    ).json()["map_suggestion"]
    assert suggestion["goal"] == "Express my boundary clearly"
    saved = client.post(
        "/api/v1/llm/map-suggestions/confirm",
        headers=headers,
        json={
            "chat_id": chat_id,
            "suggestion_id": suggestion["suggestion_id"],
            "category": "task",
            "text": suggestion["text"],
            "goal": suggestion["goal"],
            "topic_space_id": topic["id"],
        },
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["entry"]["goal"] == suggestion["goal"]
    context = confirmed_map_context({"self_authorship_map": saved.json()["map"]}, chat_id)
    assert context[0]["observations"][0]["goal"] == suggestion["goal"]


def test_pattern_needs_confirmation_then_saves_only_edited_observation(client, monkeypatch):
    headers, chat_id, suggestion = propose_pattern(client, monkeypatch)
    endpoint = "/api/v1/llm/map-suggestions/confirm"
    payload = {
        "chat_id": chat_id,
        "accepted": True,
        "suggestion_id": suggestion["suggestion_id"],
        "category": suggestion["category"],
        "text": "I sometimes change choices after criticism.",
        "topic_space_id": suggestion["topic_space_id"],
    }
    assert client.post(endpoint, headers=headers, json=payload).status_code == 400
    assert (
        client.post(
            endpoint,
            headers=headers,
            json={
                **payload,
                "suggestion_id": "outdated",
                "interpretation_confirmed": True,
            },
        ).status_code
        == 409
    )
    before = client.get("/api/v1/users/me/map", headers=headers).json()
    assert before["topic_spaces"][0]["entries"] == []
    result = client.post(
        endpoint, headers=headers, json={**payload, "interpretation_confirmed": True}
    )
    assert result.status_code == 200, result.text
    assert result.json()["entry"]["text"] == payload["text"]
    assert len(result.json()["map"]["topic_spaces"][0]["entries"]) == 1
    # A stale review cannot save a second copy after consuming the proposal.
    assert (
        client.post(
            endpoint,
            headers=headers,
            json={
                **payload,
                "interpretation_confirmed": True,
            },
        ).status_code
        == 409
    )


def test_dismissing_pattern_leaves_map_unchanged_and_remembers_dismissal(client, monkeypatch):
    headers, chat_id, suggestion = propose_pattern(client, monkeypatch)
    before = client.get("/api/v1/users/me/map", headers=headers).json()
    result = client.post(
        "/api/v1/llm/map-suggestions/confirm",
        headers=headers,
        json={
            "chat_id": chat_id,
            "accepted": False,
            "suggestion_id": suggestion["suggestion_id"],
            "category": suggestion["category"],
            "text": suggestion["text"],
        },
    )
    assert result.status_code == 200, result.text
    assert client.get("/api/v1/users/me/map", headers=headers).json() == before
    assert result.json()["entry"] is None
    from backend.models.user import ChatSession
    from backend.services.chat_storage import chat_context

    with database(client) as db:
        chat = db.scalar(select(ChatSession).where(ChatSession.chat_id == chat_id))
        info = chat_context(db, chat)
        assert "pending_map_suggestion" not in info
        assert info["last_dismissed_map_suggestion"]["kind"] == "reflection"


@pytest.mark.parametrize(
    "change",
    [
        {"kind": []},
        {"kind": "diagnosis"},
        {"question": None},
        {"question": " "},
        {"category": "task"},
        {"goal": "An unchosen goal"},
        {"goal": 3},
    ],
)
def test_malformed_or_action_like_pattern_is_discarded(change):
    assert (
        map_suggestion_from_payload(
            {
                "kind": "reflection",
                "category": "own_perception",
                "text": "I wonder if this fits.",
                "reason": "Two distinct user-described situations.",
                "question": "Does this fit?",
                "goal": None,
                **change,
            }
        )
        is None
    )


def test_older_relevant_topic_and_its_broader_home_fit_bounded_context():
    spaces = [
        {"id": f"recent-{i}", "title": f"Mein wichtiges Thema {i}", "updated_at": "2026-10-01"}
        for i in range(30)
    ]
    spaces += [
        {"id": "social", "title": "Social behavior", "updated_at": "2020-01-01"},
        {
            "id": "music",
            "title": "Geigenunterricht",
            "parent_topic_id": "social",
            "entries": [
                {"category": "practice", "text": "Prepare a piece", "goal": "Enjoy making music"}
            ],
        },
    ]
    selected = select_topic_context(
        spaces,
        {
            "messages": [{"role": "user", "content": "Mein Geigenunterricht ist mir wichtig."}],
        },
        "chat",
    )
    assert [topic["id"] for topic in selected[:2]] == ["music", "social"]
    assert len(selected) == 20
    bounded = bounded_topic_map(selected)
    assert bounded[0]["observations"][0]["goal"] == "Enjoy making music"
