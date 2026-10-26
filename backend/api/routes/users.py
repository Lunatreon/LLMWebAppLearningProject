from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_premium_user, get_current_user, get_db
from backend.core.config import settings
from backend.core.security import hash_password, verify_password
from backend.models.user import User, UserProfile
from backend.schemas.profile import (
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
    TopicSpaceMerge,
    TopicSpaceResponse,
    TopicSpaceUpdate,
)
from backend.schemas.user import (
    AccountDeleteRequest,
    PasswordChangeRequest,
    UserAccountRead,
    UserAccountUpdate,
    UserRead,
)
from backend.services.billing import has_premium_feature_access
from backend.services.self_authorship import (
    add_map_entry,
    create_topic_space,
    delete_map_entry,
    delete_topic_space,
    merge_topic_spaces,
    preserve_premium_profile_fields,
    profile_data_for_access,
    read_map,
    update_map_entry,
    update_practice,
    update_topic_space,
)

router = APIRouter()


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user


def account_read(user: User) -> UserAccountRead:
    return UserAccountRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        bio=user.bio,
        avatar_url=user.avatar_url,
        is_email_verified=user.is_email_verified,
        is_active=user.is_active,
        role=user.role,
        created_at=user.created_at,
        auth_provider=user.auth_provider,
        has_password=bool(user.hashed_password),
        email_verified_at=user.email_verified_at,
        last_login_at=user.last_login_at,
    )


@router.get("/me/account", response_model=UserAccountRead)
def read_current_user_account(current_user: User = Depends(get_current_user)) -> UserAccountRead:
    return account_read(current_user)


@router.patch("/me/account", response_model=UserAccountRead)
def update_current_user_account(
    payload: UserAccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserAccountRead:
    if payload.email is not None:
        email = str(payload.email).strip().lower()
        existing_email = db.scalar(
            select(User).where(User.id != current_user.id, User.email == email)
        )
        if existing_email is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this email already exists",
            )
        if email != current_user.email:
            current_user.email = email
            current_user.is_email_verified = not settings.email_verification_enabled
            current_user.email_verified_at = None
            current_user.email_verification_token_hash = None
            current_user.email_verification_sent_at = None

    if payload.username is not None:
        username = payload.username.strip()
        existing_username = db.scalar(
            select(User).where(
                User.id != current_user.id,
                func.lower(User.username) == username.lower(),
            )
        )
        if existing_username is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A user with this username already exists",
            )
        current_user.username = username

    if "display_name" in payload.model_fields_set:
        current_user.display_name = payload.display_name
    if "bio" in payload.model_fields_set:
        current_user.bio = payload.bio
    if "avatar_url" in payload.model_fields_set:
        current_user.avatar_url = payload.avatar_url

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not update account with those values",
        ) from exc
    db.refresh(current_user)
    return account_read(current_user)


@router.patch("/me/password", response_model=UserAccountRead)
def change_current_user_password(
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserAccountRead:
    if current_user.hashed_password and not verify_password(
        payload.current_password or "",
        current_user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Current password is incorrect",
        )

    current_user.hashed_password = hash_password(payload.new_password)
    current_user.auth_provider = "password"
    db.commit()
    db.refresh(current_user)
    return account_read(current_user)


@router.delete("/me/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_current_user_account(
    payload: AccountDeleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    if current_user.hashed_password and not verify_password(
        payload.password or "",
        current_user.hashed_password,
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password is required to delete this account",
        )

    db.delete(current_user)
    db.commit()


@router.get("/me/profile", response_model=ProfileRead)
def read_current_user_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProfileRead:
    profile = current_user.profile
    return ProfileRead(
        data=profile_data_for_access(
            profile.data if profile else {},
            premium_access=has_premium_feature_access(db, current_user),
        )
    )


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

    profile.data = (
        payload.data
        if has_premium_feature_access(db, current_user)
        else preserve_premium_profile_fields(profile.data, payload.data)
    )
    db.commit()
    db.refresh(profile)
    return ProfileRead(
        data=profile_data_for_access(
            profile.data,
            premium_access=has_premium_feature_access(db, current_user),
        )
    )


def get_or_create_profile(db: Session, current_user: User) -> UserProfile:
    profile = current_user.profile
    if profile is None:
        profile = UserProfile(user_id=current_user.id, data={})
        db.add(profile)
        db.flush()
    return profile


@router.get("/me/map", response_model=SelfAuthorshipMapRead)
def read_self_authorship_map(
    current_user: User = Depends(get_current_premium_user),
) -> SelfAuthorshipMapRead:
    profile_data = current_user.profile.data if current_user.profile else {}
    return SelfAuthorshipMapRead(**read_map(profile_data))


@router.post("/me/map/topics", response_model=TopicSpaceResponse)
def create_map_topic(
    payload: TopicSpaceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_premium_user),
) -> TopicSpaceResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = create_topic_space(
            profile.data,
            title=payload.title,
            category=payload.category if "category" in payload.model_fields_set else None,
            description=payload.description,
            chat_id=payload.chat_id,
            parent_topic_id=payload.parent_topic_id,
            related_topic_ids=payload.related_topic_ids,
        )
    except (LookupError, ValueError) as exc:
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
    current_user: User = Depends(get_current_premium_user),
) -> TopicSpaceResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = update_topic_space(
            profile.data,
            topic_space_id=topic_space_id,
            title=payload.title,
            category=payload.category,
            description=payload.description,
            parent_topic_id=payload.parent_topic_id,
            update_parent="parent_topic_id" in payload.model_fields_set,
            related_topic_ids=payload.related_topic_ids,
            update_related="related_topic_ids" in payload.model_fields_set,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return TopicSpaceResponse(topic=topic, map=read_map(profile.data))


@router.post("/me/map/topics/{topic_space_id}/merge", response_model=TopicSpaceResponse)
def merge_map_topic(
    topic_space_id: str,
    payload: TopicSpaceMerge,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_premium_user),
) -> TopicSpaceResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = merge_topic_spaces(
            profile.data,
            source_topic_space_id=topic_space_id,
            target_topic_space_id=payload.target_topic_space_id,
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
    current_user: User = Depends(get_current_premium_user),
) -> TopicSpaceDeleteResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, topic = delete_topic_space(profile.data, topic_space_id=topic_space_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return TopicSpaceDeleteResponse(deleted=True, topic=topic, map=read_map(profile.data))


@router.post("/me/map/entries", response_model=MapEntryCreateResponse)
def create_map_entry(
    payload: MapEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_premium_user),
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
    current_user: User = Depends(get_current_premium_user),
) -> MapEntryUpdateResponse:
    profile = get_or_create_profile(db, current_user)
    try:
        profile_data, entry = update_map_entry(
            profile.data,
            entry_id=entry_id,
            category=payload.category,
            text=payload.text,
            reason=payload.reason,
            topic_space_id=payload.topic_space_id,
            move_entry="topic_space_id" in payload.model_fields_set,
        )
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile.data = profile_data
    db.commit()
    db.refresh(profile)
    return MapEntryUpdateResponse(entry=entry, map=read_map(profile.data))


@router.delete("/me/map/entries/{entry_id}", response_model=MapEntryDeleteResponse)
def remove_map_entry(
    entry_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_premium_user),
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
    current_user: User = Depends(get_current_premium_user),
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
