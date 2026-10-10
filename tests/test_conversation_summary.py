from copy import deepcopy

import pytest

from app.services.conversation_summary import (
    summarize_conversation,
    update_conversation_summary,
)


def test_summary_keeps_older_user_words_without_mutating_history():
    messages = [
        {"role": "user", "content": "  I want   time to think. "},
        {"role": "assistant", "content": "An interpretation the user never made."},
        {"role": "user", "content": "I want time to think."},
        {"role": "user", "content": "The latest concern."},
        {"role": "user", "content": "The current message."},
    ]
    info = {"messages": messages, "message_count": 4, "title": "Reflection"}
    original = deepcopy(info)

    updated = update_conversation_summary(info)

    assert updated["conversation_summary"] == (
        "Earlier user statements (verbatim excerpts): “I want time to think.”"
    )
    assert updated["summary_message_count"] == 2
    assert info == original
    assert updated["messages"] == messages
    assert updated["title"] == "Reflection"


@pytest.mark.parametrize("older_content", [None, "", "   "])
def test_empty_older_messages_clear_stale_summary(older_content):
    info = {
        "messages": [
            {"role": "user", "content": older_content},
            {"role": "user", "content": "Recent"},
            {"role": "user", "content": "Current"},
        ],
        "message_count": 3,
        "conversation_summary": "Stale notes",
        "summary_message_count": 9,
    }

    updated = update_conversation_summary(info)

    assert "conversation_summary" not in updated
    assert updated["summary_message_count"] == 0


def test_summary_excludes_latest_turns_and_bounds_older_excerpts():
    older_messages = [
        {"role": "user", "content": " ".join([f"statement-{i}"] * 50)}
        for i in range(10)
    ]
    messages = older_messages + [
        {"role": "user", "content": "Recent"},
        {"role": "user", "content": "Current"},
    ]

    summary = summarize_conversation(messages)

    assert summary is not None
    assert "Recent" not in summary and "Current" not in summary
    assert "statement-1" not in summary
    for index in (0, 8, 9):
        assert summary.count(f"statement-{index}") == 36


@pytest.mark.parametrize("messages", [[], [{"role": "user", "content": "Hello"}]])
def test_short_chats_do_not_need_summary(messages):
    assert summarize_conversation(messages) is None
