import asyncio
import json
import logging
import re
from datetime import datetime, timezone
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
from app.models.user import ChatSession, User, UserProfile
from app.schemas.llm import (
    ChatCreateRequest,
    ChatRead,
    LLMRequest,
    LLMResponse,
    MapSuggestionConfirmationRequest,
    MapSuggestionConfirmationResponse,
    ReplyReactionRequest,
    TopicConfirmationRequest,
    TopicConfirmationResponse,
    TopicSuggestionResponse,
)
from app.services.billing import has_premium_feature_access
from app.services.chat_usage import release_daily_message, reserve_daily_message
from app.llm.tasks.conversation_summary import update_conversation_summary
from app.llm.providers.factory import get_chat_llm_client, get_topic_llm_client
from app.llm.types import TextChunkCallback
from app.llm.tasks.map_suggestions import (
    remember_map_suggestion_event,
    should_surface_map_suggestion,
)
from app.llm.tasks.pattern_recognition import ChatAnalyser
from app.services.self_authorship import (
    add_map_entry,
    create_or_link_topic_space,
    find_topic_space_for_chat,
    link_chat_to_topic_space,
    merge_llm_profile,
    profile_data_for_access,
    read_map,
    record_conversation_memory,
    update_topic_space,
)
from app.llm.tasks.topic_matching import best_existing_topic_match

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


def current_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_generic_topic(topic: Any) -> bool:
    return isinstance(topic, str) and topic.strip().lower() in GENERIC_TOPIC_TITLES


def normalized_topic(value: Any) -> str:
    return str(value or "").strip().lower()


def pending_topic_queue(chat_info: dict[str, Any]) -> list[dict[str, Any]]:
    raw_queue = chat_info.get("pending_topics")
    candidates = raw_queue if isinstance(raw_queue, list) else []
    if not candidates:
        candidates = [chat_info.get("pending_topic")]
    return [
        dict(candidate)
        for candidate in candidates
        if isinstance(candidate, dict)
        and candidate.get("status") == "pending"
        and not is_generic_topic(candidate.get("topic"))
    ]


def set_pending_topic_queue(
    chat_info: dict[str, Any],
    suggestions: list[dict[str, Any]],
) -> None:
    queue = [dict(suggestion) for suggestion in suggestions]
    total = len(queue)
    for position, suggestion in enumerate(queue, start=1):
        suggestion["status"] = "pending"
        suggestion["queue_position"] = position
        suggestion["queue_total"] = total
    if queue:
        chat_info["pending_topics"] = queue
        chat_info["pending_topic"] = queue[0]
        chat_info["analysis_status"] = "topic_ready"
        return
    chat_info.pop("pending_topics", None)
    chat_info.pop("pending_topic", None)
    chat_info["analysis_status"] = "idle"


