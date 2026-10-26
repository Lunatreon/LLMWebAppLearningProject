"""Lossless API-map conversion to typed relational rows and encrypted text fields."""

import json
from datetime import datetime, timezone
from backend.core.config import settings
from backend.core.content_crypto import encrypt, decrypt

MAP_KEY = "self_authorship_map"
TOPIC_FIELDS = {
    "id",
    "title",
    "description",
    "category",
    "parent_topic_id",
    "related_topic_ids",
    "entries",
    "chat_ids",
    "journal_dates",
    "created_at",
    "updated_at",
}
ENTRY_FIELDS = {
    "working_on",
    "id",
    "category",
    "text",
    "reason",
    "reflection",
    "status",
    "completion_percent",
    "source_chat_id",
    "source_topic_id",
    "source_topic_title",
    "created_at",
    "updated_at",
}


def timestamp(value):
    if value is None:
        return None
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed


def crypt(value, owner, row, field, key, *, decode=False):
    return (decrypt if decode else encrypt)(value, owner=owner, row=row, field=field, key_id=key)


def extra(data, fields, owner, row, key):
    value = {
        "values": {k: v for k, v in data.items() if k not in fields},
        "present": list(data),
        "timestamps": {k: data[k] for k in ("created_at", "updated_at") if k in data},
    }
    return crypt(json.dumps(value, ensure_ascii=False), owner, row, "extra", key)


def unpack(row, owner, identity):
    raw = crypt(
        row["extra_ciphertext"], owner, identity, "extra", row["content_key_id"], decode=True
    )
    return json.loads(raw) if raw else {"values": {}, "present": None, "timestamps": {}}


def encode_map(owner, data, chats):
    key = settings.content_encryption_key_id
    topics = data.get("topic_spaces", [])
    if not isinstance(topics, list) or not isinstance(data.get("unassigned_entries", []), list):
        raise ValueError("Invalid map collection")
    rows = {
        name: []
        for name in (
            "user_maps",
            "map_topics",
            "map_entries",
            "map_topic_relations",
            "map_topic_sources",
        )
    }
    rows["user_maps"].append(
        dict(
            user_id=owner,
            revision=1,
            updated_at=timestamp(data.get("updated_at")) or datetime.now(timezone.utc),
            content_key_id=key,
            extra_ciphertext=extra(
                data, {"topic_spaces", "unassigned_entries", "updated_at"}, owner, "map", key
            ),
        )
    )
    ids = [topic["id"] for topic in topics]
    if len(set(ids)) != len(ids) or any(
        not isinstance(i, str) or not i or len(i) > 64 for i in ids
    ):
        raise ValueError("Map topic IDs must be unique non-empty strings")
    by_id = {topic["id"]: topic for topic in topics}
    edges = set()
    entry_ids = set()

    def entry_row(entry, topic_id, position):
        identity = entry["id"]
        if (
            not isinstance(identity, str)
            or not identity
            or len(identity) > 64
            or identity in entry_ids
        ):
            raise ValueError("Map entry IDs must be unique non-empty strings")
        entry_ids.add(identity)
        source = entry.get("source_chat_id")
        status = entry.get("status") or (
            entry.get("practice_status") if entry.get("category") == "practice" else None
        )
        completion = entry.get("completion_percent")
        if type(entry.get("working_on", False)) is not bool:
            raise ValueError("Working on must be a boolean")
        if completion is None and entry.get("category") in {"practice", "task"}:
            completion = 100 if status == "completed" else 0
        if completion is not None and (type(completion) is not int or not 0 <= completion <= 100):
            raise ValueError("Completion must be an integer between 0 and 100")
        row = dict(
            user_id=owner,
            id=identity,
            topic_id=topic_id,
            category=entry["category"],
            category_kind="entry",
            position=position,
            completion_percent=completion,
            working_on=entry.get("working_on", False),
            practice_status=status,
            content_key_id=key,
            source_user_id=owner if source in chats else None,
            source_chat_id=source if source in chats else None,
            source_chat_reference=source,
            source_topic_reference=entry.get("source_topic_id"),
            created_at=timestamp(entry.get("created_at")),
            updated_at=timestamp(entry.get("updated_at")),
            extra_ciphertext=extra(entry, ENTRY_FIELDS, owner, "entry:" + identity, key),
        )
        for field, column in [
            ("text", "text_ciphertext"),
            ("reason", "reason_ciphertext"),
            ("reflection", "reflection_ciphertext"),
            ("source_topic_title", "source_topic_title_ciphertext"),
        ]:
            row[column] = crypt(
                entry.get(field, "" if field == "text" else None),
                owner,
                "entry:" + identity,
                field,
                key,
            )
        rows["map_entries"].append(row)

    for position, topic in enumerate(topics):
        identity = topic["id"]
        parent = topic.get("parent_topic_id")
        visited = {identity}
        while parent is not None:
            if parent not in by_id or parent in visited:
                raise ValueError("Invalid map parent chain")
            visited.add(parent)
            parent = by_id[parent].get("parent_topic_id")
        rows["map_topics"].append(
            dict(
                user_id=owner,
                id=identity,
                parent_topic_id=topic.get("parent_topic_id"),
                category_kind="topic",
                category=topic.get("category", "other"),
                position=position,
                content_key_id=key,
                title_ciphertext=crypt(
                    topic.get("title", ""), owner, "topic:" + identity, "title", key
                ),
                description_ciphertext=crypt(
                    topic.get("description", ""), owner, "topic:" + identity, "description", key
                ),
                created_at=timestamp(topic.get("created_at")),
                updated_at=timestamp(topic.get("updated_at")),
                extra_ciphertext=extra(topic, TOPIC_FIELDS, owner, "topic:" + identity, key),
            )
        )
        for related in topic.get("related_topic_ids", []):
            if related not in by_id or related == identity:
                raise ValueError("Invalid map relationship")
            if identity not in by_id[related].get("related_topic_ids", []):
                raise ValueError("Map relationships must be symmetric before migration")
            edges.add(tuple(sorted((identity, related))))
        for kind, field in [("chat", "chat_ids"), ("journal", "journal_dates")]:
            for source_position, reference in enumerate(dict.fromkeys(topic.get(field, []))):
                live = kind == "chat" and reference in chats
                rows["map_topic_sources"].append(
                    dict(
                        user_id=owner,
                        topic_id=identity,
                        kind=kind,
                        reference=reference,
                        position=source_position,
                        source_user_id=owner if live else None,
                        source_chat_id=reference if live else None,
                    )
                )
        for entry_position, entry in enumerate(topic.get("entries", [])):
            entry_row(entry, identity, entry_position)
    for entry_position, entry in enumerate(data.get("unassigned_entries", [])):
        entry_row(entry, None, entry_position)
    for a, b in sorted(edges):
        rows["map_topic_relations"].append(dict(user_id=owner, topic_a_id=a, topic_b_id=b))
    return rows


