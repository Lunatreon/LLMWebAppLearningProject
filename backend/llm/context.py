"""Build bounded model context from saved chat and profile data."""

import json
from typing import Any
from backend.services.map_categories import instructions

from backend.services.self_authorship import LLM_PROTECTED_PROFILE_FIELDS

RECENT_CHAT_MESSAGE_LIMIT = 2
RECENT_TOPIC_USER_MESSAGE_LIMIT = 4


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


def topic_chat_context(chat_info: dict[str, Any]) -> dict[str, Any]:
    user_messages = [
        str(message.get("content", ""))
        for message in chat_info.get("messages", [])
        if isinstance(message, dict) and message.get("role") == "user"
    ]
    return {
        "current_title": chat_info.get("title"),
        "accepted_topic_names": list(chat_info.get("accepted_topic_names", [])),
        "conversation_summary": chat_info.get("conversation_summary"),
        "user_messages": user_messages[-RECENT_TOPIC_USER_MESSAGE_LIMIT:],
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


def topic_request_payload(
    chat_info: dict[str, Any],
    matched_patterns: list[str],
    topic_hint: str | None,
    available_topics: list[dict[str, Any]] | None = None,
) -> str:
    return json.dumps(
        {
            "allowed_map_categories": instructions(),
            "topic_chat_context": topic_chat_context(chat_info or {}),
            "matched_patterns": matched_patterns,
            "topic_hint": topic_hint,
            "available_topics": available_topics or [],
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
        },
        ensure_ascii=True,
    )
