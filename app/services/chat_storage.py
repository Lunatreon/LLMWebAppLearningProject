"""Bounded conversation reads; durable exchanges never live in session JSON."""

from datetime import timezone
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.models.user import ChatSession, ChatTurn, utc_now
from migrations.chat_storage_v2 import DERIVED_FIELDS, SCALAR_FIELDS, row_messages


def recent_turns(db: Session, chat: ChatSession, limit=40, before=None):
    query = select(ChatTurn).where(
        ChatTurn.chat_session_id == chat.id, ChatTurn.status.in_(("completed", "legacy"))
    )
    if before is not None:
        query = query.where(ChatTurn.position < before)
    rows = list(db.scalars(query.order_by(ChatTurn.position.desc()).limit(limit + 1)))
    has_more = len(rows) > limit
    selected = list(reversed(rows[:limit]))
    return selected, selected[0].position if selected and has_more else None


def turn_messages(turn: ChatTurn):
    result = row_messages(
        {
            key: getattr(turn, key)
            for key in (
                "user_input",
                "llm_response",
                "user_timestamp",
                "response_timestamp",
                "user_metadata",
                "response_metadata",
                "reaction",
            )
        }
    )
    return [{**message, "turn_id": turn.id, "position": turn.position} for message in result]


def chat_context(db: Session, chat: ChatSession, *, history=True):
    info = dict(chat.info or {})
    info.update({field: getattr(chat, field) for field in SCALAR_FIELDS})
    info.update(
        user_id=chat.user_id,
        chat_id=chat.chat_id,
        created_at=chat.created_at.replace(tzinfo=timezone.utc).isoformat(),
        updated_at=chat.updated_at.replace(tzinfo=timezone.utc).isoformat(),
    )
    info = {key: value for key, value in info.items() if value is not None}
    if history:
        rows, next_before = recent_turns(db, chat)
        info["next_before_position"] = next_before
        info["messages"] = [message for turn in rows for message in turn_messages(turn)]
        for role, key in (("user", "last_user_message"), ("assistant", "last_assistant_message")):
            info[key] = next(
                (
                    message["content"]
                    for message in reversed(info["messages"])
                    if message.get("role") == role
                ),
                "",
            )
    return info


def save_chat_context(chat: ChatSession, info):
    for field in SCALAR_FIELDS:
        if field in info:
            setattr(chat, field, info[field])
        elif field in {"analysed_message_count", "analysis_error", "conversation_summary"}:
            setattr(chat, field, None)
    chat.info = {
        key: value for key, value in info.items() if key not in SCALAR_FIELDS | DERIVED_FIELDS
    }


def begin_turn(db: Session, chat: ChatSession, user_input: str) -> ChatTurn:
    # Atomic per-conversation sequence allocation, independent of history length.
    position = db.scalar(
        update(ChatSession)
        .where(ChatSession.id == chat.id)
        .values(next_position=ChatSession.next_position + 1)
        .returning(ChatSession.next_position)
    )
    now = utc_now()
    turn = ChatTurn(
        chat_session_id=chat.id,
        position=position,
        user_input=user_input,
        status="pending",
        created_at=now,
        user_timestamp=now.isoformat(),
    )
    db.add(turn)
    db.commit()
    return turn


def complete_turn(db: Session, chat: ChatSession, turn: ChatTurn, response: str):
    now = utc_now()
    turn.llm_response = response
    turn.response_timestamp = now.isoformat()
    turn.responded_at = now
    turn.status = "completed"
    db.execute(
        update(ChatSession)
        .where(ChatSession.id == chat.id)
        .values(message_count=ChatSession.message_count + 1, updated_at=now)
    )
    db.flush()
    db.refresh(chat)
