from collections.abc import Generator
import hmac

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import client_fingerprint, enforce_rate_limit
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User
from app.services.billing import has_premium_feature_access

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")
admin_oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl=f"{settings.api_v1_prefix}/admin/login",
    scheme_name="AdminBearer",
)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def rate_limit_api(request: Request) -> None:
    enforce_rate_limit(
        f"api:{client_fingerprint(request)}",
        max_attempts=settings.rate_limit_api_per_minute,
        window_seconds=60,
    )


def rate_limit_auth(request: Request) -> None:
    enforce_rate_limit(
        f"auth:{client_fingerprint(request)}",
        max_attempts=settings.rate_limit_auth_ip_per_minute,
        window_seconds=60,
        detail="Too many account attempts. Please wait a moment and try again.",
    )


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        # Tokens created before token types were introduced remain valid, but an
        # administrator token must never be accepted by the user API.
        if subject is None or payload.get("token_type") not in (None, "user"):
            raise credentials_error
        user_id = int(subject)
    except (InvalidTokenError, ValueError):
        raise credentials_error from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_error

    return user


def get_current_premium_user(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    """Require the locally verified subscription entitlement for premium features."""

    if not has_premium_feature_access(db, current_user):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail="Premium is required to access My Map.",
        )
    return current_user


def get_current_admin(
    token: str = Depends(admin_oauth2_scheme),
) -> str:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate administrator credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    configured_username = (settings.admin_username or "").strip()
    if not configured_username or not settings.admin_password_hash:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrator login is not configured.",
        )
    try:
        payload = decode_access_token(token)
        subject = str(payload.get("sub") or "")
        if payload.get("token_type") != "admin" or not hmac.compare_digest(
            subject,
            configured_username,
        ):
            raise credentials_error
    except InvalidTokenError:
        raise credentials_error from None
    return configured_username
