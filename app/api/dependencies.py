from collections.abc import Generator

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rate_limit import client_fingerprint, enforce_rate_limit
from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.api_v1_prefix}/auth/login")


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
        if subject is None:
            raise credentials_error
        user_id = int(subject)
    except (InvalidTokenError, ValueError):
        raise credentials_error from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_error

    return user
