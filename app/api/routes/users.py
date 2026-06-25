from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User, UserProfile
from app.schemas.profile import (
    MapEntryCreate,
    MapEntryCreateResponse,
    MapEntryDeleteResponse,
    MapEntryUpdate,
    MapEntryUpdateResponse,
    PracticeUpdate,
    PracticeUpdateResponse,
    ProfileRead,
    ProfileUpdate,
    SelfAuthorshipMapRead,
    TopicSpaceCreate,
    TopicSpaceDeleteResponse,
    TopicSpaceResponse,
    TopicSpaceUpdate,
)
from app.schemas.user import UserRead
from app.services.self_authorship import (
    add_map_entry,
    create_topic_space,
    delete_map_entry,
    delete_topic_space,
    read_map,
    update_topic_space,
    update_map_entry,
    update_practice,
)

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


@router.post("/me/map/topics", response_model=TopicSpaceResponse)
def create_map_topic(
    payload: TopicSpaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicSpaceResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = create_topic_space(
            profile.data,
            title=payload.title,
            description=payload.description,
            chat_id=payload.chat_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return TopicSpaceResponse(topic=topic, map=read_map(profile.data))


@router.patch("/me/map/topics/{topic_space_id}", response_model=TopicSpaceResponse)
def change_map_topic(
    topic_space_id: str,
    payload: TopicSpaceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicSpaceResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = update_topic_space(
            profile.data,
            topic_space_id=topic_space_id,
            title=payload.title,
            description=payload.description,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return TopicSpaceResponse(topic=topic, map=read_map(profile.data))


@router.delete("/me/map/topics/{topic_space_id}", response_model=TopicSpaceDeleteResponse)
def remove_map_topic(
    topic_space_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TopicSpaceDeleteResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = delete_topic_space(profile.data, topic_space_id=topic_space_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return TopicSpaceDeleteResponse(deleted=True, topic=topic, map=read_map(profile.data))


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


@router.patch("/me/map/entries/{entry_id}", response_model=MapEntryUpdateResponse)
def change_map_entry(
    entry_id: str,
    payload: MapEntryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MapEntryUpdateResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, entry = update_map_entry(
            profile.data,
            entry_id=entry_id,
            category=payload.category,
            text=payload.text,
            reason=payload.reason,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return MapEntryUpdateResponse(entry=entry, map=read_map(profile.data))


@router.delete("/me/map/entries/{entry_id}", response_model=MapEntryDeleteResponse)
def remove_map_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MapEntryDeleteResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, entry = delete_map_entry(profile.data, entry_id=entry_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return MapEntryDeleteResponse(deleted=True, entry=entry, map=read_map(profile.data))


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
