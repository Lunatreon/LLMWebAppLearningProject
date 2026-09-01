from datetime import date
from hashlib import sha256
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import JournalEntry, User, UserProfile, utc_now
from app.schemas.journal import (
    JournalAnalysisResponse,
    JournalEntryListItem,
    JournalEntryRead,
    JournalEntryUpdate,
    JournalSuggestion,
    JournalSuggestionDecision,
    JournalSuggestionDecisionResponse,
)
from app.services.llm import analyse_journal_text
from app.services.billing import has_premium_feature_access
from app.services.self_authorship import (
    ENTRY_CATEGORIES,
    add_map_entry,
    create_topic_space,
    link_journal_to_topic_space,
    read_map,
)

router = APIRouter()


def get_current_journal_user(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> User:
    if not has_premium_feature_access(db, current_user):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Premium is required to access Journal.",
        )
    return current_user


def validated_entry_date(value: str) -> str:
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Journal date must use YYYY-MM-DD.",
        ) from exc
    return parsed.isoformat()


def content_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def word_count(content: str) -> int:
    return len(content.split())


def stored_suggestions(entry: JournalEntry | None) -> list[dict]:
    analysis = entry.analysis if entry and isinstance(entry.analysis, dict) else {}
    suggestions = analysis.get("suggestions", [])
    return suggestions if isinstance(suggestions, list) else []


def journal_entry_read(entry_date: str, entry: JournalEntry | None) -> JournalEntryRead:
    if entry is None:
        return JournalEntryRead(entry_date=entry_date)
    analysis = entry.analysis if isinstance(entry.analysis, dict) else {}
    source_hash = analysis.get("source_content_hash")
    return JournalEntryRead(
        entry_date=entry.entry_date,
        content=entry.content,
        word_count=word_count(entry.content),
        suggestions=[JournalSuggestion(**item) for item in stored_suggestions(entry)],
        analysis_stale=bool(source_hash and source_hash != content_hash(entry.content)),
        analysed_at=analysis.get("analysed_at"),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
    )


def find_entry(db: Session, user_id: int, entry_date: str) -> JournalEntry | None:
    return db.scalar(
        select(JournalEntry).where(
            JournalEntry.user_id == user_id,
            JournalEntry.entry_date == entry_date,
        )
    )


def get_or_create_profile(db: Session, user: User) -> UserProfile:
    profile = user.profile
    if profile is None:
        profile = UserProfile(user_id=user.id, data={})
        db.add(profile)
        db.flush()
    return profile


@router.get("/entries", response_model=list[JournalEntryListItem])
def list_journal_entries(
    limit: int = Query(default=120, ge=1, le=366),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_journal_user),
) -> list[JournalEntryListItem]:
    entries = db.scalars(
        select(JournalEntry)
        .where(JournalEntry.user_id == current_user.id)
        .order_by(JournalEntry.entry_date.desc())
        .limit(limit)
    )
    result: list[JournalEntryListItem] = []
    for entry in entries:
        compact = " ".join(entry.content.split())
        result.append(
            JournalEntryListItem(
                entry_date=entry.entry_date,
                excerpt=(compact[:117] + "...") if len(compact) > 120 else compact,
                word_count=word_count(entry.content),
                suggestion_count=len(stored_suggestions(entry)),
                updated_at=entry.updated_at,
            )
        )
    return result


@router.get("/entries/{entry_date}", response_model=JournalEntryRead)
def read_journal_entry(
    entry_date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_journal_user),
) -> JournalEntryRead:
    normalized_date = validated_entry_date(entry_date)
    return journal_entry_read(
        normalized_date,
        find_entry(db, current_user.id, normalized_date),
    )


