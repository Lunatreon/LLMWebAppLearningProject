"""Relational map unit of work behind the existing profile/API boundary.

Only ordinary conversation memory stays in user_profiles.data. Map JSON returned
by the profile accessor is reconstructed from relational rows, never stored there.
The session flush hook keeps profile memory and map rows in one transaction.
"""

from copy import deepcopy
from sqlalchemy import event, select, update, delete
from sqlalchemy.orm import Session, object_session
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified
from backend.models.user import UserProfile, ChatSession
from backend.models.map import TABLES
from backend.services.map_codec import MAP_KEY, encode_map, decode_map
from backend.services.map_categories import activate, require_category


class MapConflictError(RuntimeError):
    pass


def load_rows(connection, owner):
    state = TABLES["user_maps"]
    for _ in range(3):
        rows = {
            name: [
                dict(row)
                for row in connection.execute(
                    select(table).where(table.c.user_id == owner)
                ).mappings()
            ]
            for name, table in TABLES.items()
            if name != "map_categories"
        }
        before = rows["user_maps"][0]["revision"] if rows["user_maps"] else None
        after = connection.execute(
            select(state.c.revision).where(state.c.user_id == owner)
        ).scalar_one_or_none()
        if before == after:
            return rows
    raise MapConflictError("The map changed while it was being read. Reload and retry.")


def load_profile_map(profile):
    if "_map_cache" not in profile.__dict__:
        db = object_session(profile)
        if db is None or profile.user_id is None:
            profile._map_cache = None
            profile._map_revision = None
        else:
            connection = db.connection()
            activate(connection)
            rows = load_rows(connection, profile.user_id)
            profile._map_cache = decode_map(profile.user_id, rows)
            profile._map_revision = rows["user_maps"][0]["revision"] if rows["user_maps"] else None
    return profile.__dict__.get("_pending_map", profile._map_cache)


def profile_data(profile):
    db = object_session(profile)
    if db is not None:
        activate(db.connection())
    data = deepcopy(profile._stored_data or {})
    value = load_profile_map(profile)
    if value is not None:
        data[MAP_KEY] = deepcopy(value)
        data[MAP_KEY]["revision"] = profile._map_revision or 0
    return data


def assign_profile_data(profile, data):
    data = deepcopy(data or {})
    previous = load_profile_map(profile)
    next_map = data.pop(MAP_KEY, None)
    if isinstance(next_map, dict):
        next_map.pop("revision", None)
    profile._stored_data = data
    if next_map != previous:
        profile._pending_map = next_map
        flag_modified(profile, "_stored_data")


def synchronize(connection, owner, data, expected):
    old = load_rows(connection, owner)
    state = old["user_maps"]
    current = state[0]["revision"] if state else None
    if current != expected:
        raise MapConflictError("The map changed. Reload it before saving again.")
    table = TABLES["user_maps"]
    if current is not None:
        changed = connection.execute(
            update(table)
            .where(table.c.user_id == owner, table.c.revision == expected)
            .values(revision=expected + 1)
        )
        if changed.rowcount != 1:
            raise MapConflictError("The map changed. Reload it before saving again.")
    if data is None:
        if current is not None:
            connection.execute(delete(table).where(table.c.user_id == owner))
        return None
    activate(connection)
    chats = set(
        connection.execute(
            select(ChatSession.chat_id).where(ChatSession.user_id == owner)
        ).scalars()
    )
    rows = encode_map(owner, data, chats)
    for name, kind in [("map_topics", "topic"), ("map_entries", "entry")]:
        previous = {row["id"]: row["category"] for row in old[name]}
        for row in rows[name]:
            require_category(kind, row["category"], previous=previous.get(row["id"]))
    rows["user_maps"][0]["revision"] = (current or 0) + 1
    # Remove links and entries before topics; parent/topic FKs are deferred so a
    # merge can reparent/move rows without transient invalid references.
    names = ["map_topic_sources", "map_topic_relations", "map_entries", "map_topics"]
    for name in names:
        table = TABLES[name]
        pk = [column.name for column in table.primary_key]
        wanted = {tuple(row[k] for k in pk) for row in rows[name]}
        for row in old[name]:
            if tuple(row[k] for k in pk) not in wanted:
                connection.execute(delete(table).where(*(table.c[k] == row[k] for k in pk)))
    for name in [
        "user_maps",
        "map_topics",
        "map_entries",
        "map_topic_relations",
        "map_topic_sources",
    ]:
        table = TABLES[name]
        pk = [column.name for column in table.primary_key]
        present = {tuple(row[k] for k in pk) for row in old[name]}
        for row in rows[name]:
            if tuple(row[k] for k in pk) in present:
                values = {k: v for k, v in row.items() if k not in pk}
                if values:
                    connection.execute(
                        update(table).where(*(table.c[k] == row[k] for k in pk)).values(**values)
                    )
            else:
                try:
                    connection.execute(table.insert().values(**row))
                except IntegrityError:
                    if name == "user_maps":
                        raise MapConflictError("The map changed. Reload and retry.") from None
                    raise
    return rows["user_maps"][0]["revision"]


@event.listens_for(Session, "before_flush")
def retain_pending_profiles(session, context, instances):
    session.info["pending_maps"] = [
        profile
        for profile in list(session.new) + list(session.dirty)
        if isinstance(profile, UserProfile) and "_pending_map" in profile.__dict__
    ]


@event.listens_for(Session, "after_flush_postexec")
def flush_maps(session, context):
    for profile in session.info.pop("pending_maps", []):
        if isinstance(profile, UserProfile) and "_pending_map" in profile.__dict__:
            value = profile._pending_map
            revision = synchronize(
                session.connection(), profile.user_id, value, profile._map_revision
            )
            profile._map_cache = deepcopy(value)
            profile._map_revision = revision
            del profile._pending_map


@event.listens_for(UserProfile, "expire", raw=True)
def clear_cached_map(profile, attrs):
    for field in ("_map_cache", "_map_revision", "_pending_map"):
        profile.dict.pop(field, None)


def check_revision(profile, expected):
    load_profile_map(profile)
    if expected is not None and expected != (profile._map_revision or 0):
        raise MapConflictError("The map changed. Reload it before saving again.")