def default_chat_info(user_id: int, chat_id: str, title: str | None = None) -> dict[str, Any]:
    return {
        "user_id": user_id,
        "chat_id": chat_id,
        "title": title or "New chat",
        "title_source": "provided" if title else "automatic",
        "initial_topic_title_set": bool(title),
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
        visible_info.pop("topic_space_ids", None)
    return visible_info


def chat_read(chat_session: ChatSession, *, premium_access: bool) -> ChatRead:
    info = chat_info_for_access(chat_session.info, premium_access=premium_access)
    queued_topics = pending_topic_queue(info)
    return ChatRead(
        chat_id=chat_session.chat_id,
        title=str(info.get("title") or "New chat"),
        message_count=int(info.get("message_count", 0)),
        updated_at=info.get("updated_at"),
        pending_topic=queued_topics[0] if queued_topics else None,
        pending_topics=queued_topics,
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
        next_info["title_source"] = "automatic"

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
    next_info["analysis_status"] = "queued"
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
        queued_topics = pending_topic_queue(info)
        replaced_generic_topic = False
        raw_pending_topic = info.get("pending_topic")
        raw_pending_topics = info.get("pending_topics")
        if not queued_topics and (
            (isinstance(raw_pending_topic, dict) and raw_pending_topic.get("status") == "pending")
            or isinstance(raw_pending_topics, list)
        ):
            set_pending_topic_queue(info, [])
            replaced_generic_topic = True

        message_count = int(info.get("message_count", 0))
        if (
            not replaced_generic_topic
            and int(info.get("analysed_message_count", -1)) == message_count
        ):
            return

        info["analysis_status"] = "analysing"
        info.pop("analysis_error", None)
        chat_session.info = info
        db.commit()

        analysis = ChatAnalyser().analyse(info)
        info = dict(chat_session.info or {})
        info["analysed_message_count"] = message_count

        user = db.get(User, user_id)
        premium_access = user is not None and has_premium_feature_access(db, user)
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
                "category": space.get("category", "other"),
                "description": space.get("description", ""),
                "parent_topic_id": space.get("parent_topic_id"),
                "observations": [
                    {"category": entry.get("category"), "text": str(entry.get("text") or "")[:240]}
                    for entry in space.get("entries", [])[-5:]
                ],
            }
            for space in visible_map.get("topic_spaces", [])[:40]
        ]
        topic_result = await get_topic_llm_client().create_topic(
            chat_info={
                **info,
                "suggest_topics": not queued_topics,
                "suggest_observations": premium_access and not info.get("pending_map_suggestion"),
            },
            matched_patterns=analysis.matched_patterns,
            topic_hint=analysis.topic_hint,
            available_topics=available_topics,
        )
        # A newer exchange or review may have arrived during generation.
        db.refresh(chat_session)
        info = dict(chat_session.info or {})
        if int(info.get("message_count", 0)) != message_count:
            return
        info["analysed_message_count"] = message_count
        queued_topics = pending_topic_queue(info)
        if (
            premium_access
            and topic_result.map_suggestion
            and not info.get("pending_map_suggestion")
        ):
            newest_input = next(
                (
                    str(m.get("content") or "")
                    for m in reversed(info.get("messages", []))
                    if m.get("role") == "user"
                ),
                "",
            )
            suggestion = dict(topic_result.map_suggestion)
            target = next(
                (
                    space
                    for space in visible_map.get("topic_spaces", [])
                    if space.get("id") == topic_result.existing_topic_id
                ),
                None,
            )
            if target is None:
                target = find_topic_space_for_chat(profile.data if profile else {}, chat_id)
            suggestion.update(
                source_chat_id=chat_id,
                topic_space_id=target.get("id") if target else None,
                topic_title=target.get("title") if target else None,
            )
            policy_info = {**info, "message_count": message_count - 1}
            if should_surface_map_suggestion(policy_info, newest_input, suggestion):
                info["pending_map_suggestion"] = suggestion
                info = remember_map_suggestion_event(
                    info, "last_surface_map_suggestion", suggestion
                )
        if queued_topics:
            info["analysis_status"] = "topic_ready" if queued_topics else "idle"
            chat_session.info = info
            db.commit()
            return
        available_topic_ids = {topic.get("id") for topic in available_topics}
        accepted_topic_names = {
            normalized_topic(topic) for topic in info.get("accepted_topic_names", []) if topic
        }
        pending_topics: list[dict[str, Any]] = []
        seen_targets: set[tuple[str, str]] = set()
        for result in [topic_result, *topic_result.additional_topics][:3]:
            if result.existing_topic_id not in available_topic_ids:
                result.existing_topic_id = None
            if result.parent_topic_id not in available_topic_ids:
                result.parent_topic_id = None
            if result.existing_topic_id is None:
                local_existing_topic_id = best_existing_topic_match(
                    result.topic,
                    result.description,
                    available_topics,
                    category=result.category,
                )
                if local_existing_topic_id is not None:
                    result.existing_topic_id = local_existing_topic_id
                    result.parent_topic_id = None

            normalized_name = normalized_topic(result.topic)
            if not normalized_name or normalized_name in accepted_topic_names:
                continue
            if pending_topics and best_existing_topic_match(
                result.topic,
                result.description,
                [
                    {
                        "id": suggestion["suggestion_id"],
                        "title": suggestion["topic"],
                        "category": suggestion["category"],
                        "description": suggestion["description"],
                    }
                    for suggestion in pending_topics
                ],
                category=result.category,
            ):
                continue
            target_key = (
                ("existing", result.existing_topic_id)
                if result.existing_topic_id
                else ("new", normalized_name)
            )
            if target_key in seen_targets or is_generic_topic(result.topic):
                continue
            seen_targets.add(target_key)
            pending_topics.append(
                {
                    "suggestion_id": uuid4().hex,
                    "chat_id": chat_id,
                    "topic": result.topic,
                    "description": result.description,
                    "category": result.category,
                    "related_topic_ids": [
                        topic_id
                        for topic_id in result.related_topic_ids
                        if topic_id in available_topic_ids and topic_id != result.existing_topic_id
                    ],
                    "confidence": analysis.confidence,
                    "matched_patterns": analysis.matched_patterns,
                    "topic_hint": analysis.topic_hint,
                    "existing_topic_id": result.existing_topic_id,
                    "parent_topic_id": result.parent_topic_id,
                    "status": "pending",
                    "created_at": current_timestamp(),
                }
            )

        if not pending_topics:
            info["analysis_status"] = "idle"
            chat_session.info = info
            db.commit()
            return

        if not info.get("initial_topic_title_set"):
            # Keep deliberately supplied and already-established chat names stable.
            # For a new automatic chat, the first strong topic is a better title
            # than the opening message excerpt. Later analyses must not rename it.
            can_use_initial_topic = info.get("title_source") != "provided" and not info.get(
                "accepted_topic_names"
            )
            if can_use_initial_topic:
                initial_topic_title = str(pending_topics[0].get("topic") or "").strip()
                if initial_topic_title:
                    info["title"] = initial_topic_title[:80]
                    info["title_source"] = "initial_topic"
            info["initial_topic_title_set"] = True

        set_pending_topic_queue(info, pending_topics)
        chat_session.info = info
        db.commit()
    except Exception as exc:  # pragma: no cover - defensive for background jobs
        logger.warning(
            "Background map analysis failed: provider=%s status=%s error_type=%s",
            settings.topic_llm_provider or settings.llm_provider,
            getattr(exc, "status_code", None),
            type(exc).__name__,
        )
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
        chat_read(chat_session, premium_access=premium_access) for chat_session in chat_sessions
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


