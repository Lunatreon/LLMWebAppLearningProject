from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_db, rate_limit_auth
from app.core.captcha import captcha_public_config, verify_registration_captcha
from app.core.config import settings
from app.core.email_verification import (
    create_email_verification_token,
    email_verification_is_expired,
    hash_email_verification_token,
    send_email_verification_message,
)
from app.core.google_auth import (
    google_email_is_authoritative,
    google_public_config,
    verify_google_credential,
)
from app.core.password_reset import (
    create_password_reset_token,
    hash_password_reset_token,
    password_reset_is_expired,
    send_password_reset_message,
)
from app.core.rate_limit import client_ip, enforce_rate_limit
from app.core.security import create_access_token, hash_password, verify_password
from app.models.user import User, UserProfile, utc_now
from app.schemas.auth import (
    CaptchaConfig,
    EmailVerificationConfirmRequest,
    EmailVerificationConfirmResponse,
    EmailVerificationRequest,
    EmailVerificationRequestResponse,
    GoogleAuthConfig,
    GoogleLoginRequest,
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    Token,
)
from app.schemas.user import UserCreate, UserRead

router = APIRouter()


def token_for_user(user: User, db: Session) -> Token:
    user.last_login_at = utc_now()
    db.commit()
    return Token(access_token=create_access_token(subject=str(user.id)))


def unique_google_username(db: Session, email: str, name: str | None) -> str:
    base = (name or email.split("@", 1)[0]).strip().lower()
    base = "".join(character if character.isalnum() else "_" for character in base)
    base = "_".join(part for part in base.split("_") if part)[:40] or "google_user"

    candidate = base
    suffix = 1
    while db.scalar(select(User).where(func.lower(User.username) == candidate.lower())):
        suffix += 1
        candidate = f"{base}_{suffix}"[:80]
    return candidate


@router.get("/captcha/config", response_model=CaptchaConfig)
def read_captcha_config() -> CaptchaConfig:
    return CaptchaConfig(**captcha_public_config())


@router.get("/google/config", response_model=GoogleAuthConfig)
def read_google_config() -> GoogleAuthConfig:
    return GoogleAuthConfig(**google_public_config())


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
        display_name=username,
        hashed_password=hash_password(payload.password),
        auth_provider="password",
        is_email_verified=not settings.email_verification_enabled,
    )
    user.profile = UserProfile(data={})
    verification_token = (
        create_email_verification_token(user) if settings.email_verification_enabled else None
    )
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
    if verification_token:
        send_email_verification_message(user, verification_token)
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

    if user is None or not user.is_active or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email, username, or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if settings.email_verification_required and not user.is_email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

    return token_for_user(user, db)


@router.post("/google", response_model=Token, dependencies=[Depends(rate_limit_auth)])
def login_with_google(
    payload: GoogleLoginRequest,
    db: Session = Depends(get_db),
) -> Token:
    google_payload = verify_google_credential(payload.credential)
    google_sub = str(google_payload["sub"])
    email = str(google_payload["email"]).strip().lower()
    name = google_payload.get("name")
    picture = google_payload.get("picture")
    email_verified = bool(google_payload.get("email_verified"))

    user = db.scalar(select(User).where(User.google_sub == google_sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == email))
        if user is not None:
            if not user.is_active:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Could not validate credentials",
                )
            if not google_email_is_authoritative(google_payload):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Use your existing login before connecting this Google account.",
                )
            if user.google_sub and user.google_sub != google_sub:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="This email is already connected to another Google account.",
                )
            user.google_sub = google_sub
            user.auth_provider = "google"
        else:
            user = User(
                email=email,
                username=unique_google_username(db, email, str(name) if name else None),
                display_name=str(name).strip() if name else None,
                avatar_url=str(picture).strip() if picture else None,
                hashed_password="",
                auth_provider="google",
                google_sub=google_sub,
                is_email_verified=email_verified,
                email_verified_at=utc_now() if email_verified else None,
                profile=UserProfile(data={}),
            )
            db.add(user)
    elif not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    if name and not user.display_name:
        user.display_name = str(name).strip()
    if picture and not user.avatar_url:
        user.avatar_url = str(picture).strip()
    if email_verified and not user.is_email_verified:
        user.is_email_verified = True
        user.email_verified_at = utc_now()
        user.email_verification_token_hash = None
        user.email_verification_sent_at = None

    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not connect this Google account.",
        ) from exc

    return token_for_user(user, db)


