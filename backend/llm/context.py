"""Build bounded model context from saved chat and profile data."""

import json
import re
from collections import Counter
from typing import Any
from backend.services.map_categories import instructions

from backend.services.self_authorship import LLM_PROTECTED_PROFILE_FIELDS

RECENT_CHAT_MESSAGE_LIMIT = 2
RECENT_TOPIC_USER_MESSAGE_LIMIT = 12
TOPIC_MESSAGE_CHARACTER_LIMIT = 1200
TOPIC_CONTEXT_CHARACTER_LIMIT = 6000
TOPIC_MAP_CHARACTER_LIMIT = 6000


def focused_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    messages = [
        {
            "role": message.get("role"),
            "content": message.get("content", ""),
        }
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") in {"user", "assistant"}
    ]
    return {
        "title": chat_info.get("title"),
        "message_count": chat_info.get("message_count", 0),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", []))[-5:],
        "conversation_summary": chat_info.get("conversation_summary"),
        "recent_messages": messages[-RECENT_CHAT_MESSAGE_LIMIT:],
    }


def focused_profile_context(profile: dict[str, Any]) -> dict[str, Any]:
    focused_profile = dict(profile or {})
    for field in LLM_PROTECTED_PROFILE_FIELDS:
        focused_profile.pop(field, None)
    return focused_profile


def confirmed_map_context(profile: dict[str, Any], chat_id: str) -> list[dict[str, Any]]:
    """Provide bounded, read-only memories from topics connected to this chat."""
    map_data = profile.get("self_authorship_map")
    if not isinstance(map_data, dict):
        return []
    spaces = [
        space
        for space in map_data.get("topic_spaces", [])
        if isinstance(space, dict) and chat_id in space.get("chat_ids", [])
    ]
    # ISO timestamps allow recent observations to be selected without inferring
    # when the experience itself happened. Dates below refer to saved entries.
    spaces.sort(key=lambda space: str(space.get("updated_at") or ""), reverse=True)
    context = []
    for space in spaces[:2]:
        entries = [entry for entry in space.get("entries", []) if isinstance(entry, dict)]
        entries.sort(
            key=lambda entry: str(entry.get("updated_at") or entry.get("created_at") or ""),
            reverse=True,
        )
        context.append(
            {
                "topic": str(space.get("title") or "")[:100],
                "observations": [
                    {
                        "category": entry.get("category"),
                        "text": str(entry.get("text") or "")[:240],
                        "goal": str(entry.get("goal") or "")[:240] or None,
                        "saved_at": entry.get("created_at"),
                        "updated_at": entry.get("updated_at"),
                        **(
                            {
                                "status": entry.get("status"),
                                "reflection": str(entry.get("reflection") or "")[:240],
                            }
                            if entry.get("category") == "practice"
                            else {}
                        ),
                    }
                    for entry in entries[:3]
                ],
            }
        )
    return context


def topic_statement_excerpt(message: str, limit: int) -> str:
    if len(message) <= limit:
        return message
    marker = "\n[... omitted ...]\n"
    if limit <= len(marker):
        return message[-limit:] if limit else ""
    head = (limit - len(marker)) // 2
    tail = limit - len(marker) - head
    return message[:head] + marker + message[-tail:]


