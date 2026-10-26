"""Storage compatibility for the existing SQLite datetime response format."""

from datetime import datetime, timezone

from sqlalchemy import DateTime
from sqlalchemy.types import TypeDecorator


class LegacyDateTime(TypeDecorator[datetime]):
    """Store timestamptz on PostgreSQL; expose SQLite's naive UTC read values.

    Existing HTTP responses omit UTC offsets except where routes explicitly add
    them. SQL storage retains timezone=True and Python defaults remain aware UTC.
    """

    impl = DateTime
    cache_ok = True

    def process_result_value(self, value: datetime | None, dialect) -> datetime | None:
        if value is not None and dialect.name == "postgresql":
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value
