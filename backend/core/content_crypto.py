"""Authenticated field encryption; the database never receives encryption keys."""

import base64
import json
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.core.config import settings


def content_key(key_id, config=None):
    config = config or settings
    try:
        key = base64.b64decode(config.content_encryption_keys[key_id], validate=True)
        if len(key) != 32:
            raise ValueError
    except (KeyError, ValueError, TypeError):
        raise RuntimeError(
            "Configure CONTENT_ENCRYPTION_KEYS with a valid 32-byte base64 key."
        ) from None
    return key


def validate_content_keys(config=None):
    config = config or settings
    content_key(config.content_encryption_key_id, config)


def encrypt(value, *, owner, row, field, key_id):
    if value is None:
        return None
    nonce = os.urandom(12)
    aad = json.dumps(["feely-map-v1", owner, row, field], separators=(",", ":")).encode()
    return nonce + AESGCM(content_key(key_id)).encrypt(nonce, value.encode("utf-8"), aad)


def decrypt(value, *, owner, row, field, key_id):
    if value is None:
        return None
    aad = json.dumps(["feely-map-v1", owner, row, field], separators=(",", ":")).encode()
    try:
        return AESGCM(content_key(key_id)).decrypt(value[:12], value[12:], aad).decode("utf-8")
    except RuntimeError:
        raise
    except Exception:
        raise RuntimeError(
            "Map content could not be decrypted or failed its integrity check."
        ) from None
