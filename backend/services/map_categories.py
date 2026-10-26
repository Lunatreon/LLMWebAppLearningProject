"""Request-local category catalog shared by API validation and LLM contracts."""

from contextvars import ContextVar
from sqlalchemy import select
from migrations.map_schema_v3 import category_rows

_catalog = ContextVar("map_categories", default=None)


def catalog():
    return _catalog.get() or category_rows()


def activate(connection):
    from backend.models.map import MapCategory

    rows = [
        dict(row)
        for row in connection.execute(
            select(MapCategory.__table__).order_by(
                MapCategory.__table__.c.position, MapCategory.__table__.c.key
            )
        ).mappings()
    ]
    _catalog.set(rows)
    return rows


def allowed(kind, *, llm=False):
    return {
        row["key"]
        for row in catalog()
        if row["kind"] == kind and row["active"] and (not llm or row["llm_enabled"])
    }


def existing(kind):
    return {row["key"] for row in catalog() if row["kind"] == kind}


class CategoryValidationError(ValueError):
    pass


def require_category(kind, key, *, previous=None):
    if key not in allowed(kind) and key != previous:
        raise CategoryValidationError("Select an active map category.")
    return key


def instructions():
    return {
        kind: [
            {k: row[k] for k in ("key", "label", "description", "supports_completion")}
            for row in catalog()
            if row["kind"] == kind and row["active"] and row["llm_enabled"]
        ]
        for kind in ("topic", "entry")
    }


def supports_completion(key):
    return any(
        row["kind"] == "entry" and row["key"] == key and row["supports_completion"]
        for row in catalog()
    )
