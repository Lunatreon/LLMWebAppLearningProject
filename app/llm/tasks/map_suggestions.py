"""Map suggestion deduplication and cooldown policy, independent of HTTP routes."""

import re
from datetime import datetime, timezone
from typing import Any

MAP_SUGGESTION_REPEAT_COOLDOWN_TURNS = 5


MAP_SUGGESTION_HISTORY_KEYS = (
    "last_surface_map_suggestion",
    "last_saved_map_suggestion",
    "last_dismissed_map_suggestion",
)


MAP_SUGGESTION_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


def normalized_map_suggestion_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def map_suggestion_tokens(value: Any) -> set[str]:
    return {
        token
        for token in MAP_SUGGESTION_TOKEN_PATTERN.findall(normalized_map_suggestion_text(value))
        if len(token) > 3
    }


def map_suggestion_signature(suggestion: dict[str, Any] | None) -> str:
    if not isinstance(suggestion, dict):
        return ""
    category = str(suggestion.get("category") or "").strip().lower()
    text = normalized_map_suggestion_text(suggestion.get("text"))
    return f"{category}:{text[:220]}"


def map_suggestions_are_similar(
    first: dict[str, Any] | None,
    second: dict[str, Any] | None,
) -> bool:
    if not isinstance(first, dict) or not isinstance(second, dict):
        return False
    if str(first.get("category") or "").lower() != str(second.get("category") or "").lower():
        return False

    first_text = normalized_map_suggestion_text(first.get("text"))
    second_text = normalized_map_suggestion_text(second.get("text"))
    if not first_text or not second_text:
        return False
    if first_text == second_text or first_text in second_text or second_text in first_text:
        return True

    first_tokens = map_suggestion_tokens(first_text)
    second_tokens = map_suggestion_tokens(second_text)
    if min(len(first_tokens), len(second_tokens)) < 3:
        return False
    overlap = len(first_tokens & second_tokens) / min(len(first_tokens), len(second_tokens))
    return overlap >= 0.7


def map_suggestion_marker(
    suggestion: dict[str, Any],
    *,
    message_count: int,
) -> dict[str, Any]:
    return {
        "category": suggestion.get("category"),
        "text": normalized_map_suggestion_text(suggestion.get("text"))[:220],
        "signature": map_suggestion_signature(suggestion),
        "message_count": message_count,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def map_suggestion_from_marker(marker: Any) -> dict[str, Any] | None:
    if not isinstance(marker, dict):
        return None
    return {
        "category": marker.get("category"),
        "text": marker.get("text"),
    }


def should_surface_map_suggestion(
    chat_info: dict[str, Any],
    user_input: str,
    suggestion: dict[str, Any] | None,
) -> bool:
    if not suggestion:
        return False

    next_message_count = int((chat_info or {}).get("message_count", 0)) + 1
    for key in MAP_SUGGESTION_HISTORY_KEYS:
        marker = (chat_info or {}).get(key)
        if not isinstance(marker, dict):
            continue
        marker_count = int(marker.get("message_count", 0))
        if next_message_count - marker_count >= MAP_SUGGESTION_REPEAT_COOLDOWN_TURNS:
            continue
        if map_suggestions_are_similar(suggestion, map_suggestion_from_marker(marker)):
            return False

    # The map model assesses whether the content supports a useful proposal.
    # Short, explicit insights should not require extra turns to become visible.
    return bool(user_input.strip() and str(suggestion.get("text") or "").strip())


def remember_map_suggestion_event(
    chat_info: dict[str, Any],
    key: str,
    suggestion: dict[str, Any],
) -> dict[str, Any]:
    next_info = dict(chat_info)
    next_info[key] = map_suggestion_marker(
        suggestion,
        message_count=int(next_info.get("message_count", 0)),
    )
    return next_info
