"""Replace only the example/missing signing secret; never print it."""
from pathlib import Path
import re
import secrets

from dotenv import dotenv_values


def main():
    path = Path(__file__).resolve().parents[1] / ".env"
    text = path.read_text(encoding="utf-8")
    current = dotenv_values(path).get("SECRET_KEY") or ""
    if current != "change-this-secret-before-deploying" and len(current) >= 32:
        print("An existing signing secret is configured; left unchanged.")
        return
    line = f'SECRET_KEY="{secrets.token_urlsafe(48)}"'
    updated, count = re.subn(r"^SECRET_KEY=.*$", lambda _: line, text, flags=re.MULTILINE)
    if not count:
        updated = text.rstrip() + "\n" + line + "\n"
    path.write_text(updated, encoding="utf-8")
    print("Random signing secret saved. Restart the backend; sign in again.")


if __name__ == "__main__":
    main()
