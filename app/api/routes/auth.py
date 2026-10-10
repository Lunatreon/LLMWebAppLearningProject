from datetime import timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_db, rate_limit_auth
from app.core.captcha import captcha_public_config, verify_registration_captcha
from app.core.config import settings
from app.core.email_verification import (
    create_email_verification_token,
    email_verification_is_expired,
    hash_email_verification_token,
    hash_email_verification_pin,
    send_email_verification_message,
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
    LoginRequest,
    PasswordResetConfirmRequest,
    PasswordResetConfirmResponse,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    Token,
)
from app.schemas.user import UserCreate, UserRead
from app.models.terms import TermsAcceptance
from app.services.terms import terms_config

router = APIRouter()


@router.get("/email/config")
def read_email_config() -> dict[str, bool]:
    return {
        "verification_enabled": settings.email_verification_enabled,
        "password_reset_enabled": settings.password_reset_enabled,
    }


def token_for_user(user: User, db: Session) -> Token:
    if (settings.email_verification_enabled or settings.email_verification_required) and not user.is_email_verified:
        db.commit()
        raise HTTPException(status_code=403, detail="Please verify your email before logging in.")
    user.last_login_at = utc_now()
    db.commit()
    return Token(access_token=create_access_token(subject=str(user.id)))


@router.get("/captcha/config", response_model=CaptchaConfig)
def read_captcha_config() -> CaptchaConfig:
    return CaptchaConfig(**captcha_public_config())


@router.get("/android/config")
def read_android_config():
    """Public discovery metadata, not proof of an app's identity or authorization."""
    enabled = settings.android_app_enabled
    return {
        "enabled": enabled,
        "package_name": settings.android_package_name or None,
        "password_login_enabled": enabled,
        "token_type": "bearer",
        "access_token_expires_in_seconds": settings.access_token_expire_minutes * 60,
        "endpoints": {name: settings.api_v1_prefix + path for name, path in {
            "register": "/auth/register", "login": "/auth/login",
            "captcha_config": "/auth/captcha/config", "email_config": "/auth/email/config",
            "verify_email": "/auth/email-verification/confirm",
            "password_reset_request": "/auth/password-reset/request",
            "password_reset_confirm": "/auth/password-reset/confirm",
            "terms_config": "/terms/config", "terms_status": "/terms/me", "terms_accept": "/terms/accept",
        }.items()},
    }


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
    current_terms = terms_config()
    if current_terms["configured"]:
        if not payload.terms_accepted:
            raise HTTPException(422, "Please explicitly accept the FeelY terms before creating an account.")
        if (payload.terms_version != current_terms["version"] or
                payload.terms_document_sha256 != current_terms["document_sha256"]):
            raise HTTPException(409, "The terms changed. Read the current version and check the acceptance box again.")
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
        if current_terms["configured"]:
            db.flush()
            db.add(TermsAcceptance(user_id=user.id, version=current_terms["version"],
                document_url=current_terms["document_url"], document_sha256=current_terms["document_sha256"],
                client="api"))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A user with this email or username already exists",
        ) from exc
    db.refresh(user)
    if verification_token:
        try:
            send_email_verification_message(user, verification_token)
        except HTTPException as exc:
            raise HTTPException(
                status_code=502,
                detail="Your account was created, but the activation email could not be sent. Use Activate account to request a new PIN.",
            ) from exc
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

    if (settings.email_verification_enabled or settings.email_verification_required) and not user.is_email_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in.",
        )

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

    email = str(payload.email).strip().lower()
    enforce_rate_limit(
        f"verification-send:{email}", max_attempts=3, window_seconds=3600,
        detail="Too many code requests. Please try again in an hour.",
    )
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not user.is_active or user.is_email_verified:
        return generic_response

    token = create_email_verification_token(user)
    send_email_verification_message(user, token)
    db.commit()
    return generic_response


@router.post("/email-verification/confirm", response_model=EmailVerificationConfirmResponse,
             dependencies=[Depends(rate_limit_auth)])
def confirm_email_verification(
    payload: EmailVerificationConfirmRequest,
    db: Session = Depends(get_db),
) -> EmailVerificationConfirmResponse:
    invalid = HTTPException(status_code=400, detail="Verification code or link is invalid or expired. Request a new code.")
    if payload.pin is not None:
        email = str(payload.email).lower()
        enforce_rate_limit(
            f"verification-confirm:{email}", max_attempts=10, window_seconds=900,
            detail="Too many verification attempts. Please wait before trying again.",
        )
        user = db.scalar(select(User).where(User.email == email))
        if user is None or not user.is_active or user.is_email_verified or not user.email_verification_sent_at:
            raise invalid
        sent_at = user.email_verification_sent_at
        if sent_at.tzinfo is None:
            sent_at = sent_at.replace(tzinfo=timezone.utc)
        if utc_now() > sent_at + timedelta(minutes=settings.email_verification_pin_expire_minutes):
            raise invalid
        # Persist attempts atomically, including failures; this survives restarts.
        changed = db.execute(update(User).where(
            User.id == user.id,
            User.email_verification_token_hash == user.email_verification_token_hash,
            User.email_verification_attempts < settings.email_verification_max_attempts,
        ).values(email_verification_attempts=User.email_verification_attempts + 1),
            execution_options={"synchronize_session": False})
        db.commit()
        if not changed.rowcount:
            raise invalid
        token_hash = hash_email_verification_pin(email, payload.pin)
    else:
        # Keep already-issued, high-entropy verification links working.
        token_hash = hash_email_verification_token(payload.token)
        user = db.scalar(select(User).where(User.email_verification_token_hash == token_hash))
        if user is None or not user.is_active or email_verification_is_expired(user.email_verification_sent_at):
            raise invalid

    changed = db.execute(update(User).where(
        User.id == user.id, User.is_email_verified.is_(False),
        User.email_verification_token_hash == token_hash,
    ).values(is_email_verified=True, email_verified_at=utc_now(),
             email_verification_token_hash=None, email_verification_sent_at=None,
             email_verification_attempts=0))
    if not changed.rowcount:
        db.rollback()
        raise invalid
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
    send_password_reset_message(user, token)
    db.commit()
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
    if user is None or not user.is_active or password_reset_is_expired(user.password_reset_sent_at):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password reset link is invalid or expired.",
        )

    changed = db.execute(update(User).where(
        User.id == user.id, User.is_active.is_(True), User.password_reset_token_hash == token_hash,
    ).values(hashed_password=hash_password(payload.new_password), auth_provider="password",
             password_reset_token_hash=None, password_reset_sent_at=None))
    if not changed.rowcount:
        db.rollback()
        raise HTTPException(status_code=400, detail="Password reset link is invalid or expired.")
    db.commit()
    return PasswordResetConfirmResponse(
        reset=True,
        detail="Your password has been reset. You can now log in.",
    )
