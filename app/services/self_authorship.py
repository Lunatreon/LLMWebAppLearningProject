from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


MAP_KEY = "self_authorship_map"
ENTRY_CATEGORIES = {
    "inherited_script",
    "own_perception",
    "value",
    "body_signal",
    "practice",
    "evidence",
}
PRACTICE_STATUSES = {"active", "paused", "completed"}
LLM_PROTECTED_PROFILE_FIELDS = {
    MAP_KEY,
    "last_chat_id",
    "topics",
    "last_confirmed_topic",
    "last_user_message",
    "message_count",
    "recent_messages",
}


def current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def empty_map() -> dict[str, Any]:
    return {
        "topic_spaces": [],
        "unassigned_entries": [],
        "updated_at": current_timestamp(),
    }


def read_map(profile_data: dict[str, Any] | None) -> dict[str, Any]:
    raw_map = (profile_data or {}).get(MAP_KEY)
    if not isinstance(raw_map, dict):
        return empty_map()

    result = empty_map()
    result["topic_spaces"] = list(raw_map.get("topic_spaces", []))
    result["unassigned_entries"] = list(raw_map.get("unassigned_entries", []))
    result["updated_at"] = raw_map.get("updated_at") or result["updated_at"]
    return result


def write_map(profile_data: dict[str, Any] | None, map_data: dict[str, Any]) -> dict[str, Any]:
    updated_profile = dict(profile_data or {})
    next_map = deepcopy(map_data)
    next_map["updated_at"] = current_timestamp()
    updated_profile[MAP_KEY] = next_map
    return updated_profile


def merge_llm_profile(
    current_profile: dict[str, Any] | None,
    llm_profile: dict[str, Any] | None,
) -> dict[str, Any]:
    """Merge ordinary LLM memory while preserving user-confirmed identity data."""

    current = dict(current_profile or {})
    generated = dict(llm_profile or {})
    for field in LLM_PROTECTED_PROFILE_FIELDS:
        generated.pop(field, None)
    merged = {**current, **generated}
    for field in LLM_PROTECTED_PROFILE_FIELDS:
        if field in current:
            merged[field] = current[field]
    return merged


def record_conversation_memory(
    profile_data: dict[str, Any] | None,
    *,
    user_input: str,
    chat_id: str,
) -> dict[str, Any]:
    """Update mechanical chat memory without asking the LLM to regenerate it."""

    updated_profile = dict(profile_data or {})
    updated_profile["last_user_message"] = user_input
    updated_profile["last_chat_id"] = chat_id
    updated_profile["message_count"] = int(updated_profile.get("message_count", 0)) + 1

    recent_messages = list(updated_profile.get("recent_messages", []))
    recent_messages.append(user_input)
    updated_profile["recent_messages"] = recent_messages[-10:]
    return updated_profile


def create_or_link_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    title: str,
    description: str,
    chat_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)
    normalized_title = title.strip().lower()
    now = current_timestamp()

    for space in map_data["topic_spaces"]:
        if str(space.get("title", "")).strip().lower() != normalized_title:
            continue
        chat_ids = list(space.get("chat_ids", []))
        if chat_id not in chat_ids:
            chat_ids.append(chat_id)
        space["chat_ids"] = chat_ids
        space["description"] = description
        space["updated_at"] = now
        return write_map(profile_data, map_data), space

    space = {
        "id": uuid4().hex,
        "title": title.strip(),
        "description": description.strip(),
        "chat_ids": [chat_id],
        "entries": [],
        "created_at": now,
        "updated_at": now,
    }
    map_data["topic_spaces"].append(space)
    return write_map(profile_data, map_data), space


def create_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    title: str,
    description: str = "",
    chat_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)
    normalized_title = title.strip().lower()
    now = current_timestamp()

    if not normalized_title:
        raise ValueError("Topic title is required")

    for space in map_data["topic_spaces"]:
        if str(space.get("title", "")).strip().lower() != normalized_title:
            continue
        if chat_id:
            chat_ids = list(space.get("chat_ids", []))
            if chat_id not in chat_ids:
                chat_ids.append(chat_id)
            space["chat_ids"] = chat_ids
        if description.strip():
            space["description"] = description.strip()
        space["updated_at"] = now
        return write_map(profile_data, map_data), space

    space = {
        "id": uuid4().hex,
        "title": title.strip(),
        "description": description.strip(),
        "chat_ids": [chat_id] if chat_id else [],
        "entries": [],
        "created_at": now,
        "updated_at": now,
    }
    map_data["topic_spaces"].append(space)
    return write_map(profile_data, map_data), space


