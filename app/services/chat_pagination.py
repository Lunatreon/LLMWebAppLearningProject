"""Ownership-scoped keyset pagination for conversation metadata."""

import base64
import json
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from app.models.user import ChatSession


def list_page(db, user_id, limit, cursor):
    query = select(ChatSession).where(ChatSession.user_id == user_id)
    if cursor:
        try:
            if len(cursor) > 256:
                raise ValueError
            timestamp, row_id = json.loads(base64.urlsafe_b64decode(cursor.encode()))
            timestamp = datetime.fromisoformat(timestamp)
            if type(row_id) is not int or row_id < 1:
                raise ValueError
        except (ValueError, TypeError, UnicodeError, json.JSONDecodeError):
            raise HTTPException(422, "Invalid conversation cursor") from None
        query = query.where(
            or_(
                ChatSession.updated_at < timestamp,
                and_(ChatSession.updated_at == timestamp, ChatSession.id < row_id),
            )
        )
    rows = list(
        db.scalars(
            query.order_by(ChatSession.updated_at.desc(), ChatSession.id.desc()).limit(limit + 1)
        )
    )
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1]
        next_cursor = base64.urlsafe_b64encode(
            json.dumps([last.updated_at.isoformat(), last.id]).encode()
        ).decode()
    return rows[:limit], next_cursor
