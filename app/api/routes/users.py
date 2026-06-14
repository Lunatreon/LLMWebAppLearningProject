from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User, UserProfile
from app.schemas.profile import (
    MapEntryCreate,
    MapEntryCreateResponse,
    PracticeUpdate,
    PracticeUpdateResponse,
    ProfileRead,
    ProfileUpdate,
    SelfAuthorshipMapRead,
)
from app.schemas.user import UserRead
from app.services.self_authorship import add_map_entry, read_map, update_practice

router = APIRouter()


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.get("/me/profile", response_model=ProfileRead)
def read_current_user_profile(current_user: User = Depends(get_current_user)) -> ProfileRead:
    profile = current_user.profile
    return ProfileRead(data=profile.data if profile else {})


@router.put("/me/profile", response_model=ProfileRead)
def update_current_user_profile(
    payload: ProfileUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProfileRead:
    profile = current_user.profile
    if profile is None:
        profile = UserProfile(user_id=current_user.id, data={})
        db.add(profile)

    profile.data = payload.data
    db.commit()
    db.refresh(profile)
    return ProfileRead(data=profile.data)


def get_or_create_profile(db: Session, current_user: User) -> UserProfile:
    profile = current_user.profile
    if profile is None:
        profile = UserProfile(user_id=current_user.id, data={})
        db.add(profile)
        db.flush()
    return profile


@router.get("/me/map", response_model=SelfAuthorshipMapRead)
def read_self_authorship_map(
    current_user: User = Depends(get_current_user),
) -> SelfAuthorshipMapRead:
    profile_data = current_user.profile.data if current_user.profile else {}
    return SelfAuthorshipMapRead(**read_map(profile_data))


@router.post("/me/map/entries", response_model=MapEntryCreateResponse)
def create_map_entry(
    payload: MapEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MapEntryCreateResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, entry = add_map_entry(
            profile.data,
            category=payload.category,
            text=payload.text,
            topic_space_id=payload.topic_space_id,
            source_chat_id=payload.source_chat_id,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return MapEntryCreateResponse(entry=entry, map=read_map(profile.data))


@router.patch("/me/map/practices/{entry_id}", response_model=PracticeUpdateResponse)
def change_practice_status(
    entry_id: str,
    payload: PracticeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PracticeUpdateResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, practice = update_practice(
            profile.data,
            entry_id=entry_id,
            practice_status=payload.status,
            reflection=payload.reflection,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return PracticeUpdateResponse(practice=practice, map=read_map(profile.data))
