import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt

from backend.core.config import settings

PASSWORD_ALGORITHM = "pbkdf2_sha256"
PASSWORD_ITERATIONS = 600_000
TOKEN_ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "$".join(
        [
            PASSWORD_ALGORITHM,
            str(PASSWORD_ITERATIONS),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(password_hash).decode("ascii"),
        ]
    )


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        algorithm, iterations, salt, password_hash = hashed_password.split("$", 3)
        if algorithm != PASSWORD_ALGORITHM:
            return False

        calculated_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            base64.urlsafe_b64decode(salt.encode("ascii")),
            int(iterations),
        )
        return hmac.compare_digest(
            calculated_hash,
            base64.urlsafe_b64decode(password_hash.encode("ascii")),
        )
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expires_at = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.access_token_expire_minutes)
    )
    payload = {"sub": subject, "token_type": "user", "exp": expires_at}
    return jwt.encode(payload, settings.secret_key, algorithm=TOKEN_ALGORITHM)


def create_admin_access_token(username: str, *, user_id: int | None = None) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=settings.admin_access_token_expire_minutes
    )
    payload = {
        "sub": username,
        "token_type": "admin",
        "exp": expires_at,
    }
    if user_id is not None:
        payload["admin_user_id"] = user_id
    return jwt.encode(payload, settings.secret_key, algorithm=TOKEN_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.secret_key, algorithms=[TOKEN_ALGORITHM])
