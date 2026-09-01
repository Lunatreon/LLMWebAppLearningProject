import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.api.dependencies import get_current_user, get_db
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.db.session import SessionLocal
from app.models.user import ChatSession, DailyLLMUsage, User, UserProfile
from app.schemas.llm import (
    ChatCreateRequest,
    ChatRead,
    LLMRequest,
    LLMResponse,
    MapSuggestionConfirmationRequest,
    MapSuggestionConfirmationResponse,
    TopicConfirmationRequest,
    TopicConfirmationResponse,
    TopicSuggestionResponse,
)
from app.services.billing import has_premium_feature_access
from app.services.llm import (
    TextChunkCallback,
    get_chat_llm_client,
    get_topic_llm_client,
    update_conversation_summary,
)
from app.services.pattern_recognition import ChatAnalyser
from app.services.self_authorship import (
    add_map_entry,
    create_or_link_topic_space,
    find_topic_space_for_chat,
    link_chat_to_topic_space,
    merge_llm_profile,
    profile_data_for_access,
    read_map,
    record_conversation_memory,
)

router = APIRouter()
logger = logging.getLogger(__name__)
GENERIC_TOPIC_TITLES = {
    "feel",
    "feeling",
    "feel feeling",
    "feeling feel",
    "sad",
    "mood",
    "feelings",
}
MAP_SUGGESTION_LONG_MESSAGE_CHARS = 140
MAP_SUGGESTION_LONG_MESSAGE_WORDS = 35
MAP_SUGGESTION_SMALL_MESSAGE_TURNS = 3
MAP_SUGGESTION_REPEAT_COOLDOWN_TURNS = 5
MAP_SUGGESTION_HISTORY_KEYS = (
    "last_surface_map_suggestion",
    "last_saved_map_suggestion",
    "last_dismissed_map_suggestion",
)
MAP_SUGGESTION_TOKEN_PATTERN = re.compile(r"\w+", re.UNICODE)


def current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def _message_date(value: Any) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).date().isoformat()


def saved_user_messages_for_date(db: Session, user_id: int, usage_date: str) -> int:
    """Count saved messages when initializing quotas for existing installations."""

    chat_infos = db.execute(
        select(ChatSession.info).where(ChatSession.user_id == user_id)
    ).scalars()
    return sum(
        1
        for info in chat_infos
        for message in (info or {}).get("messages", [])
        if message.get("role") == "user"
        and _message_date(message.get("created_at")) == usage_date
    )


def reserve_daily_message(
    db: Session,
    *,
    user_id: int,
    daily_limit: int,
    premium_access: bool,
) -> str | None:
    """Reserve one persistent daily message slot and return its UTC date."""

    if not settings.rate_limit_enabled or daily_limit <= 0:
        return None

    now = datetime.now(timezone.utc)
    usage_date = now.date().isoformat()
    usage = db.execute(
        select(DailyLLMUsage).where(
            DailyLLMUsage.user_id == user_id,
            DailyLLMUsage.usage_date == usage_date,
        )
    ).scalar_one_or_none()
    saved_count = saved_user_messages_for_date(db, user_id, usage_date)
    used_messages = max(usage.message_count if usage else 0, saved_count)
    if used_messages >= daily_limit:
        tomorrow = datetime.combine(
            now.date() + timedelta(days=1),
            datetime.min.time(),
            tzinfo=timezone.utc,
        )
        retry_after = max(1, int((tomorrow - now).total_seconds()))
        detail = (
            "Daily message limit reached. Please try again tomorrow."
            if premium_access
            else (
                f"You have reached today's {daily_limit} free messages. "
                "Subscribe to Premium for more messages, or continue tomorrow."
            )
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=detail,
            headers={"Retry-After": str(retry_after)},
        )

    if usage is None:
        usage = DailyLLMUsage(
            user_id=user_id,
            usage_date=usage_date,
            message_count=used_messages + 1,
        )
        db.add(usage)
    else:
        usage.message_count = used_messages + 1
    db.commit()
    return usage_date


def release_daily_message(db: Session, *, user_id: int, usage_date: str | None) -> None:
    """Return a reserved slot when no assistant response was saved."""

    if usage_date is None:
        return
    db.rollback()
    usage = db.execute(
        select(DailyLLMUsage).where(
            DailyLLMUsage.user_id == user_id,
            DailyLLMUsage.usage_date == usage_date,
        )
    ).scalar_one_or_none()
    if usage is not None and usage.message_count > 0:
        usage.message_count -= 1
        db.commit()


