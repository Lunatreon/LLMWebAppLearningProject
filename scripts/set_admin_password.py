from __future__ import annotations

import argparse
import getpass
import re
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.core.security import hash_password  # noqa: E402


def replace_setting(text: str, name: str, value: str) -> str:
    line = f'{name}="{value}"'
    pattern = re.compile(rf"^{re.escape(name)}=.*$", re.MULTILINE)
    if pattern.search(text):
        return pattern.sub(line, text)
    separator = "" if not text or text.endswith("\n") else "\n"
    return f"{text}{separator}{line}\n"


def main() -> None:
    parser = argparse.ArgumentParser(description="Configure the separate FeelY administrator login.")
    parser.add_argument("--env-file", default=str(ROOT_DIR / ".env.docker"))
    parser.add_argument("--username", default="admin")
    args = parser.parse_args()

    username = args.username.strip()
    if not username or len(username) > 120:
        raise SystemExit("Admin username must contain between 1 and 120 characters.")

    password = getpass.getpass("New admin password: ")
    confirmation = getpass.getpass("Repeat admin password: ")
    if password != confirmation:
        raise SystemExit("Passwords do not match.")
    if len(password) < 12 or len(password) > 256:
        raise SystemExit("Admin password must contain between 12 and 256 characters.")

    env_path = Path(args.env_file).resolve()
    text = env_path.read_text(encoding="utf-8") if env_path.exists() else ""
    text = replace_setting(text, "ADMIN_USERNAME", username)
    text = replace_setting(text, "ADMIN_PASSWORD_HASH", hash_password(password))
    temporary_path = env_path.with_suffix(env_path.suffix + ".tmp")
    temporary_path.write_text(text, encoding="utf-8")
    temporary_path.replace(env_path)
    print(f"Administrator '{username}' configured. Recreate the backend container before logging in.")


if __name__ == "__main__":
    main()
