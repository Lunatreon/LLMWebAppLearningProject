from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserProfile
from app.schemas.auth import LoginRequest, Token
from app.schemas.user import UserCreate, UserRead

router = APIRouter()


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    existing_user = db.scalar(
        select(User).where((User.email == payload.email) | (User.username == payload.username))
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email or username already exists",
        )

    user = User(
        email=str(payload.email).lower(),
        username=payload.username,
        hashed_password=hash_password(payload.password),
    )
    user.profile = UserProfile(data={})
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> Token:
    identifier = payload.email_or_username.lower()
    user = db.scalar(
        select(User).where((User.email == identifier) | (User.username == payload.email_or_username))
    )

    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email, username, or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return Token(access_token=create_access_token(subject=str(user.id)))