@router.put("/chats/{chat_id}/reaction")
def react_to_reply(
    chat_id: str,
    payload: ReplyReactionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    chat = get_chat_session(db, current_user, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    info = dict(chat.info or {})
    messages = [dict(message) for message in info.get("messages", [])]
    target = next(
        (
            message
            for message in messages
            if message.get("role") == "assistant"
            and message.get("created_at") == payload.created_at
        ),
        None,
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Reply not found")
    target["reaction"] = payload.reaction
    info["messages"] = messages
    chat.info = info
    db.commit()
    return {"reaction": payload.reaction}


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
    suggestions = pending_topic_queue(chat_session.info or {})
    return TopicSuggestionResponse(
        suggestion=suggestions[0] if suggestions else None,
        suggestions=suggestions,
        chat_title=str((chat_session.info or {}).get("title") or "New chat"),
        map_suggestion=(
            (chat_session.info or {}).get("pending_map_suggestion")
            if has_premium_feature_access(db, current_user)
            else None
        ),
        analysis_status=str((chat_session.info or {}).get("analysis_status") or "idle"),
    )


@router.post("/chats/{chat_id}/topic-suggestion/retry", status_code=202)
def retry_topic_suggestion(
    chat_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    chat_session = get_chat_session(db, current_user, chat_id)
    if chat_session is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    info = dict(chat_session.info or {})
    if info.get("analysis_status") != "error":
        return {"analysis_status": str(info.get("analysis_status") or "idle")}
    enforce_rate_limit(f"map-retry:{current_user.id}", max_attempts=3, window_seconds=60)
    info["analysis_status"] = "queued"
    info.pop("analysed_message_count", None)
    info.pop("analysis_error", None)
    chat_session.info = info
    db.commit()
    factory = sessionmaker(autocommit=False, autoflush=False, bind=db.get_bind())
    background_tasks.add_task(maintain_chat_insights, current_user.id, chat_id, factory)
    return {"analysis_status": "queued"}


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
    except (Exception, asyncio.CancelledError):
        db.rollback()
        release_daily_message(
            db,
            user_id=current_user.id,
            usage_date=reserved_usage_date,
        )
        raise

    # Generation may take minutes. Map edits committed during that wait must
    # survive the conversation-memory update below.
    db.refresh(profile)
    profile.data = record_conversation_memory(
        merge_llm_profile(profile.data, chat_result.profile),
        user_input=payload.input_text,
        chat_id=chat_session.chat_id,
    )

    db.refresh(chat_session)
    base_chat_info = chat_session.info or {}
    map_suggestion = base_chat_info.get("pending_map_suggestion") if premium_access else None
    next_chat_info = append_chat_exchange(
        chat_session.info or {},
        user_id=current_user.id,
        chat_id=chat_session.chat_id,
        user_input=payload.input_text,
        assistant_message=chat_result.assistant_message,
        map_suggestion=map_suggestion,
    )
    next_chat_info = update_conversation_summary(next_chat_info)
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
                            "message": "FeelY - reflecting ...",
                            "elapsed_seconds": elapsed,
                        }
                    ) + "\n"
            result = await task
            yield json.dumps({"type": "result", "data": result.model_dump(mode="json")}) + "\n"
        except HTTPException as exc:
            logger.warning(
                "Chat stream failed: status=%s provider=%s",
                exc.status_code,
                settings.chat_llm_provider or settings.llm_provider,
            )
            stream_db.rollback()
            yield json.dumps(
                {"type": "error", "message": str(exc.detail), "status": exc.status_code}
            ) + "\n"
        except asyncio.CancelledError:
            task.cancel()
            raise
        except Exception as exc:
            stream_db.rollback()
            logger.error("Streaming chat generation failed: error_type=%s", type(exc).__name__)
            yield json.dumps(
                {"type": "error", "message": "FeelY could not finish this response."}
            ) + "\n"
        finally:
            if not task.done():
                task.cancel()
            try:
                await task
            except (Exception, asyncio.CancelledError):
                pass
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
    queued_topics = pending_topic_queue(chat_info)

    if payload.suggestion_id and not any(
        item.get("suggestion_id") == payload.suggestion_id for item in queued_topics
    ):
        raise HTTPException(
            status_code=409,
            detail="This suggestion was already reviewed or replaced. Refresh the chat.",
        )
    if (
        payload.accepted
        and (payload.require_map_access or payload.existing_topic_space_id)
        and not premium_access
    ):
        raise HTTPException(status_code=402, detail="My Map access is required to add to a topic.")

    if payload.accepted:
        accepted_topic_name = payload.topic
        if premium_access:
            existing_id = payload.existing_topic_space_id or next(
                (
                    space["id"]
                    for space in read_map(profile_data)["topic_spaces"]
                    if space["title"].strip().casefold() == payload.topic.casefold()
                ),
                None,
            )
            if existing_id:
                try:
                    profile_data, topic_space = link_chat_to_topic_space(
                        profile_data,
                        topic_space_id=existing_id,
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
                        category=payload.category,
                        related_topic_ids=payload.related_topic_ids,
                        chat_id=payload.chat_id,
                        parent_topic_id=payload.parent_topic_space_id,
                    )
                except (LookupError, ValueError) as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=str(exc),
                    ) from exc

            if existing_id and (
                payload.related_topic_ids or "category" in payload.model_fields_set
            ):
                try:
                    profile_data, topic_space = update_topic_space(
                        profile_data,
                        topic_space_id=topic_space["id"],
                        category=(
                            payload.category if "category" in payload.model_fields_set else None
                        ),
                        related_topic_ids=list(
                            dict.fromkeys(
                                [
                                    *topic_space.get("related_topic_ids", []),
                                    *payload.related_topic_ids,
                                ]
                            )
                        ),
                        update_related=True,
                    )
                except (LookupError, ValueError) as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
                    ) from exc

            if existing_id:
                profile_data, _ = add_map_entry(
                    profile_data,
                    category=payload.entry_category,
                    text=payload.description,
                    topic_space_id=topic_space["id"],
                    source_chat_id=payload.chat_id,
                    reason=f"Saved from topic suggestion: {payload.topic}",
                )

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
            linked_topic_ids = list(chat_info.get("topic_space_ids", []))
            legacy_topic_id = chat_info.get("topic_space_id")
            if legacy_topic_id and legacy_topic_id not in linked_topic_ids:
                linked_topic_ids.append(legacy_topic_id)
            if topic_space["id"] not in linked_topic_ids:
                linked_topic_ids.append(topic_space["id"])
            chat_info["topic_space_ids"] = linked_topic_ids
            if not chat_info.get("topic_space_id"):
                chat_info["topic_space_id"] = topic_space["id"]
            pending_map_suggestion = chat_info.get("pending_map_suggestion")
            if isinstance(pending_map_suggestion, dict) and not pending_map_suggestion.get(
                "topic_space_id"
            ):
                pending_map_suggestion["topic_space_id"] = topic_space["id"]
                pending_map_suggestion["topic_title"] = topic_space["title"]
                chat_info["pending_map_suggestion"] = pending_map_suggestion
        accepted_topic_names = list(chat_info.get("accepted_topic_names", []))
        if accepted_topic_name not in accepted_topic_names:
            accepted_topic_names.append(accepted_topic_name)
        chat_info["accepted_topic_names"] = accepted_topic_names
    if queued_topics:
        remaining = (
            [item for item in queued_topics if item.get("suggestion_id") != payload.suggestion_id]
            if payload.suggestion_id
            else queued_topics[1:]
        )
        set_pending_topic_queue(chat_info, remaining)
    else:
        set_pending_topic_queue(chat_info, [])
    chat_info["updated_at"] = current_timestamp()
    chat_session.info = chat_info
    db.commit()
    db.refresh(profile)

    return TopicConfirmationResponse(
        accepted=payload.accepted,
        saved_topic_space_id=topic_space["id"] if payload.accepted and premium_access else None,
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

    suggestion_event = (
        pending_map_suggestion
        if isinstance(pending_map_suggestion, dict)
        else {
            "category": payload.category,
            "text": payload.text,
        }
    )
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
