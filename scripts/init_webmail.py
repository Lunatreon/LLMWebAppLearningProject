"""Idempotently configure webmail in the backend .env without printing secrets."""
import argparse
import json
from pathlib import Path
import re
import secrets
import tomllib
from urllib.parse import urlsplit

from dotenv import dotenv_values
from email_validator import validate_email

ROOT = Path(__file__).resolve().parents[1]


def initialize(config_path, env_path):
    config = tomllib.loads(config_path.read_text(encoding="utf-8"))["webmail"]
    address = validate_email(config["address"], check_deliverability=False).normalized
    sender = validate_email(config["auth_sender"], check_deliverability=False).normalized
    url = config.get("worker_url", "").rstrip("/")
    parsed = urlsplit(url)
    if url and (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path):
        raise ValueError("worker_url must be an HTTPS origin, without credentials, path, or query")
    if not env_path.is_file():
        raise ValueError("Create the backend .env first; see README.md")
    values = dotenv_values(env_path)
    secret = values.get("WEBMAIL_BRIDGE_SECRET") or secrets.token_urlsafe(48)
    if len(secret) < 32:
        raise ValueError("Existing WEBMAIL_BRIDGE_SECRET is too short")
    updates = {"WEBMAIL_ENABLED":"true", "WEBMAIL_ADDRESS":address,
               "WEBMAIL_WORKER_URL":url, "WEBMAIL_BRIDGE_SECRET":secret,
               "SMTP_FROM_EMAIL":sender, "FEEDBACK_EMAIL_TO":address}
    text = env_path.read_text(encoding="utf-8")
    for key, value in updates.items():
        line = key + "=" + json.dumps(value)
        text, count = re.subn(r"(?m)^" + key + r"=.*$", lambda _: line, text)
        if not count:
            text = text.rstrip() + "\n" + line + "\n"
    env_path.write_text(text, encoding="utf-8")
    print("Webmail configured. Existing SMTP and admin credentials preserved.")
    print("Restart the backend; open /webmail.html on the FeelY website.")
    if not url:
        print("Incoming sync is pending: deploy the Worker, set worker_url, and rerun this initializer.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "webmail.init.toml")
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    args = parser.parse_args()
    initialize(args.config, args.env_file)
