from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User, UserProfile
from app.schemas.profile import ProfileRead, ProfileUpdate
from app.schemas.user import UserRead

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