def decode_map(owner, rows):
    if not rows["user_maps"]:
        return None
    state = rows["user_maps"][0]
    root = unpack(state, owner, "map")
    result = dict(root["values"])
    result.update(topic_spaces=[], unassigned_entries=[])
    result["updated_at"] = root["timestamps"].get("updated_at") or state["updated_at"].isoformat()
    by_id = {}
    for row in sorted(rows["map_topics"], key=lambda r: (r["position"], r["id"])):
        identity = row["id"]
        metadata = unpack(row, owner, "topic:" + identity)
        topic = dict(metadata["values"])
        values = dict(
            id=identity,
            category=row["category"],
            parent_topic_id=row["parent_topic_id"],
            related_topic_ids=[],
            entries=[],
            chat_ids=[],
            journal_dates=[],
        )
        for field in ("title", "description"):
            values[field] = crypt(
                row[field + "_ciphertext"],
                owner,
                "topic:" + identity,
                field,
                row["content_key_id"],
                decode=True,
            )
        for field, value in values.items():
            if (
                metadata["present"] is None
                or field in metadata["present"]
                or field in {"id", "entries"}
            ):
                topic[field] = value
        topic.update(metadata["timestamps"])
        by_id[identity] = topic
        result["topic_spaces"].append(topic)
    for row in rows["map_topic_relations"]:
        a, b = row["topic_a_id"], row["topic_b_id"]
        by_id[a].setdefault("related_topic_ids", []).append(b)
        by_id[b].setdefault("related_topic_ids", []).append(a)
    for row in sorted(rows["map_topic_sources"], key=lambda r: (r["position"], r["reference"])):
        by_id[row["topic_id"]].setdefault(
            "chat_ids" if row["kind"] == "chat" else "journal_dates", []
        ).append(row["reference"])
    for row in sorted(rows["map_entries"], key=lambda r: (r["position"], r["id"])):
        identity = row["id"]
        metadata = unpack(row, owner, "entry:" + identity)
        entry = dict(metadata["values"])
        values = dict(
            id=identity,
            category=row["category"],
            status=row["practice_status"],
            completion_percent=row["completion_percent"],
            working_on=row.get("working_on", False),
            source_chat_id=row["source_chat_reference"],
            source_topic_id=row["source_topic_reference"],
        )
        for field, column in [
            ("text", "text_ciphertext"),
            ("reason", "reason_ciphertext"),
            ("reflection", "reflection_ciphertext"),
            ("source_topic_title", "source_topic_title_ciphertext"),
        ]:
            values[field] = crypt(
                row[column], owner, "entry:" + identity, field, row["content_key_id"], decode=True
            )
        for field, value in values.items():
            if metadata["present"] is None or field in metadata["present"] or field == "id":
                entry[field] = value
        entry.update(metadata["timestamps"])
        (
            by_id[row["topic_id"]].setdefault("entries", [])
            if row["topic_id"]
            else result["unassigned_entries"]
        ).append(entry)
    return result
