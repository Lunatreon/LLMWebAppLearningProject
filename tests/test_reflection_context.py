import json
from copy import deepcopy

from app.services.llm import chat_request_payload
from app.services.self_authorship import merge_llm_profile, profile_data_for_access


def test_chat_can_revisit_confirmed_observations_without_exposing_unrelated_topics():
    profile = {
        "self_authorship_map": {
            "topic_spaces": [
                {
                    "title": "Finding my voice",
                    "chat_ids": ["earlier-chat", "current-chat"],
                    "entries": [
                        {"category": "value", "text": "Being honest matters to me."},
                        {"category": "practice", "text": "Say what I prefer.",
                         "status": "paused", "reflection": "I need more time to know what I want.",
                         "created_at": "2026-09-01T12:00:00+00:00"},
                    ],
                },
                {"title": "Unrelated private topic", "chat_ids": ["other-chat"],
                 "entries": [{"text": "Not relevant here."}]},
            ],
        },
    }
    original = deepcopy(profile)
    chat = {"pending_map_suggestion": {"text": "Unconfirmed interpretation"}}
    payload = json.loads(chat_request_payload("I see it differently now.", profile, chat, "current-chat"))
    memories = payload["confirmed_map_context"]
    assert len(memories) == 1
    assert memories[0]["topic"] == "Finding my voice"
    practice = next(entry for entry in memories[0]["observations"] if entry["category"] == "practice")
    assert practice["status"] == "paused"
    assert practice["reflection"] == "I need more time to know what I want."
    assert practice["saved_at"] == "2026-09-01T12:00:00+00:00"
    assert "Unconfirmed interpretation" not in json.dumps(payload)
    assert "self_authorship_map" not in payload["current_profile"]
    assert profile == original
    assert merge_llm_profile(profile, {"self_authorship_map": {}}) == original

    restricted = profile_data_for_access(profile, premium_access=False)
    assert json.loads(chat_request_payload("Hello", restricted, {}, "current-chat"))["confirmed_map_context"] == []
    assert json.loads(chat_request_payload("Hello", profile, {}, "unlinked-chat"))["confirmed_map_context"] == []


def test_map_memories_are_bounded_and_prioritize_recently_updated_observations():
    spaces = [
        {"title": f"Topic {index}", "chat_ids": ["chat"], "updated_at": f"2026-09-{index + 1:02d}",
         "entries": [
             {"category": "own_perception", "text": f"Observation {entry_index} " + "x" * 500,
              "updated_at": f"2026-09-{entry_index + 1:02d}"}
             for entry_index in range(8)
         ]}
        for index in range(5)
    ]
    payload = json.loads(chat_request_payload("Hello", {"self_authorship_map": {"topic_spaces": spaces}}, {}, "chat"))
    memories = payload["confirmed_map_context"]
    assert [topic["topic"] for topic in memories] == ["Topic 4", "Topic 3"]
    for topic in memories:
        assert len(topic["observations"]) == 3
        assert topic["observations"][0]["text"].startswith("Observation 7 ")
        assert all(len(entry["text"]) <= 240 for entry in topic["observations"])