def update_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    topic_space_id: str,
    title: str | None = None,
    description: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)

    for space in map_data["topic_spaces"]:
        if space.get("id") != topic_space_id:
            continue
        if title is not None:
            cleaned_title = title.strip()
            if not cleaned_title:
                raise ValueError("Topic title is required")
            space["title"] = cleaned_title
        if description is not None:
            space["description"] = description.strip()
        space["updated_at"] = current_timestamp()
        return write_map(profile_data, map_data), space

    raise LookupError("Topic space not found")


def delete_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    topic_space_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)

    for space in map_data["topic_spaces"]:
        if space.get("id") != topic_space_id:
            continue
        map_data["topic_spaces"].remove(space)
        map_data["unassigned_entries"].extend(space.get("entries", []))
        return write_map(profile_data, map_data), space

    raise LookupError("Topic space not found")


def find_topic_space_for_chat(
    profile_data: dict[str, Any] | None,
    chat_id: str,
) -> dict[str, Any] | None:
    for space in read_map(profile_data)["topic_spaces"]:
        if chat_id in space.get("chat_ids", []):
            return space
    return None


def add_map_entry(
    profile_data: dict[str, Any] | None,
    *,
    category: str,
    text: str,
    topic_space_id: str | None = None,
    source_chat_id: str | None = None,
    reason: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if category not in ENTRY_CATEGORIES:
        raise ValueError(f"Unsupported map category: {category}")

    now = current_timestamp()
    entry = {
        "id": uuid4().hex,
        "category": category,
        "text": text.strip(),
        "source_chat_id": source_chat_id,
        "reason": reason.strip() if reason else None,
        "created_at": now,
        "updated_at": now,
    }
    if category == "practice":
        entry["status"] = "active"
        entry["reflection"] = None

    map_data = read_map(profile_data)
    if topic_space_id:
        for space in map_data["topic_spaces"]:
            if space.get("id") == topic_space_id:
                space.setdefault("entries", []).append(entry)
                space["updated_at"] = now
                return write_map(profile_data, map_data), entry
        raise LookupError("Topic space not found")

    map_data["unassigned_entries"].append(entry)
    return write_map(profile_data, map_data), entry


def find_entry_group(map_data: dict[str, Any], entry_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    entry_groups = [map_data["unassigned_entries"]]
    entry_groups.extend(space.get("entries", []) for space in map_data["topic_spaces"])

    for entries in entry_groups:
        for entry in entries:
            if entry.get("id") == entry_id:
                return entries, entry
    raise LookupError("Map entry not found")


def update_map_entry(
    profile_data: dict[str, Any] | None,
    *,
    entry_id: str,
    category: str | None = None,
    text: str | None = None,
    reason: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if category is not None and category not in ENTRY_CATEGORIES:
        raise ValueError(f"Unsupported map category: {category}")

    map_data = read_map(profile_data)
    _, entry = find_entry_group(map_data, entry_id)

    if category is not None and category != entry.get("category"):
        entry["category"] = category
        if category == "practice":
            entry.setdefault("status", "active")
            entry.setdefault("reflection", None)
        else:
            entry.pop("status", None)
            entry.pop("reflection", None)
    if text is not None:
        entry["text"] = text.strip()
    if reason is not None:
        entry["reason"] = reason.strip() if reason else None
    entry["updated_at"] = current_timestamp()
    return write_map(profile_data, map_data), entry


def delete_map_entry(
    profile_data: dict[str, Any] | None,
    *,
    entry_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)
    entries, entry = find_entry_group(map_data, entry_id)
    entries.remove(entry)
    return write_map(profile_data, map_data), entry


def update_practice(
    profile_data: dict[str, Any] | None,
    *,
    entry_id: str,
    practice_status: str,
    reflection: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if practice_status not in PRACTICE_STATUSES:
        raise ValueError(f"Unsupported practice status: {practice_status}")

    map_data = read_map(profile_data)
    _, entry = find_entry_group(map_data, entry_id)
    if entry.get("category") != "practice":
        raise LookupError("Practice not found")
    entry["status"] = practice_status
    entry["reflection"] = reflection.strip() if reflection else None
    entry["updated_at"] = current_timestamp()
    return write_map(profile_data, map_data), entry
