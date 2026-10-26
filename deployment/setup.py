"""Generate the local Docker environment without overwriting existing settings."""

import argparse
import base64
import json
import os
from pathlib import Path
import secrets
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def create_environment(path: Path) -> bool:
    if path.exists():
        return False
    template = (ROOT / "deployment/.env.example").read_text(encoding="utf-8")
    password = secrets.token_urlsafe(32)
    text = template.replace("__POSTGRES_PASSWORD__", password)
    text = text.replace("__DATABASE_PASSWORD__", quote(password, safe=""))
    text = text.replace("__SECRET_KEY__", secrets.token_urlsafe(48))
    text = text.replace("__CONTENT_KEY__", base64.b64encode(secrets.token_bytes(32)).decode())
    # Exclusive creation also prevents a race from overwriting an existing config.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
    return True


def ensure_content_key(path):
    # Explicit upgrade only. Never replace a configured key, including an invalid
    # one: it may be needed to recover existing ciphertext.
    import re

    text = path.read_text(encoding="utf-8")
    if re.search(r"(?m)^CONTENT_ENCRYPTION_KEYS=", text):
        return False
    key = base64.b64encode(secrets.token_bytes(32)).decode()
    text = (
        text.rstrip()
        + "\nCONTENT_ENCRYPTION_KEYS='"
        + json.dumps({"primary": key})
        + "'\nCONTENT_ENCRYPTION_KEY_ID=primary\n"
    )
    temporary = path.with_name(path.name + ".content-key.tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".env.docker")
    parser.add_argument(
        "--ensure-content-key",
        action="store_true",
        help="Add a missing encryption key to an existing env file; preserve all configured keys.",
    )
    args = parser.parse_args()
    if args.ensure_content_key and args.output.exists():
        ensure_content_key(args.output)
        print(
            "Encryption-key upgrade checked; existing keys preserved. Back up the private env file."
        )
        return
    if create_environment(args.output):
        print(
            "Local Docker environment created; secrets were not printed. Existing .env unchanged."
        )
    else:
        print("Docker environment already exists; left unchanged.")


if __name__ == "__main__":
    main()