@router.put("/entries/{entry_date}", response_model=JournalEntryRead)
def save_journal_entry(
    entry_date: str,
    payload: JournalEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_journal_user),
) -> JournalEntryRead:
    normalized_date = validated_entry_date(entry_date)
    entry = find_entry(db, current_user.id, normalized_date)
    if entry is None:
        entry = JournalEntry(
            user_id=current_user.id,
            entry_date=normalized_date,
            content=payload.content,
            analysis={},
        )
        db.add(entry)
    else:
        entry.content = payload.content
    db.commit()
    db.refresh(entry)
    return journal_entry_read(normalized_date, entry)


@router.post("/entries/{entry_date}/analyse", response_model=JournalAnalysisResponse)
async def analyse_journal_entry(
    entry_date: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_journal_user),
) -> JournalAnalysisResponse:
    normalized_date = validated_entry_date(entry_date)
    entry = find_entry(db, current_user.id, normalized_date)
    if entry is None or len(entry.content.strip()) < 20:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Write a little more before asking FeelY to find map insights.",
        )

    result = await analyse_journal_text(entry.content, normalized_date)
    analysed_at = utc_now().isoformat()
    suggestions = [
        {
            "id": uuid4().hex,
            **suggestion,
            "status": "pending",
            "created_at": analysed_at,
            "saved_item_id": None,
        }
        for suggestion in result.suggestions
    ]
    entry.analysis = {
        "analysed_at": analysed_at,
        "source_content_hash": content_hash(entry.content),
        "suggestions": suggestions,
    }
    db.commit()
    db.refresh(entry)
    return JournalAnalysisResponse(entry=journal_entry_read(normalized_date, entry))


@router.post(
    "/entries/{entry_date}/suggestions/{suggestion_id}",
    response_model=JournalSuggestionDecisionResponse,
)
def decide_journal_suggestion(
    entry_date: str,
    suggestion_id: str,
    payload: JournalSuggestionDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_journal_user),
) -> JournalSuggestionDecisionResponse:
    normalized_date = validated_entry_date(entry_date)
    entry = find_entry(db, current_user.id, normalized_date)
    if entry is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journal entry not found")

    analysis = dict(entry.analysis or {})
    suggestions = [dict(item) for item in stored_suggestions(entry)]
    suggestion = next((item for item in suggestions if item.get("id") == suggestion_id), None)
    if suggestion is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suggestion not found")
    if suggestion.get("status") != "pending":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Suggestion was already reviewed")

    if not payload.accepted:
        suggestion["status"] = "dismissed"
    else:
        profile = get_or_create_profile(db, current_user)
        if suggestion.get("kind") == "topic":
            title = (payload.title or suggestion.get("title") or "").strip()
            description = (payload.text or suggestion.get("text") or "").strip()
            if not payload.topic_space_id and (not title or not description):
                raise HTTPException(status_code=422, detail="Topic title and description are required")
            try:
                if payload.topic_space_id:
                    profile_data, saved_item = link_journal_to_topic_space(
                        profile.data,
                        topic_space_id=payload.topic_space_id,
                        journal_date=normalized_date,
                    )
                else:
                    profile_data, saved_item = create_topic_space(
                        profile.data,
                        title=title,
                        description=description,
                        journal_date=normalized_date,
                    )
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        else:
            category = payload.category or suggestion.get("category")
            text = (payload.text or suggestion.get("text") or "").strip()
            if category not in ENTRY_CATEGORIES or not text:
                raise HTTPException(status_code=422, detail="A valid map category and text are required")
            try:
                profile_data, saved_item = add_map_entry(
                    profile.data,
                    category=category,
                    text=text,
                    topic_space_id=payload.topic_space_id,
                    source_journal_date=normalized_date,
                    reason=suggestion.get("reason"),
                )
            except LookupError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
        profile.data = profile_data
        suggestion["status"] = "saved"
        suggestion["saved_item_id"] = saved_item["id"]

    analysis["suggestions"] = suggestions
    entry.analysis = analysis
    db.commit()
    db.refresh(entry)
    profile_data = current_user.profile.data if current_user.profile else {}
    return JournalSuggestionDecisionResponse(
        suggestion=JournalSuggestion(**suggestion),
        map=read_map(profile_data),
    )