def topic_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    user_messages = [
        str(message.get("content", ""))
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    # Preserve chronology while bounding the payload for smaller hosted models.
    recent = []
    truncated = False
    remaining = TOPIC_CONTEXT_CHARACTER_LIMIT
    for message in reversed(user_messages[-RECENT_TOPIC_USER_MESSAGE_LIMIT:]):
        excerpt = topic_statement_excerpt(message, min(TOPIC_MESSAGE_CHARACTER_LIMIT, remaining))
        if not excerpt:
            break
        recent.append(excerpt)
        truncated = truncated or len(excerpt) < len(message)
        remaining -= len(excerpt)
    recent.reverse()
    older = user_messages[: -len(recent)] if recent else user_messages
    # Older verbatim evidence gives continuity without relying on assistant summaries.
    sampled = [older[0], *older[-3:]] if older else []
    return {
        "current_title": chat_info.get("title"),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", []))[-40:],
        "earlier_user_excerpts": list(
            dict.fromkeys(topic_statement_excerpt(message, 250) for message in sampled)
        ),
        "user_messages": recent,
        "new_user_message_count": chat_info.get("new_user_message_count", len(recent)),
        "context_is_partial": truncated
        or len(user_messages) > len(recent)
        or bool(chat_info.get("next_before_position")),
    }


def chat_request_payload(
    user_input: str,
    profile: dict[str, Any],
    chat_info: dict[str, Any],
    chat_id: str,
) -> str:
    return json.dumps(
        {
            "allowed_map_categories": instructions(),
            "chat_id": chat_id,
            "current_profile": focused_profile_context(profile or {}),
            "recent_chat_context": focused_chat_context(chat_info or {}),
            "confirmed_map_context": confirmed_map_context(profile or {}, chat_id),
            "new_user_input": user_input,
        },
        ensure_ascii=True,
    )


def bounded_topic_map(topics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep names/IDs for reuse, then spend remaining space on saved evidence."""
    result = []
    for topic in topics[:20]:
        item = {
            key: topic[key]
            for key in ("id", "title", "category", "parent_topic_id")
            if key in topic
        }
        item["title"] = str(item.get("title") or "")[:120]
        if len(json.dumps([*result, item], ensure_ascii=False)) > TOPIC_MAP_CHARACTER_LIMIT:
            break
        result.append(item)
    for item, topic in zip(result, topics):
        for key in ("description", "observations"):
            if key not in topic:
                continue
            value = (
                str(topic[key] or "")[:240]
                if key == "description"
                else [
                    {
                        "category": entry.get("category"),
                        "text": str(entry.get("text") or "")[:180],
                        **({"goal": str(entry["goal"])[:180]} if entry.get("goal") else {}),
                    }
                    for entry in topic[key][-3:]
                ]
            )
            item[key] = value
            if len(json.dumps(result, ensure_ascii=False)) > TOPIC_MAP_CHARACTER_LIMIT:
                item.pop(key)
    return result


def select_topic_context(
    spaces: list[dict[str, Any]], chat_info: dict[str, Any], chat_id: str
) -> list[dict[str, Any]]:
    """Select linked and lexically relevant anchors without another model request.

    Matching only chooses context; it never establishes a relationship or trait.
    Unicode tokens let older names and subjects compete with recently edited topics.
    """

    def tokens(value: str) -> set[str]:
        return {word for word in re.findall(r"[^\W_]+", value.casefold()) if len(word) > 2}

    context = topic_chat_context(chat_info)
    query = tokens(" ".join(context["user_messages"][-3:]))

    documents = {}
    frequency = Counter()
    for space in spaces:
        title = tokens(str(space.get("title") or ""))
        details = tokens(
            str(space.get("description") or "")[:240]
            + " "
            + " ".join(
                str(entry.get("text") or "")[:180] for entry in space.get("entries", [])[-3:]
            )
        )
        documents[space.get("id")] = (title, details)
        frequency.update(title | details)

    def rank(space):
        title, details = documents[space.get("id")]
        # Frequent shared words contribute less, without a language-specific
        # stopword list or inference rules about what a subject means.
        relevance = sum(
            (3 if word in title else 1) / frequency[word] for word in query & (title | details)
        )
        return (
            chat_id in space.get("chat_ids", []),
            relevance,
            str(space.get("updated_at") or ""),
        )

    ranked = sorted(spaces, key=rank, reverse=True)
    # Include a selected anchor's broader home when present, within the same budget.
    by_id = {space.get("id"): space for space in spaces}
    selected = []
    seen = set()
    for space in ranked:
        for candidate in (space, by_id.get(space.get("parent_topic_id"))):
            if candidate is None or candidate.get("id") in seen:
                continue
            if len(selected) == 20:
                break
            selected.append(candidate)
            seen.add(candidate.get("id"))
        if len(selected) == 20:
            break
    return [
        {
            "id": space.get("id"),
            "title": str(space.get("title") or "")[:120],
            "category": space.get("category", "other"),
            "description": str(space.get("description") or "")[:240],
            "parent_topic_id": space.get("parent_topic_id"),
            "observations": [
                {
                    "category": entry.get("category"),
                    "text": str(entry.get("text") or "")[:180],
                    **({"goal": str(entry["goal"])[:180]} if entry.get("goal") else {}),
                }
                for entry in space.get("entries", [])[-3:]
            ],
        }
        for space in selected
    ]


def topic_request_payload(
    chat_info: dict[str, Any],
    available_topics: list[dict[str, Any]] | None = None,
) -> str:
    return json.dumps(
        {
            "allowed_map_categories": instructions(),
            "topic_chat_context": topic_chat_context(chat_info or {}),
            "available_topics": bounded_topic_map(available_topics or []),
            "suggest_topics": chat_info.get("suggest_topics", True),
            "suggest_observations": chat_info.get("suggest_observations", True),
            "recent_observation_suggestions": {
                key: chat_info[key]
                for key in (
                    "pending_map_suggestion",
                    "last_surface_map_suggestion",
                    "last_saved_map_suggestion",
                    "last_dismissed_map_suggestion",
                )
                if key in chat_info
            },
            "recent_topic_suggestions": chat_info.get("recent_topic_suggestions", [])[-12:],
        },
        ensure_ascii=False,
    )
