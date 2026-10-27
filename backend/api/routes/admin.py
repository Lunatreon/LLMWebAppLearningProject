import hmac
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.api.dependencies import get_current_admin, get_db, rate_limit_auth
from backend.core.config import settings
from backend.core.security import create_admin_access_token, hash_password, verify_password
from backend.models.user import User
from backend.schemas.admin import (
    AdminLoginRequest,
    AdminMapCategoryWrite,
    AdminPasswordReset,
    AdminPromptBundle,
    AdminPromptRead,
    AdminPromptUpdate,
    AdminStatus,
    AdminSubscriptionReset,
    AdminToken,
    AdminUserCreate,
    AdminUserRead,
    AdminUserUpdate,
)
from backend.schemas.app_settings import AppPreferencesWrite
from backend.services.billing import (
    BillingNotConfiguredError,
    BillingProviderError,
    get_subscription,
    normalize_subscription,
    remove_subscription_for_admin,
)
from backend.llm.prompts import (
    PromptConfigurationError,
    read_system_prompt,
    write_system_prompt,
)

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/settings")
def read_app_settings(db: Session = Depends(get_db), _: str = Depends(get_current_admin)):
    from backend.services.app_settings import read_settings

    return read_settings(db)


@router.put("/settings")
def update_app_settings(
    payload: AppPreferencesWrite, db: Session = Depends(get_db), _: str = Depends(get_current_admin)
):
    from backend.services.app_settings import save_settings

    return save_settings(
        db, payload.model_dump(exclude={"expected_revision"}), payload.expected_revision
    )


@router.delete("/settings")
def reset_app_settings(
    expected_revision: int, db: Session = Depends(get_db), _: str = Depends(get_current_admin)
):
    from backend.services.app_settings import save_settings

    return save_settings(db, {}, expected_revision)


@router.delete("/users/{user_id}", status_code=204)
def delete_admin_user(
    user_id: int,
    confirmation: str,
    db: Session = Depends(get_db),
    admin_username: str = Depends(get_current_admin),
):
    user = admin_target_user(db, user_id)
    if confirmation != user.username:
        raise HTTPException(status_code=400, detail="Type the username to confirm deletion.")
    if user.username == admin_username:
        raise HTTPException(
            status_code=400, detail="You cannot delete your own administrator account."
        )
    subscription = get_subscription(db, user)
    if subscription and subscription.stripe_subscription_id and subscription.status != "canceled":
        raise HTTPException(
            status_code=409, detail="Cancel the Stripe subscription before deleting this account."
        )
    if (
        user.role == "admin"
        and user.is_active
        and not (settings.admin_username and settings.admin_password_hash)
    ):
        remaining = db.scalar(
            select(func.count(User.id)).where(
                User.role == "admin", User.is_active.is_(True), User.id != user.id
            )
        )
        if not remaining:
            raise HTTPException(status_code=409, detail="Keep at least one active administrator.")
    db.delete(user)
    db.commit()
    logger.info("Administrator %s deleted user %s", admin_username, user_id)


@router.delete("/map/categories/{kind}/{key}", status_code=204)
def delete_map_category(
    kind: str,
    key: str,
    db: Session = Depends(get_db),
    _: str = Depends(get_current_admin),
):
    from backend.models.map import MapCategory

    if (kind, key) in {("topic", "other"), ("entry", "merged_topic")}:
        raise HTTPException(status_code=400, detail="This system category cannot be deleted.")
    category = db.get(MapCategory, (kind, key))
    if category is None:
        raise HTTPException(status_code=404, detail="Category not found.")
    try:
        db.delete(category)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="This category is used by existing map content. Disable it instead.",
        ) from None


