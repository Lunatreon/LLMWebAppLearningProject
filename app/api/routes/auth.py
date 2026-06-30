from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_db, rate_limit_auth
from app.core.captcha import captcha_public_config, verify_registration_captcha
from app.core.config import settings
from app.core.rate_limit import client_ip, enforce_rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserProfile
from app.schemas.auth import CaptchaConfig, LoginRequest, Token
from app.schemas.user import UserCreate, UserRead

router = APIRouter()


@router.get("/captcha/config", response_model=CaptchaConfig)
def read_captcha_config() -> CaptchaConfig:
    return CaptchaConfig(**captcha_public_config())


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(rate_limit_auth)],
)
def register(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    if payload.website and payload.website.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not create account",
        )

    enforce_rate_limit(
        f"register-hour:{client_ip(request)}",
        max_attempts=settings.rate_limit_register_ip_per_hour,
        window_seconds=3600,
        detail="Too many account creations from this network. Please try again later.",
    )
    verify_registration_captcha(payload.captcha_token, request)

    email = str(payload.email).strip().lower()
    username = payload.username.strip()
    username_lookup = username.lower()
    existing_user = db.scalar(
        select(User).where(
            (User.email == email) | (func.lower(User.username) == username_lookup)
        )
    )
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email or username already exists",
        )

    user = User(
        email=email,
        username=username,
        hashed_password=hash_password(payload.password),
    )
    user.profile = UserProfile(data={})
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email or username already exists",
        ) from exc
    db.refresh(user)
    return user


@router.post("/login", response_model=Token, dependencies=[Depends(rate_limit_auth)])
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> Token:
    identifier = payload.email_or_username.strip()
    identifier_lookup = identifier.lower()
    enforce_rate_limit(
        f"login-identifier:{identifier_lookup}",
        max_attempts=settings.rate_limit_login_identifier_attempts,
        window_seconds=settings.rate_limit_login_identifier_window_seconds,
        detail="Too many login attempts for this account. Please wait and try again.",
    )
    user = db.scalar(
        select(User).where(
            (User.email == identifier_lookup) | (func.lower(User.username) == identifier_lookup)
        )
    )

    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email, username, or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return Token(access_token=create_access_token(subject=str(user.id)))