def is_generic_topic(topic: Any) -> bool:
    return isinstance(topic, str) and topic.strip().lower() in GENERIC_TOPIC_TITLES


def normalized_topic(value: Any) -> str:
    return str(value or "").strip().lower()


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
        "created_at": current_timestamp(),
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

    stripped_input = user_input.strip()
    if (
        len(stripped_input) >= MAP_SUGGESTION_LONG_MESSAGE_CHARS
        or len(stripped_input.split()) >= MAP_SUGGESTION_LONG_MESSAGE_WORDS
    ):
        return True

    last_surface = (chat_info or {}).get("last_surface_map_suggestion")
    last_surface_count = (
        int(last_surface.get("message_count", 0)) if isinstance(last_surface, dict) else 0
    )
    return next_message_count - last_surface_count >= MAP_SUGGESTION_SMALL_MESSAGE_TURNS


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


def default_chat_info(user_id: int, chat_id: str, title: str | None = None) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "chat_id": chat_id,
        "title": title or "New chat",
        "message_count": 0,
        "messages": [],
        "created_at": current_timestamp(),
        "updated_at": current_timestamp(),
        "analysis_status": "idle",
    }


def chat_title_from_text(text: str) -> str:
    words = text.strip().split()
    if not words:
        return "New chat"
    title = " ".join(words[:6])
    return title[:80]


def chat_info_for_access(
    chat_info: dict[str, Any] | None,
    *,
    premium_access: bool,
) -> dict[str, Any]:
    visible_info = dict(chat_info or {})
    if not premium_access:
        visible_info.pop("pending_map_suggestion", None)
        visible_info.pop("topic_space_id", None)
    return visible_info


def chat_read(chat_session: ChatSession, *, premium_access: bool) -> ChatRead:
    info = chat_info_for_access(chat_session.info, premium_access=premium_access)
    pending_topic = info.get("pending_topic")
    accepted_topic = (
        pending_topic.get("topic")
        if isinstance(pending_topic, dict) and pending_topic.get("status") == "accepted"
        else None
    )
    return ChatRead(
        chat_id=chat_session.chat_id,
        title=str(accepted_topic or info.get("title") or "New chat"),
        message_count=int(info.get("message_count", 0)),
        updated_at=info.get("updated_at"),
        pending_topic=info.get("pending_topic"),
        pending_map_suggestion=info.get("pending_map_suggestion"),
        messages=list(info.get("messages", [])),
    )


def get_or_create_profile(db: Session, current_user: User) -> UserProfile:
    profile = current_user.profile
    if profile is None:
        profile = UserProfile(user_id=current_user.id, data={})
        db.add(profile)
        db.flush()
    return profile


def get_chat_session(db: Session, current_user: User, chat_id: str) -> ChatSession | None:
    return db.execute(
        select(ChatSession).where(
            ChatSession.user_id == current_user.id,
            ChatSession.chat_id == chat_id,
        )
    ).scalar_one_or_none()


def get_or_create_chat_session(
    db: Session,
    current_user: User,
    chat_id: str | None,
    title: str | None = None,
) -> ChatSession:
    resolved_chat_id = chat_id or uuid4().hex
    chat_session = get_chat_session(db, current_user, resolved_chat_id)
    if chat_session is not None:
        return chat_session

    chat_session = ChatSession(
        user_id=current_user.id,
        chat_id=resolved_chat_id,
        info=default_chat_info(current_user.id, resolved_chat_id, title),
    )
    db.add(chat_session)
    db.flush()
    return chat_session


def append_chat_exchange(
    chat_info: dict[str, Any],
    *,
    user_id: int,
    chat_id: str,
    user_input: str,
    assistant_message: str,
    map_suggestion: dict[str, Any] | None = None,
) -> dict[str, Any]:
    next_info = dict(chat_info or default_chat_info(user_id, chat_id))
    next_info["user_id"] = user_id
    next_info["chat_id"] = chat_id
    if not next_info.get("title") or next_info.get("title") == "New chat":
        next_info["title"] = chat_title_from_text(user_input)

    messages = list(next_info.get("messages", []))
    now = current_timestamp()
    messages.extend(
        [
            {"role": "user", "content": user_input, "created_at": now},
            {"role": "assistant", "content": assistant_message, "created_at": now},
        ]
    )
    next_info["messages"] = messages[-80:]
    next_info["message_count"] = int(next_info.get("message_count", 0)) + 1
    next_info["last_user_message"] = user_input
    next_info["last_assistant_message"] = assistant_message
    next_info["updated_at"] = now
    pending_topic = next_info.get("pending_topic")
    next_info["analysis_status"] = (
        "topic_ready"
        if isinstance(pending_topic, dict) and pending_topic.get("status") == "pending"
        else "queued"
    )
    if map_suggestion:
        next_info["pending_map_suggestion"] = map_suggestion
    else:
        next_info.pop("pending_map_suggestion", None)
    return next_info