@router.post(
    "/email-verification/request",
    response_model=EmailVerificationRequestResponse,
    dependencies=[Depends(rate_limit_auth)],
)
def request_email_verification(
    payload: EmailVerificationRequest,
    db: Session = Depends(get_db),
) -> EmailVerificationRequestResponse:
    generic_response = EmailVerificationRequestResponse(
        sent=True,
        detail="If that account exists and needs verification, an email has been sent.",
    )
    if not settings.email_verification_enabled:
        return EmailVerificationRequestResponse(
            sent=False,
            detail="Email verification is not enabled.",
        )

    user = db.scalar(select(User).where(User.email == str(payload.email).lower()))
    if user is None or user.is_email_verified:
        return generic_response

    token = create_email_verification_token(user)
    db.commit()
    db.refresh(user)
    send_email_verification_message(user, token)
    return generic_response


@router.post("/email-verification/confirm", response_model=EmailVerificationConfirmResponse)
def confirm_email_verification(
    payload: EmailVerificationConfirmRequest,
    db: Session = Depends(get_db),
) -> EmailVerificationConfirmResponse:
    token_hash = hash_email_verification_token(payload.token)
    user = db.scalar(
        select(User).where(User.email_verification_token_hash == token_hash)
    )
    if user is None or email_verification_is_expired(user.email_verification_sent_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification link is invalid or expired.",
        )

    user.is_email_verified = True
    user.email_verified_at = utc_now()
    user.email_verification_token_hash = None
    user.email_verification_sent_at = None
    db.commit()
    return EmailVerificationConfirmResponse(
        verified=True,
        detail="Email verified.",
    )


@router.post(
    "/password-reset/request",
    response_model=PasswordResetRequestResponse,
    dependencies=[Depends(rate_limit_auth)],
)
def request_password_reset(
    payload: PasswordResetRequest,
    db: Session = Depends(get_db),
) -> PasswordResetRequestResponse:
    if not settings.password_reset_enabled or not settings.email_delivery_configured:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset email is not configured.",
        )

    email = str(payload.email).strip().lower()
    enforce_rate_limit(
        f"password-reset:{email}",
        max_attempts=settings.rate_limit_password_reset_identifier_per_hour,
        window_seconds=3600,
        detail="Too many password reset requests. Please try again later.",
    )
    generic_response = PasswordResetRequestResponse(
        sent=True,
        detail="If that account exists, a password reset email has been sent.",
    )
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active:
        return generic_response

    token = create_password_reset_token(user)
    db.commit()
    db.refresh(user)
    send_password_reset_message(user, token)
    return generic_response


@router.post(
    "/password-reset/confirm",
    response_model=PasswordResetConfirmResponse,
    dependencies=[Depends(rate_limit_auth)],
)
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    db: Session = Depends(get_db),
) -> PasswordResetConfirmResponse:
    token_hash = hash_password_reset_token(payload.token)
    user = db.scalar(select(User).where(User.password_reset_token_hash == token_hash))
    if user is None or password_reset_is_expired(user.password_reset_sent_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset link is invalid or expired.",
        )

    user.hashed_password = hash_password(payload.new_password)
    if "password" not in user.auth_provider:
        user.auth_provider = f"{user.auth_provider},password"
    user.password_reset_token_hash = None
    user.password_reset_sent_at = None
    db.commit()
    return PasswordResetConfirmResponse(
        reset=True,
        detail="Your password has been reset. You can now log in.",
    )