@router.post("/login", response_model=AdminToken, dependencies=[Depends(rate_limit_auth)])
def login_admin(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> AdminToken:
    username = (settings.admin_username or "").strip()
    password_hash = (settings.admin_password_hash or "").strip()
    if username and password_hash:
        valid_username = hmac.compare_digest(payload.username, username)
        valid_password = verify_password(payload.password, password_hash)
        if valid_username and valid_password:
            return AdminToken(access_token=create_admin_access_token(username))
    user = db.scalar(
        select(User).where(
            (func.lower(User.username) == payload.username.strip().lower())
            | (func.lower(User.email) == payload.username.strip().lower())
        )
    )
    if (
        user
        and user.is_active
        and user.role == "admin"
        and verify_password(payload.password, user.hashed_password)
    ):
        return AdminToken(access_token=create_admin_access_token(user.username, user_id=user.id))
    if not username or not password_hash:
        if not db.scalar(select(User.id).where(User.role == "admin").limit(1)):
            raise HTTPException(status_code=503, detail="Administrator login is not configured.")
    raise HTTPException(
        status_code=401,
        detail="Incorrect administrator username or password.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def admin_user_read(db: Session, user: User) -> AdminUserRead:
    subscription = get_subscription(db, user)
    normalized = normalize_subscription(subscription)
    return AdminUserRead(
        id=user.id,
        email=user.email,
        username=user.username,
        display_name=user.display_name,
        is_active=user.is_active,
        role=user.role,
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


@router.post("/users", response_model=AdminUserRead, status_code=201)
def create_admin_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    admin_username: str = Depends(get_current_admin),
) -> AdminUserRead:
    if db.scalar(select(User.id).where(func.lower(User.username) == payload.username.lower())):
        raise HTTPException(status_code=409, detail="Username is already in use.")
    user = User(
        email=str(payload.email).lower(),
        username=payload.username,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        display_name=payload.display_name,
        is_email_verified=False,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Email or username is already in use.") from exc
    db.refresh(user)
    logger.info("Administrator %s created user %s with role %s", admin_username, user.id, user.role)
    return admin_user_read(db, user)


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
    if payload.role is not None:
        user.role = payload.role
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
    user.auth_provider = "password"
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
        raise HTTPException(
            status_code=502, detail="Stripe could not cancel the subscription."
        ) from None
    logger.info("Administrator %s removed subscription for user %s", admin_username, user.id)
    return admin_user_read(db, user)


@router.get("/prompts", response_model=AdminPromptBundle)
def read_admin_prompts(_: str = Depends(get_current_admin)) -> AdminPromptBundle:
    def editable_text(kind: Literal["chat", "topic"]) -> str:
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
        ]
    )


@router.put("/prompts/{kind}", response_model=AdminPromptRead)
def update_admin_prompt(
    kind: Literal["chat", "topic"],
    payload: AdminPromptUpdate,
    admin_username: str = Depends(get_current_admin),
) -> AdminPromptRead:
    text = write_system_prompt(kind, payload.text)
    logger.info("Administrator %s updated %s system prompt", admin_username, kind)
    return AdminPromptRead(kind=kind, text=text)


@router.get("/map/categories")
def list_map_categories(db: Session = Depends(get_db), admin: str = Depends(get_current_admin)):
    from backend.services.map_categories import activate

    return activate(db.connection())


@router.put("/map/categories/{kind}/{key}")
def save_map_category(
    kind: str,
    key: str,
    payload: AdminMapCategoryWrite,
    db: Session = Depends(get_db),
    admin: str = Depends(get_current_admin),
):
    import re
    from backend.models.map import MapCategory
    from backend.services.map_categories import activate

    if kind not in {"topic", "entry"} or not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", key):
        raise HTTPException(status_code=422, detail="Invalid category kind or stable key.")
    if (kind, key) in {("topic", "other"), ("entry", "merged_topic")} and not payload.active:
        raise HTTPException(status_code=400, detail="This system category must remain active.")
    if (kind, key) == ("topic", "other") and not payload.llm_enabled:
        raise HTTPException(
            status_code=400,
            detail="The fallback topic category must remain available to the model.",
        )
    if (kind, key) == ("entry", "merged_topic") and payload.llm_enabled:
        raise HTTPException(
            status_code=400, detail="Merged-topic provenance is not an LLM suggestion category."
        )
    if not payload.label.strip():
        raise HTTPException(status_code=422, detail="Category label cannot be blank.")
    category = db.get(MapCategory, (kind, key))
    if category is None:
        category = MapCategory(kind=kind, key=key)
        db.add(category)
    for field, value in payload.model_dump().items():
        setattr(category, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="The category changed concurrently; reload and retry."
        ) from None
    return next(
        row for row in activate(db.connection()) if row["kind"] == kind and row["key"] == key
    )
