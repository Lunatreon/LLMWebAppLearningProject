"""Backfill normalized map rows while preserving non-map profile fields."""

from copy import deepcopy
import sqlalchemy as sa
from migrations.map_schema_v3 import build_tables, category_rows


def canonical(value):
    value = deepcopy(value)
    value.setdefault("topic_spaces", [])
    value.setdefault("unassigned_entries", [])
    for topic in value["topic_spaces"]:
        if "related_topic_ids" in topic:
            topic["related_topic_ids"] = sorted(topic["related_topic_ids"])
        topic.setdefault("entries", [])
    return value


def migrate_profiles(connection, tables):
    from backend.services.map_codec import encode_map, decode_map
    from backend.core.content_crypto import validate_content_keys

    metadata = sa.MetaData()
    profiles = sa.Table("user_profiles", metadata, autoload_with=connection)
    chats = sa.Table("chat_sessions", metadata, autoload_with=connection)
    for row in connection.execute(sa.select(profiles)).mappings():
        data = deepcopy(row["data"] or {})
        if "self_authorship_map" not in data:
            continue
        validate_content_keys()
        owner = row["user_id"]
        value = data["self_authorship_map"]
        if not isinstance(value, dict):
            raise RuntimeError(
                "Invalid legacy map; restore/audit its backup before retrying migration."
            )
        if connection.execute(
            sa.select(tables["user_maps"].c.user_id).where(tables["user_maps"].c.user_id == owner)
        ).first():
            raise RuntimeError(
                "Both JSON and relational maps exist; migration refuses to choose between them."
            )
        # Preserve historical/custom categories as disabled rows until an admin reviews them.
        known = {
            (r["kind"], r["key"])
            for r in connection.execute(sa.select(tables["map_categories"])).mappings()
        }
        objects = [("topic", t.get("category", "other")) for t in value.get("topic_spaces", [])]
        entries = list(value.get("unassigned_entries", []))
        for topic in value.get("topic_spaces", []):
            entries.extend(topic.get("entries", []))
        objects.extend(("entry", entry["category"]) for entry in entries)
        for kind, key in objects:
            if (kind, key) not in known:
                connection.execute(
                    tables["map_categories"]
                    .insert()
                    .values(
                        kind=kind,
                        key=key,
                        label=key,
                        description="Imported legacy category; review before enabling.",
                        active=False,
                        llm_enabled=False,
                        supports_completion=False,
                        position=1000,
                    )
                )
                known.add((kind, key))
        live = set(
            connection.execute(sa.select(chats.c.chat_id).where(chats.c.user_id == owner)).scalars()
        )
        encoded = encode_map(owner, value, live)
        restored = decode_map(owner, encoded)
        if "updated_at" not in value:
            restored.pop("updated_at", None)
        if canonical(value) != canonical(restored):
            raise RuntimeError("Map migration verification failed; original JSON was retained.")
        for name in (
            "user_maps",
            "map_topics",
            "map_entries",
            "map_topic_relations",
            "map_topic_sources",
        ):
            if encoded[name]:
                # The current codec can include columns introduced after revision 0003.
                connection.execute(
                    tables[name].insert(),
                    [
                        {k: v for k, v in row.items() if k in tables[name].c}
                        for row in encoded[name]
                    ],
                )
        del data["self_authorship_map"]
        connection.execute(profiles.update().where(profiles.c.user_id == owner).values(data=data))


def upgrade(connection):
    metadata = sa.MetaData()
    for name in ("users", "user_profiles", "chat_sessions"):
        sa.Table(name, metadata, autoload_with=connection)
    tables = build_tables(metadata)
    for name in (
        "map_categories",
        "user_maps",
        "map_topics",
        "map_entries",
        "map_topic_relations",
        "map_topic_sources",
    ):
        tables[name].create(connection)
    connection.execute(tables["map_categories"].insert(), category_rows())
    migrate_profiles(connection, tables)