async def analyse_chat_for_topic(
    user_id: int,
    chat_id: str,
    session_factory: sessionmaker[Session] = SessionLocal,
) -> None:
    db = session_factory()
    try:
        chat_session = db.execute(
            select(ChatSession).where(
                ChatSession.user_id == user_id,
                ChatSession.chat_id == chat_id,
            )
        ).scalar_one_or_none()
        if chat_session is None:
            return

        info = dict(chat_session.info or {})
        pending_topic = info.get("pending_topic")
        replaced_generic_topic = False
        if isinstance(pending_topic, dict) and pending_topic.get("status") == "pending":
            if is_generic_topic(pending_topic.get("topic")):
                info.pop("pending_topic", None)
                replaced_generic_topic = True
            else:
                return

        message_count = int(info.get("message_count", 0))
        if (
            not replaced_generic_topic
            and int(info.get("analysed_message_count", -1)) == message_count
        ):
            return

        info["analysis_status"] = "analysing"
        chat_session.info = info
        db.commit()

        analysis = ChatAnalyser().analyse(info)
        info = dict(chat_session.info or {})
        info["analysed_message_count"] = message_count

        if not analysis.should_create_topic:
            info["analysis_status"] = "idle"
            chat_session.info = info
            db.commit()
            return

        user = db.get(User, user_id)
        profile = db.scalar(select(UserProfile).where(UserProfile.user_id == user_id))
        visible_map = (
            read_map(profile.data if profile else {})
            if user is not None and has_premium_feature_access(db, user)
            else {"topic_spaces": []}
        )
        available_topics = [
            {
                "id": space.get("id"),
                "title": space.get("title"),
                "description": space.get("description", ""),
                "parent_topic_id": space.get("parent_topic_id"),
            }
            for space in visible_map.get("topic_spaces", [])[:40]
        ]
        topic_result = await get_topic_llm_client().create_topic(
            chat_info=info,
            matched_patterns=analysis.matched_patterns,
            topic_hint=analysis.topic_hint,
            available_topics=available_topics,
        )
        available_topic_ids = {topic.get("id") for topic in available_topics}
        if topic_result.existing_topic_id not in available_topic_ids:
            topic_result.existing_topic_id = None
        if topic_result.parent_topic_id not in available_topic_ids:
            topic_result.parent_topic_id = None

        accepted_topic_names = {
            normalized_topic(topic)
            for topic in info.get("accepted_topic_names", [])
            if topic
        }
        accepted_topic_hints = {
            normalized_topic(topic_hint)
            for topic_hint in info.get("accepted_topic_hints", [])
            if topic_hint
        }
        existing_topic = info.get("pending_topic")
        if isinstance(existing_topic, dict) and existing_topic.get("status") == "accepted":
            accepted_topic_names.add(normalized_topic(existing_topic.get("topic")))
            accepted_topic_hints.add(normalized_topic(existing_topic.get("topic_hint")))

        if (
            normalized_topic(topic_result.topic) in accepted_topic_names
            or normalized_topic(analysis.topic_hint) in accepted_topic_hints
        ):
            info["analysis_status"] = "idle"
            chat_session.info = info
            db.commit()
            return

        info["pending_topic"] = {
            "chat_id": chat_id,
            "topic": topic_result.topic,
            "description": topic_result.description,
            "confidence": analysis.confidence,
            "matched_patterns": analysis.matched_patterns,
            "topic_hint": analysis.topic_hint,
            "existing_topic_id": topic_result.existing_topic_id,
            "parent_topic_id": topic_result.parent_topic_id,
            "status": "pending",
            "created_at": current_timestamp(),
        }
        info["analysis_status"] = "topic_ready"
        chat_session.info = info
        db.commit()
    except Exception as exc:  # pragma: no cover - defensive for background jobs
        db.rollback()
        chat_session = db.execute(
            select(ChatSession).where(
                ChatSession.user_id == user_id,
                ChatSession.chat_id == chat_id,
            )
        ).scalar_one_or_none()
        if chat_session is not None:
            info = dict(chat_session.info or {})
            info["analysis_status"] = "error"
            info["analysis_error"] = str(exc)
            chat_session.info = info
            db.commit()
    finally:
        db.close()


