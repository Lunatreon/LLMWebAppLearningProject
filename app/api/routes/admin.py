import hmac
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_admin, get_db, rate_limit_auth
from app.core.config import settings
from app.core.security import create_admin_access_token, hash_password, verify_password
from app.models.user import User
from app.schemas.admin import (
    AdminLoginRequest,
    AdminPasswordReset,
    AdminPromptBundle,
    AdminPromptRead,
    AdminPromptUpdate,
    AdminStatus,
    AdminSubscriptionReset,
    AdminToken,
    AdminUserRead,
    AdminUserUpdate,
)
from app.services.billing import (
    BillingNotConfiguredError,
    BillingProviderError,
    get_subscription,
    normalize_subscription,
    remove_subscription_for_admin,
)
from app.services.llm import PromptConfigurationError, read_system_prompt, write_system_prompt

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/login", response_model=AdminToken, dependencies=[Depends(rate_limit_auth)])
def login_admin(payload: AdminLoginRequest) -> AdminToken:
    username = (settings.admin_username or "").strip()
    password_hash = (settings.admin_password_hash or "").strip()
    if not username or not password_hash:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator login is not configured.",
        )
    valid_username = hmac.compare_digest(payload.username, username)
    valid_password = verify_password(payload.password, password_hash)
    if not valid_username or not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect administrator username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return AdminToken(access_token=create_admin_access_token(username))


def admin_user_read(db: Session, user: User) -> AdminUserRead:
    subscription = get_subscription(db, user)
    normalized = normalize_subscription(subscription)
    return AdminUserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        is_active=user.is_active,
        is_email_verified=user.is_email_verified,
        auth_provider=user.auth_provider,
        created_at=user.created_at,
        last_login_at=user.last_login_at,
        subscription_status=normalized["status"].value,
        subscription_plan=normalized["plan"],
        premium=normalized["premium"],
        stripe_subscription=bool(subscription and subscription.stripe_subscription_id),
    )


@router.get("/status", response_model=AdminStatus)
def read_admin_status(admin_username: str = Depends(get_current_admin)) -> AdminStatus:
    return AdminStatus(username=admin_username)


@router.get("/users", response_model=list[AdminUserRead])
def list_admin_users(
    db: Session = Depends(get_db),
    _: str = Depends(get_current_admin),
) -> list[AdminUserRead]:
    users = db.execute(select(User).order_by(User.created_at.desc())).scalars()
    return [admin_user_read(db, user) for user in users]


def admin_target_user(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/users/{user_id}", response_model=AdminUserRead)
def update_admin_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    admin_username: str = Depends(get_current_admin),
) -> AdminUserRead:
    user = admin_target_user(db, user_id)

    if payload.email is not None:
        email = str(payload.email).strip().lower()
        duplicate = db.scalar(select(User).where(User.id != user.id, User.email == email))
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="Email is already in use.")
        user.email = email
    if payload.username is not None:
        duplicate = db.scalar(
            select(User).where(
                User.id != user.id,
                func.lower(User.username) == payload.username.lower(),
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="Username is already in use.")
        user.username = payload.username
    if "display_name" in payload.model_fields_set:
        user.display_name = payload.display_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.is_email_verified is not None:
        user.is_email_verified = payload.is_email_verified

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Could not update that user.") from exc
    db.refresh(user)
    logger.info("Administrator %s updated user %s", admin_username, user.id)
    return admin_user_read(db, user)


@router.post("/users/{user_id}/password", response_model=AdminUserRead)
def reset_admin_user_password(
    user_id: int,
    payload: AdminPasswordReset,
    db: Session = Depends(get_db),
    admin_username: str = Depends(get_current_admin),
) -> AdminUserRead:
    user = admin_target_user(db, user_id)
    user.hashed_password = hash_password(payload.new_password)
    if "password" not in user.auth_provider:
        user.auth_provider = f"{user.auth_provider},password"
    db.commit()
    db.refresh(user)
    logger.info("Administrator %s reset password for user %s", admin_username, user.id)
    return admin_user_read(db, user)


@router.post("/users/{user_id}/subscription/remove", response_model=AdminUserRead)
def remove_admin_user_subscription(
    user_id: int,
    _: AdminSubscriptionReset,
    db: Session = Depends(get_db),
    admin_username: str = Depends(get_current_admin),
) -> AdminUserRead:
    user = admin_target_user(db, user_id)
    try:
        remove_subscription_for_admin(db, user)
    except BillingNotConfiguredError:
        raise HTTPException(status_code=503, detail="Stripe billing is not configured.") from None
    except BillingProviderError:
        raise HTTPException(status_code=502, detail="Stripe could not cancel the subscription.") from None
    logger.info("Administrator %s removed subscription for user %s", admin_username, user.id)
    return admin_user_read(db, user)


@router.get("/prompts", response_model=AdminPromptBundle)
def read_admin_prompts(_: str = Depends(get_current_admin)) -> AdminPromptBundle:
    def editable_text(kind: Literal["chat", "topic", "journal"]) -> str:
        try:
            return read_system_prompt(kind)
        except PromptConfigurationError:
            # Keep the editor usable so an administrator can repair a missing
            # or empty prompt file. Model requests still fail clearly until it
            # contains a valid prompt.
            return ""

    return AdminPromptBundle(
        prompts=[
            AdminPromptRead(kind="chat", text=editable_text("chat")),
            AdminPromptRead(kind="topic", text=editable_text("topic")),
            AdminPromptRead(kind="journal", text=editable_text("journal")),
        ]
    )


@router.put("/prompts/{kind}", response_model=AdminPromptRead)
def update_admin_prompt(
    kind: Literal["chat", "topic", "journal"],
    payload: AdminPromptUpdate,
    admin_username: str = Depends(get_current_admin),
) -> AdminPromptRead:
    text = write_system_prompt(kind, payload.text)
    logger.info("Administrator %s updated %s system prompt", admin_username, kind)
    return AdminPromptRead(kind=kind, text=text)
