import json

import pytest

from backend.llm.context import bounded_topic_map, topic_chat_context, topic_request_payload
from backend.llm.tasks.topic_analysis import topic_analysis_due


@pytest.mark.parametrize(
    "count,previous,expected",
    [
        (0, 0, False),
        (1, 0, False),
        (2, 0, False),
        (3, 0, True),
        (4, 3, False),
        (5, 3, False),
        (6, 3, True),
        (12, 6, True),
        (6, 6, False),
    ],
)
def test_analysis_batches_completed_exchanges(count, previous, expected):
    assert (
        topic_analysis_due({"message_count": count, "analysed_message_count": previous}) is expected
    )


def test_context_retains_continuity_and_corrections_without_assistant_evidence():
    statements = ["Music has mattered to me since childhood."]
    statements += [f"Concrete user statement {index}" for index in range(15)]
    statements += ["I was quiet once, but I normally enjoy meeting people."]
    messages = [
        item
        for statement in statements
        for item in (
            {"role": "user", "content": statement},
            {"role": "assistant", "content": "You have a permanently introverted personality."},
        )
    ]
    context = topic_chat_context({"messages": messages, "new_user_message_count": 3})
    assert context["user_messages"] == statements[-12:]
    assert statements[0] in context["earlier_user_excerpts"]
    assert context["new_user_message_count"] == 3
    assert context["context_is_partial"] is True
    assert "permanently introverted" not in json.dumps(context)
    assert "conversation_summary" not in context


def test_unicode_context_is_bounded_and_identifies_partial_evidence():
    messages = [
        {"role": "user", "content": "Ängstlich, aber manchmal mutig. " * 1000} for _ in range(20)
    ]
    context = topic_chat_context({"messages": messages})
    assert sum(map(len, context["user_messages"])) <= 6000
    assert sum(map(len, context["earlier_user_excerpts"])) <= 1000
    assert context["context_is_partial"] is True
    assert context["user_messages"][-1].startswith("Ängstlich")


def test_long_statement_keeps_a_late_correction_visible():
    correction = "Actually, that was just one exhausting evening; I normally enjoy meeting people."
    message = "I was quiet at a party. " + "Details of the evening. " * 200 + correction
    context = topic_chat_context({"messages": [{"role": "user", "content": message}]})
    assert context["user_messages"][0].endswith(correction)
    assert "[... omitted ...]" in context["user_messages"][0]
    assert context["context_is_partial"] is True


def test_payload_keeps_reviewed_topics_and_request_switches_without_keywords():
    history = [{"topic": "Boundaries", "status": "dismissed"}]
    payload = json.loads(
        topic_request_payload(
            {
                "messages": [
                    {"role": "user", "content": "Eigene Entscheidungen sind mir wichtig."}
                ],
                "recent_topic_suggestions": history,
                "suggest_topics": False,
                "suggest_observations": True,
            },
            available_topics=[{"id": "autonomy", "title": "Autonomy"}],
        )
    )
    assert payload["recent_topic_suggestions"] == history
    assert payload["available_topics"][0]["id"] == "autonomy"
    assert payload["suggest_topics"] is False
    assert payload["suggest_observations"] is True
    assert "matched_patterns" not in payload and "topic_hint" not in payload
    assert payload["topic_chat_context"]["user_messages"] == [
        "Eigene Entscheidungen sind mir wichtig."
    ]


def test_saved_map_context_preserves_ids_without_overflowing_small_models():
    topics = [
        {
            "id": f"topic-{index}",
            "title": f"Thema {index}",
            "category": "other",
            "description": "Important user-authored context. " * 100,
            "observations": [{"category": "value", "text": "Eigene Entscheidungen. " * 100}] * 5,
        }
        for index in range(40)
    ]
    bounded = bounded_topic_map(topics)
    assert len(bounded) == 20
    assert [item["id"] for item in bounded] == [item["id"] for item in topics[:20]]
    assert len(json.dumps(bounded, ensure_ascii=False)) <= 6000
    assert "description" in bounded[0]
