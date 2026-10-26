"""Extractive conversation memory. Change summary policy here without touching providers."""

from typing import Any

CONVERSATION_NOTE_EXCERPT_WORD_LIMIT = 36
RECENT_USER_MESSAGE_LIMIT = 2


def summarize_conversation(messages: list[dict[str, Any]]) -> str | None:
    """Summarize older user statements, leaving the latest two turns as context.

    This pure function neither changes the messages nor calls a provider. Keep
    summary policy here so chat persistence and provider code stay independent.
    """
    user_messages = [
        " ".join(str(message.get("content") or "").split())
        for message in messages
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    older_messages = user_messages[:-RECENT_USER_MESSAGE_LIMIT]
    if not older_messages:
        return None

    candidates = [older_messages[0], *older_messages[-2:]]
    excerpts: list[str] = []
    for candidate in candidates:
        excerpt = " ".join(candidate.split()[:CONVERSATION_NOTE_EXCERPT_WORD_LIMIT])
        if excerpt and excerpt not in excerpts:
            excerpts.append(excerpt)
    if not excerpts:
        return None
    return "Earlier user statements (verbatim excerpts): " + " | ".join(
        f"“{excerpt}”" for excerpt in excerpts
    )


def update_conversation_summary(chat_info: dict[str, Any]) -> dict[str, Any]:
    """Return chat metadata with refreshed notes; leave the stored history intact."""
    updated = dict(chat_info or {})
    summary = summarize_conversation(updated.get("messages", []))
    if summary is None:
        updated.pop("conversation_summary", None)
        updated["summary_message_count"] = 0
    else:
        updated["conversation_summary"] = summary
        updated["summary_message_count"] = max(
            0, int(updated.get("message_count", 0)) - RECENT_USER_MESSAGE_LIMIT
        )
    return updated