async def maintain_chat_insights(
    user_id: int,
    chat_id: str,
    session_factory: sessionmaker[Session] = SessionLocal,
) -> None:
    await analyse_chat_for_topic(user_id, chat_id, session_factory)


@router.get("/chats", response_model=list[ChatRead])
def list_chats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ChatRead]:
    premium_access = has_premium_feature_access(db, current_user)
    chat_sessions = db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.updated_at.desc())
    ).scalars()
    return [
        chat_read(chat_session, premium_access=premium_access)
        for chat_session in chat_sessions
    ]


@router.post("/chats", response_model=ChatRead, status_code=status.HTTP_201_CREATED)
def create_chat(
    payload: ChatCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatRead:
    chat_session = get_or_create_chat_session(db, current_user, None, payload.title)
    db.commit()
    db.refresh(chat_session)
    return chat_read(
        chat_session,
        premium_access=has_premium_feature_access(db, current_user),
    )


@router.get("/chats/{chat_id}", response_model=ChatRead)
def read_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatRead:
    chat_session = get_chat_session(db, current_user, chat_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return chat_read(
        chat_session,
        premium_access=has_premium_feature_access(db, current_user),
    )


@router.delete("/chats/{chat_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_chat(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    chat_session = get_chat_session(db, current_user, chat_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    db.delete(chat_session)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/chats/{chat_id}/topic-suggestion", response_model=TopicSuggestionResponse)
def read_topic_suggestion(
    chat_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicSuggestionResponse:
    chat_session = get_chat_session(db, current_user, chat_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    pending_topic = (chat_session.info or {}).get("pending_topic")
    if not isinstance(pending_topic, dict) or pending_topic.get("status") != "pending":
        return TopicSuggestionResponse(suggestion=None)
    if is_generic_topic(pending_topic.get("topic")):
        return TopicSuggestionResponse(suggestion=None)
    return TopicSuggestionResponse(suggestion=pending_topic)


@router.post("/message", response_model=LLMResponse)
async def send_message_to_llm(
    payload: LLMRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> LLMResponse:
    return await process_llm_message(payload, background_tasks, db, current_user)


async def process_llm_message(
    payload: LLMRequest,
    background_tasks: BackgroundTasks,
    db: Session,
    current_user: User,
    on_text_chunk: TextChunkCallback | None = None,
) -> LLMResponse:
    premium_access = has_premium_feature_access(db, current_user)
    daily_limit = (
        settings.rate_limit_llm_user_per_day
        if premium_access
        else settings.rate_limit_llm_free_user_per_day
    )
    enforce_rate_limit(
        f"llm-minute:user:{current_user.id}",
        max_attempts=settings.rate_limit_llm_user_per_minute,
        window_seconds=60,
        detail="Too many messages sent too quickly. Please pause for a moment.",
    )
    reserved_usage_date = reserve_daily_message(
        db,
        user_id=current_user.id,
        daily_limit=daily_limit,
        premium_access=premium_access,
    )

    profile = get_or_create_profile(db, current_user)
    chat_session = get_or_create_chat_session(db, current_user, payload.chat_id)

    chat_client = get_chat_llm_client()
    chat_request = {
        "user_input": payload.input_text,
        "profile": profile_data_for_access(
            profile.data,
            premium_access=premium_access,
        ),
        "chat_info": chat_info_for_access(
            chat_session.info,
            premium_access=premium_access,
        ),
        "chat_id": chat_session.chat_id,
    }
    try:
        if on_text_chunk is None:
            chat_result = await chat_client.respond(**chat_request)
        else:
            chat_result = await chat_client.respond(
                **chat_request,
                on_text_chunk=on_text_chunk,
            )
    except Exception:
        release_daily_message(
            db,
            user_id=current_user.id,
            usage_date=reserved_usage_date,
        )
        raise

    profile.data = record_conversation_memory(
        merge_llm_profile(profile.data, chat_result.profile),
        user_input=payload.input_text,
        chat_id=chat_session.chat_id,
    )

    raw_map_suggestion = None
    if premium_access and chat_result.map_suggestion:
        topic_space = find_topic_space_for_chat(profile.data, chat_session.chat_id)
        raw_map_suggestion = {
            **chat_result.map_suggestion,
            "source_chat_id": chat_session.chat_id,
            "topic_space_id": topic_space.get("id") if topic_space else None,
            "topic_title": topic_space.get("title") if topic_space else None,
        }

    base_chat_info = chat_session.info or {}
    map_suggestion = (
        raw_map_suggestion
        if should_surface_map_suggestion(base_chat_info, payload.input_text, raw_map_suggestion)
        else None
    )
    next_chat_info = append_chat_exchange(
        chat_session.info or {},
        user_id=current_user.id,
        chat_id=chat_session.chat_id,
        user_input=payload.input_text,
        assistant_message=chat_result.assistant_message,
        map_suggestion=map_suggestion,
    )
    next_chat_info = update_conversation_summary(next_chat_info)
    if map_suggestion:
        next_chat_info = remember_map_suggestion_event(
            next_chat_info,
            "last_surface_map_suggestion",
            map_suggestion,
        )
    chat_session.info = next_chat_info
    db.commit()
    db.refresh(profile)
    db.refresh(chat_session)

    background_session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db.get_bind(),
    )
    background_tasks.add_task(
        maintain_chat_insights,
        current_user.id,
        chat_session.chat_id,
        background_session_factory,
    )

    return LLMResponse(
        assistant_message=chat_result.assistant_message,
        profile=profile_data_for_access(
            profile.data,
            premium_access=premium_access,
        ),
        chat_id=chat_session.chat_id,
        chat_info=chat_info_for_access(
            chat_session.info,
            premium_access=premium_access,
        ),
        map_suggestion=map_suggestion,
        topic_analysis_status="queued",
    )


@router.post("/message/stream")
async def stream_message_to_llm(
    payload: LLMRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Stream generation status, assistant text deltas, and the saved result."""

    user_id = current_user.id
    stream_session_factory = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=db.get_bind(),
    )
    # Authentication starts a transaction. Release it before a potentially slow
    # model call; the generator owns a separate, short-lived session.
    db.rollback()

    async def events():
        yield json.dumps({"type": "status", "message": "Connected to FeelY"}) + "\n"
        stream_db = stream_session_factory()
        stream_user = stream_db.get(User, user_id)
        if stream_user is None or not stream_user.is_active:
            stream_db.close()
            yield json.dumps(
                {"type": "error", "message": "Your session is no longer valid.", "status": 401}
            ) + "\n"
            return

        text_chunks: asyncio.Queue[str] = asyncio.Queue(maxsize=100)

        async def collect_text_chunk(chunk: str) -> None:
            if chunk:
                await text_chunks.put(chunk)

        task = asyncio.create_task(
            process_llm_message(
                payload,
                background_tasks,
                stream_db,
                stream_user,
                on_text_chunk=collect_text_chunk,
            )
        )
        elapsed = 0
        has_streamed_text = False
        try:
            while not task.done() or not text_chunks.empty():
                try:
                    chunk = await asyncio.wait_for(text_chunks.get(), timeout=1.0)
                    has_streamed_text = True
                    yield json.dumps({"type": "text_delta", "text": chunk}) + "\n"
                except asyncio.TimeoutError:
                    if task.done() or has_streamed_text:
                        continue
                    elapsed += 1
                    yield json.dumps(
                        {
                            "type": "status",
                            "message": "Ollama is generating locally",
                            "elapsed_seconds": elapsed,
                        }
                    ) + "\n"
            result = await task
            yield json.dumps({"type": "result", "data": result.model_dump(mode="json")}) + "\n"
        except HTTPException as exc:
            stream_db.rollback()
            yield json.dumps(
                {"type": "error", "message": str(exc.detail), "status": exc.status_code}
            ) + "\n"
        except asyncio.CancelledError:
            task.cancel()
            raise
        except Exception as exc:
            stream_db.rollback()
            logger.exception("Streaming chat generation failed", exc_info=exc)
            yield json.dumps(
                {"type": "error", "message": "FeelY could not finish this response."}
            ) + "\n"
        finally:
            if not task.done():
                task.cancel()
            stream_db.close()

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        background=background_tasks,
    )


@router.post("/topics/confirm", response_model=TopicConfirmationResponse)
def confirm_topic(
    payload: TopicConfirmationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicConfirmationResponse:
    premium_access = has_premium_feature_access(db, current_user)
    profile = get_or_create_profile(db, current_user)
    chat_session = get_chat_session(db, current_user, payload.chat_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    profile_data = dict(profile.data or {})
    chat_info = dict(chat_session.info or {})
    pending_topic = dict(chat_info.get("pending_topic") or {})

    if payload.accepted:
        pending_topic["status"] = "accepted"
        chat_info["title"] = payload.topic.strip()[:80]
        accepted_topic_name = payload.topic
        if premium_access:
            if payload.existing_topic_space_id:
                try:
                    profile_data, topic_space = link_chat_to_topic_space(
                        profile_data,
                        topic_space_id=payload.existing_topic_space_id,
                        chat_id=payload.chat_id,
                    )
                except LookupError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=str(exc),
                    ) from exc
            else:
                try:
                    profile_data, topic_space = create_or_link_topic_space(
                        profile_data,
                        title=payload.topic,
                        description=payload.description,
                        chat_id=payload.chat_id,
                        parent_topic_id=payload.parent_topic_space_id,
                    )
                except (LookupError, ValueError) as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=str(exc),
                    ) from exc

            topics = list(profile_data.get("topics", []))
            topic_entry = {
                "topic": topic_space["title"],
                "description": topic_space.get("description", ""),
                "chat_id": payload.chat_id,
                "confirmed_at": current_timestamp(),
            }
            if topic_entry not in topics:
                topics.append(topic_entry)
            profile_data["topics"] = topics
            profile_data["last_confirmed_topic"] = topic_entry
            accepted_topic_name = topic_space["title"]
            profile.data = profile_data
            pending_topic["topic_space_id"] = topic_space["id"]
            chat_info["topic_space_id"] = topic_space["id"]
            pending_map_suggestion = chat_info.get("pending_map_suggestion")
            if isinstance(pending_map_suggestion, dict):
                pending_map_suggestion["topic_space_id"] = topic_space["id"]
                pending_map_suggestion["topic_title"] = topic_space["title"]
                chat_info["pending_map_suggestion"] = pending_map_suggestion
        accepted_topic_names = list(chat_info.get("accepted_topic_names", []))
        if accepted_topic_name not in accepted_topic_names:
            accepted_topic_names.append(accepted_topic_name)
        chat_info["accepted_topic_names"] = accepted_topic_names

        topic_hint = pending_topic.get("topic_hint")
        accepted_topic_hints = list(chat_info.get("accepted_topic_hints", []))
        if topic_hint and topic_hint not in accepted_topic_hints:
            accepted_topic_hints.append(topic_hint)
        chat_info["accepted_topic_hints"] = accepted_topic_hints
    else:
        pending_topic["status"] = "dismissed"

    chat_info["pending_topic"] = pending_topic
    chat_info["updated_at"] = current_timestamp()
    chat_session.info = chat_info
    db.commit()
    db.refresh(profile)

    return TopicConfirmationResponse(
        accepted=payload.accepted,
        profile=profile_data_for_access(
            profile.data,
            premium_access=premium_access,
        ),
    )


@router.post(
    "/map-suggestions/confirm",
    response_model=MapSuggestionConfirmationResponse,
)
def confirm_map_suggestion(
    payload: MapSuggestionConfirmationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MapSuggestionConfirmationResponse:
    premium_access = has_premium_feature_access(db, current_user)
    if payload.accepted and not premium_access:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Premium is required to save insights to My Map.",
        )
    profile = get_or_create_profile(db, current_user)
    chat_session = get_chat_session(db, current_user, payload.chat_id)
    if chat_session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    chat_info = dict(chat_session.info or {})
    pending_map_suggestion = chat_info.get("pending_map_suggestion")

    entry = None
    if payload.accepted:
        topic_space = find_topic_space_for_chat(profile.data, payload.chat_id)
        topic_space_id = payload.topic_space_id or (topic_space.get("id") if topic_space else None)
        try:
            profile_data, entry = add_map_entry(
                profile.data,
                category=payload.category,
                text=payload.text,
                topic_space_id=topic_space_id,
                source_chat_id=payload.chat_id,
                reason=payload.reason,
            )
        except (LookupError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        profile.data = profile_data

    suggestion_event = pending_map_suggestion if isinstance(pending_map_suggestion, dict) else {
        "category": payload.category,
        "text": payload.text,
    }
    chat_info = remember_map_suggestion_event(
        chat_info,
        "last_saved_map_suggestion" if payload.accepted else "last_dismissed_map_suggestion",
        suggestion_event,
    )
    chat_info.pop("pending_map_suggestion", None)
    chat_info["updated_at"] = current_timestamp()
    chat_session.info = chat_info
    db.commit()
    db.refresh(profile)
    return MapSuggestionConfirmationResponse(
        accepted=payload.accepted,
        entry=entry,
        map=read_map(profile.data if premium_access else {}),
    )
