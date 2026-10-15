"""Generate a separate local Docker environment without changing SQLite config."""

import argparse
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
    # Exclusive creation also prevents a race from overwriting an existing config.
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".env.docker")
    args = parser.parse_args()
    if create_environment(args.output):
        print(
            "Local Docker environment created; secrets were not printed. Existing .env unchanged."
        )
    else:
        print("Docker environment already exists; left unchanged.")


if __name__ == "__main__":
    main()
