from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

MAP_KEY = "self_authorship_map"
TOPIC_CATEGORIES = {"person", "trait", "experience", "other"}


def normalize_topic_category(value: Any) -> str:
    return value if isinstance(value, str) and value in TOPIC_CATEGORIES else "other"


ENTRY_CATEGORIES = {
    "inherited_script",
    "merged_topic",
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
PREMIUM_PROFILE_FIELDS = {
    MAP_KEY,
    "last_confirmed_topic",
    "topics",
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
    result["topic_spaces"] = deepcopy(list(raw_map.get("topic_spaces", [])))
    result["unassigned_entries"] = deepcopy(list(raw_map.get("unassigned_entries", [])))
    result["updated_at"] = raw_map.get("updated_at") or result["updated_at"]
    topic_ids = {
        str(space.get("id"))
        for space in result["topic_spaces"]
        if isinstance(space, dict) and space.get("id")
    }
    for space in result["topic_spaces"]:
        if not isinstance(space, dict):
            continue
        space["category"] = normalize_topic_category(space.get("category"))
        space_id = str(space.get("id") or "")
        parent_id = space.get("parent_topic_id")
        space["parent_topic_id"] = (
            parent_id if parent_id in topic_ids and parent_id != space_id else None
        )
        space["related_topic_ids"] = list(
            dict.fromkeys(
                related_id
                for related_id in space.get("related_topic_ids", [])
                if related_id in topic_ids and related_id != space_id
            )
        )
        space["chat_ids"] = list(dict.fromkeys(space.get("chat_ids", [])))
        space["journal_dates"] = list(
            dict.fromkeys(
                journal_date
                for journal_date in space.get("journal_dates", [])
                if isinstance(journal_date, str) and journal_date
            )
        )
        space["entries"] = list(space.get("entries", []))
    return result


def find_topic_space(map_data: dict[str, Any], topic_space_id: str) -> dict[str, Any]:
    for space in map_data["topic_spaces"]:
        if space.get("id") == topic_space_id:
            return space
    raise LookupError("Topic space not found")


def validate_parent_topic(
    map_data: dict[str, Any],
    *,
    topic_space_id: str | None,
    parent_topic_id: str | None,
) -> None:
    if parent_topic_id is None:
        return
    if parent_topic_id == topic_space_id:
        raise ValueError("A topic cannot be its own parent")
    parent = find_topic_space(map_data, parent_topic_id)
    visited = {topic_space_id}
    while parent is not None:
        parent_id = parent.get("id")
        if parent_id in visited:
            raise ValueError("Topic hierarchy cannot contain a cycle")
        visited.add(parent_id)
        next_parent_id = parent.get("parent_topic_id")
        if not next_parent_id:
            break
        parent = find_topic_space(map_data, next_parent_id)


def set_related_topics(
    map_data: dict[str, Any],
    *,
    topic_space: dict[str, Any],
    related_topic_ids: list[str],
) -> None:
    topic_space_id = topic_space["id"]
    cleaned_ids = list(dict.fromkeys(related_topic_ids))
    if topic_space_id in cleaned_ids:
        raise ValueError("A topic cannot be related to itself")
    for related_id in cleaned_ids:
        find_topic_space(map_data, related_id)

    previous_ids = set(topic_space.get("related_topic_ids", []))
    next_ids = set(cleaned_ids)
    topic_space["related_topic_ids"] = cleaned_ids
    for space in map_data["topic_spaces"]:
        space_id = space.get("id")
        if space_id == topic_space_id:
            continue
        backlinks = list(space.get("related_topic_ids", []))
        if space_id in next_ids and topic_space_id not in backlinks:
            backlinks.append(topic_space_id)
        if space_id in previous_ids - next_ids:
            backlinks = [value for value in backlinks if value != topic_space_id]
        space["related_topic_ids"] = backlinks


def profile_data_for_access(
    profile_data: dict[str, Any] | None,
    *,
    premium_access: bool,
) -> dict[str, Any]:
    """Hide premium insights while leaving ordinary conversation memory available."""

    visible_data = deepcopy(profile_data or {})
    if not premium_access:
        for field in PREMIUM_PROFILE_FIELDS:
            visible_data.pop(field, None)
    return visible_data


def preserve_premium_profile_fields(
    current_profile: dict[str, Any] | None,
    replacement_profile: dict[str, Any] | None,
) -> dict[str, Any]:
    """Prevent the generic profile endpoint from changing paywalled data."""

    current = deepcopy(current_profile or {})
    replacement = deepcopy(replacement_profile or {})
    for field in PREMIUM_PROFILE_FIELDS:
        if field in current:
            replacement[field] = current[field]
        else:
            replacement.pop(field, None)
    return replacement


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
    category: str = "other",
    related_topic_ids: list[str] | None = None,
    parent_topic_id: str | None = None,
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
        if related_topic_ids:
            set_related_topics(
                map_data, topic_space=space,
                related_topic_ids=list(dict.fromkeys([*space["related_topic_ids"], *related_topic_ids])),
            )
        if description.strip() and not space.get("description"):
            space["description"] = description.strip()
        if parent_topic_id is not None:
            validate_parent_topic(
                map_data,
                topic_space_id=space.get("id"),
                parent_topic_id=parent_topic_id,
            )
            space["parent_topic_id"] = parent_topic_id
        space["updated_at"] = now
        return write_map(profile_data, map_data), space

    space = {
        "id": uuid4().hex,
        "title": title.strip(),
        "description": description.strip(),
        "chat_ids": [chat_id],
        "category": normalize_topic_category(category),
        "entries": [],
        "parent_topic_id": parent_topic_id,
        "related_topic_ids": [],
        "created_at": now,
        "updated_at": now,
    }
    validate_parent_topic(
        map_data,
        topic_space_id=space["id"],
        parent_topic_id=parent_topic_id,
    )
    map_data["topic_spaces"].append(space)
    if related_topic_ids:
        set_related_topics(map_data, topic_space=space, related_topic_ids=related_topic_ids)
    return write_map(profile_data, map_data), space


def create_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    title: str,
    description: str = "",
    category: str | None = None,
    chat_id: str | None = None,
    journal_date: str | None = None,
    parent_topic_id: str | None = None,
    related_topic_ids: list[str] | None = None,
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
        if journal_date:
            journal_dates = list(space.get("journal_dates", []))
            if journal_date not in journal_dates:
                journal_dates.append(journal_date)
            space["journal_dates"] = journal_dates
        if description.strip():
            space["description"] = description.strip()
        if category is not None:
            space["category"] = normalize_topic_category(category)
        if parent_topic_id is not None:
            validate_parent_topic(
                map_data,
                topic_space_id=space.get("id"),
                parent_topic_id=parent_topic_id,
            )
            space["parent_topic_id"] = parent_topic_id
        if related_topic_ids is not None:
            set_related_topics(
                map_data,
                topic_space=space,
                related_topic_ids=related_topic_ids,
            )
        space["updated_at"] = now
        return write_map(profile_data, map_data), space

    space = {
        "id": uuid4().hex,
        "title": title.strip(),
        "description": description.strip(),
        "chat_ids": [chat_id] if chat_id else [],
        "category": normalize_topic_category(category),
        "journal_dates": [journal_date] if journal_date else [],
        "entries": [],
        "parent_topic_id": parent_topic_id,
        "related_topic_ids": [],
        "created_at": now,
        "updated_at": now,
    }
    validate_parent_topic(
        map_data,
        topic_space_id=space["id"],
        parent_topic_id=parent_topic_id,
    )
    map_data["topic_spaces"].append(space)
    if related_topic_ids:
        set_related_topics(
            map_data,
            topic_space=space,
            related_topic_ids=related_topic_ids,
        )
    return write_map(profile_data, map_data), space


def link_chat_to_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    topic_space_id: str,
    chat_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)
    space = find_topic_space(map_data, topic_space_id)
    chat_ids = list(space.get("chat_ids", []))
    if chat_id not in chat_ids:
        chat_ids.append(chat_id)
    space["chat_ids"] = chat_ids
    space["updated_at"] = current_timestamp()
    return write_map(profile_data, map_data), space


def link_journal_to_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    topic_space_id: str,
    journal_date: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    map_data = read_map(profile_data)
    space = find_topic_space(map_data, topic_space_id)
    journal_dates = list(space.get("journal_dates", []))
    if journal_date not in journal_dates:
        journal_dates.append(journal_date)
    space["journal_dates"] = journal_dates
    space["updated_at"] = current_timestamp()
    return write_map(profile_data, map_data), space


def update_topic_space(
    profile_data: dict[str, Any] | None,
    *,
    topic_space_id: str,
    title: str | None = None,
    description: str | None = None,
    category: str | None = None,
    parent_topic_id: str | None = None,
    update_parent: bool = False,
    related_topic_ids: list[str] | None = None,
    update_related: bool = False,
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
        if category is not None:
            space["category"] = normalize_topic_category(category)
        if update_parent:
            validate_parent_topic(
                map_data,
                topic_space_id=topic_space_id,
                parent_topic_id=parent_topic_id,
            )
            space["parent_topic_id"] = parent_topic_id
        if update_related:
            set_related_topics(
                map_data,
                topic_space=space,
                related_topic_ids=related_topic_ids or [],
            )
        space["updated_at"] = current_timestamp()
        return write_map(profile_data, map_data), space

    raise LookupError("Topic space not found")


def merge_topic_spaces(
    profile_data: dict[str, Any] | None,
    *,
    source_topic_space_id: str,
    target_topic_space_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Move a redundant topic's contents into a chosen existing topic."""

    if source_topic_space_id == target_topic_space_id:
        raise ValueError("A topic cannot be merged into itself")

    map_data = read_map(profile_data)
    source = find_topic_space(map_data, source_topic_space_id)
    target = find_topic_space(map_data, target_topic_space_id)

    ancestor_id = target.get("parent_topic_id")
    while ancestor_id:
        if ancestor_id == source_topic_space_id:
            raise ValueError("A topic cannot be merged into one of its child topics")
        ancestor_id = find_topic_space(map_data, ancestor_id).get("parent_topic_id")

    for field in ("chat_ids", "journal_dates"):
        target[field] = list(
            dict.fromkeys([*target.get(field, []), *source.get(field, [])])
        )

    entries_by_id: dict[str, dict[str, Any]] = {}
    entries_without_id: list[dict[str, Any]] = []
    for entry in [*target.get("entries", []), *source.get("entries", [])]:
        entry_id = entry.get("id") if isinstance(entry, dict) else None
        if isinstance(entry_id, str) and entry_id:
            entries_by_id[entry_id] = entry
        elif isinstance(entry, dict) and entry not in entries_without_id:
            entries_without_id.append(entry)
    target["entries"] = [*entries_by_id.values(), *entries_without_id]

    source_title = str(source.get("title") or "Merged topic").strip()
    source_description = str(source.get("description") or "").strip()
    preserved_text = (
        f"{source_title}: {source_description}" if source_description else source_title
    )[:1000]
    now = current_timestamp()
    target["entries"].append(
        {
            "id": uuid4().hex,
            "category": "merged_topic",
            "text": preserved_text,
            "source_chat_id": None,
            "source_journal_date": None,
            "source_topic_id": source_topic_space_id,
            "source_topic_title": source_title,
            "reason": f"Preserved when this topic was merged into {target.get('title') or 'another topic'}.",
            "created_at": now,
            "updated_at": now,
        }
    )

    if not str(target.get("description") or "").strip():
        target["description"] = str(source.get("description") or "").strip()

    source_parent_id = source.get("parent_topic_id")
    source_related_ids = list(source.get("related_topic_ids", []))
    map_data["topic_spaces"] = [
        space for space in map_data["topic_spaces"] if space.get("id") != source_topic_space_id
    ]

    for space in map_data["topic_spaces"]:
        space_id = space.get("id")
        if space.get("parent_topic_id") == source_topic_space_id:
            space["parent_topic_id"] = (
                source_parent_id if space_id == target_topic_space_id else target_topic_space_id
            )

        next_related_ids: list[str] = []
        for related_id in space.get("related_topic_ids", []):
            replacement_id = (
                target_topic_space_id
                if related_id == source_topic_space_id
                else related_id
            )
            if replacement_id != space_id and replacement_id not in next_related_ids:
                next_related_ids.append(replacement_id)
        space["related_topic_ids"] = next_related_ids

    target_related_ids = list(target.get("related_topic_ids", []))
    for related_id in source_related_ids:
        if related_id in {source_topic_space_id, target_topic_space_id}:
            continue
        if related_id not in target_related_ids:
            target_related_ids.append(related_id)
    target["related_topic_ids"] = target_related_ids
    set_related_topics(
        map_data,
        topic_space=target,
        related_topic_ids=target_related_ids,
    )
    target["updated_at"] = now
    return write_map(profile_data, map_data), target


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
        for remaining_space in map_data["topic_spaces"]:
            if remaining_space.get("parent_topic_id") == topic_space_id:
                remaining_space["parent_topic_id"] = space.get("parent_topic_id")
            remaining_space["related_topic_ids"] = [
                related_id
                for related_id in remaining_space.get("related_topic_ids", [])
                if related_id != topic_space_id
            ]
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
    source_journal_date: str | None = None,
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
        "source_journal_date": source_journal_date,
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
                if source_chat_id:
                    chat_ids = space.setdefault("chat_ids", [])
                    if source_chat_id not in chat_ids:
                        chat_ids.append(source_chat_id)
                if source_journal_date:
                    journal_dates = space.setdefault("journal_dates", [])
                    if source_journal_date not in journal_dates:
                        journal_dates.append(source_journal_date)
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
    topic_space_id: str | None = None,
    move_entry: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if category is not None and category not in ENTRY_CATEGORIES:
        raise ValueError(f"Unsupported map category: {category}")

    map_data = read_map(profile_data)
    current_entries, entry = find_entry_group(map_data, entry_id)

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
    if move_entry:
        target_entries = map_data["unassigned_entries"]
        target_space = None
        if topic_space_id:
            target_space = find_topic_space(map_data, topic_space_id)
            target_entries = target_space.setdefault("entries", [])
        if target_entries is not current_entries:
            current_entries.remove(entry)
            target_entries.append(entry)
        if target_space and entry.get("source_chat_id"):
            chat_ids = target_space.setdefault("chat_ids", [])
            if entry["source_chat_id"] not in chat_ids:
                chat_ids.append(entry["source_chat_id"])
            target_space["updated_at"] = current_timestamp()
        if target_space and entry.get("source_journal_date"):
            journal_dates = target_space.setdefault("journal_dates", [])
            if entry["source_journal_date"] not in journal_dates:
                journal_dates.append(entry["source_journal_date"])
            target_space["updated_at"] = current_timestamp()
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
