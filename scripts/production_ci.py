"""Offline production configuration/build rehearsal in an owned disposable Docker project."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys

from scripts.docker_integration import leaked_secrets, poll, redact
from deployment.production import (
    ROOT,
    check_compose,
    compose_command,
    load_production,
    write_backend_environment,
)


def create_fixture(directory, project):
    if not re.fullmatch(r"feely-prod-ci-[a-z0-9-]+", project):
        raise RuntimeError("Refusing a non-CI production project name.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    password = secrets.token_urlsafe(32)
    replacements = {
        "url-safe-app-db-password": password,
        "same-url-safe-app-db-password-as-DATABASE_URL": password,
        "separate-random-bootstrap-db-password": secrets.token_urlsafe(32),
        "random-jwt-signing-secret-at-least-32-characters": secrets.token_urlsafe(48),
        "app-domain": "ci-app.example.invalid",
        "certificate-contact-email": "ci@example.invalid",
        "smtp-provider-host": "smtp.example.invalid",
        "smtp-username": "ci-only",
        "smtp-password": secrets.token_urlsafe(32),
        "verified-sender-mailbox": "ci@example.invalid",
        "production-public-site-key": "ci-public-not-a-real-site-key",
        "production-secret-key": "ci-private-not-a-real-turnstile-key",
        "backend-only-openai-api-key": "ci-dummy-not-a-real-openai-key",
        "published-terms-version": "ci-terms-v1",
        "document-host": "ci-app.example.invalid",
        "terms-document.pdf": "terms.pdf",
        "64-lowercase-hex-digest-of-the-published-document": "a" * 64,
    }
    text = (ROOT / "deployment/.env.production.example").read_text(encoding="utf-8")
    for name, value in replacements.items():
        text = text.replace(f"<{name}>", value)
    target = directory / ".env.production.backend"
    text = text.replace(
        "FEELY_PRODUCTION_APP_ENV_FILE=.env.production.backend",
        f"FEELY_PRODUCTION_APP_ENV_FILE={target.as_posix()}",
    )
    master = directory / ".env.production"
    with master.open("x", encoding="utf-8") as stream:
        os.chmod(master, 0o600)
        stream.write(text)
    config, _ = load_production(master)
    write_backend_environment(config, target)
    (directory / "project.txt").write_text(project)
    print("Prepared dummy production configuration; no real provider credentials or requests.")


class Rehearsal:
    def __init__(self, directory):
        self.directory = directory
        self.master = directory / ".env.production"
        self.config, self.values = load_production(self.master)
        self.project = (directory / "project.txt").read_text().strip()
        if not re.fullmatch(r"feely-prod-ci-[a-z0-9-]+", self.project):
            raise RuntimeError("Refusing to operate on a non-CI project.")
        self.command, self.environment = compose_command(
            self.master, self.values, project=self.project
        )
        secret_names = {
            "SECRET_KEY",
            "POSTGRES_PASSWORD",
            "POSTGRES_APP_PASSWORD",
            "SMTP_PASSWORD",
            "TURNSTILE_SECRET_KEY",
            "OPENAI_API_KEY",
            "ANTHROPIC_API_KEY",
            "STRIPE_SECRET_KEY",
            "STRIPE_WEBHOOK_SECRET",
            "WEBMAIL_BRIDGE_SECRET",
        }
        self.private = [
            value for name, value in self.values.items() if name in secret_names and value
        ]

    def run(self, arguments, *, timeout=120):
        result = subprocess.run(
            [*self.command, *arguments],
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=ROOT,
        )
        with (self.directory / "commands.log").open("a", encoding="utf-8") as stream:
            stream.write(redact(result.stdout + result.stderr, self.private))
        if result.returncode:
            raise RuntimeError("Production CI command failed; see sanitized diagnostics.")
        return result

    def validate(self):
        check_compose(self.config, self.values, self.command, self.environment)
        for kind, arguments in (
            (
                "containers",
                [
                    "docker",
                    "ps",
                    "-aq",
                    "--filter",
                    f"label=com.docker.compose.project={self.project}",
                ],
            ),
            (
                "volumes",
                [
                    "docker",
                    "volume",
                    "ls",
                    "-q",
                    "--filter",
                    f"label=com.docker.compose.project={self.project}",
                ],
            ),
        ):
            existing = subprocess.run(arguments, capture_output=True, text=True, timeout=15)
            if existing.returncode or existing.stdout.strip():
                raise RuntimeError(f"Refusing an unavailable daemon or pre-existing CI {kind}.")
        (self.directory / "owned-project").touch(exist_ok=False)
        # Missing config fails before any connection, without making real provider calls.
        for field in (
            "secret_key",
            "openai_api_key",
            "turnstile_secret_key",
            "smtp_host",
            "public_app_url",
        ):
            altered = self.config.model_copy(update={field: ""})
            try:
                altered.validate_runtime_security()
            except RuntimeError:
                continue
            raise RuntimeError(f"Missing {field.upper()} was not rejected.")
        print(
            "PASS: production Compose, three services, no Mailpit/public DB/API ports, isolated secrets and missing-config guards."
        )

    def build(self):
        self.run(["build", "--pull", "backend", "caddy"], timeout=600)
        self.run(
            [
                "run",
                "--rm",
                "--no-deps",
                "caddy",
                "caddy",
                "validate",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ]
        )
        print(
            "PASS: production backend/React/Caddy image builds and Caddy configuration validation. No certificate request or public listener started."
        )

    def runtime(self):
        # Do not start Caddy here: no public port binding, certificate issuance, SMTP or LLM call.
        self.run(["up", "-d", "postgres", "backend"])

        def healthy():
            for name in ("postgres", "backend"):
                container = self.run(["ps", "--all", "-q", name]).stdout.strip()
                state = subprocess.run(
                    ["docker", "inspect", "--format", "{{json .State}}", container],
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                if state.returncode:
                    raise RuntimeError("Could not inspect production CI service health.")
                state = json.loads(state.stdout)
                if state["Status"] in ("exited", "dead"):
                    raise RuntimeError("Production CI service exited before readiness.")
                if state.get("Health", {}).get("Status") != "healthy":
                    return False
            return True

        poll(healthy, timeout=180)
        self.run(["exec", "-T", "backend", "python", "-m", "deployment.healthcheck"])
        # The real startup rejects administrative roles before Alembic. Exercise a sequence/write
        # inside a rollback, retaining the fresh application DB and all HTTP contracts.
        source = """
from sqlalchemy import text
from backend.db.session import engine
with engine.connect() as connection:
    role = connection.execute(text("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user")).one()
    assert not any(role)
    transaction = connection.get_transaction()
    connection.execute(text(
        "INSERT INTO users "
        "(email, username, hashed_password, is_active, is_email_verified, created_at, "
        "updated_at, auth_provider, role, email_verification_attempts) "
        "VALUES ('ci@example.invalid', 'ci-owner-probe', 'not-a-login-hash', true, false, "
        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'password', 'member', 0) RETURNING id"
    )).scalar_one()
    transaction.rollback()
engine.dispose()
"""
        result = subprocess.run(
            [*self.command, "exec", "-T", "backend", "python", "-"],
            input=source,
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode:
            raise RuntimeError("Non-superuser production role query/sequence/write probe failed.")
        print(
            "PASS: fresh production PostgreSQL role initialization, non-superuser Alembic startup, sequence/write rollback and HTTP+DB health."
        )

    def logs(self):
        result = subprocess.run(
            [*self.command, "logs", "--no-color"],
            env=self.environment,
            capture_output=True,
            text=True,
            timeout=30,
        )
        output = result.stdout + result.stderr
        sanitized = redact(output, self.private)
        (self.directory / "containers.log").write_text(sanitized, encoding="utf-8")
        print(sanitized[-20000:])
        if result.returncode or leaked_secrets(output, self.private):
            raise RuntimeError(
                "Production CI log collection/secret scan failed; output is redacted."
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "check", "build", "run", "logs", "cleanup"))
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--project", default="")
    args = parser.parse_args()
    try:
        if args.action == "prepare":
            create_fixture(args.directory, args.project)
            return
        if not (args.directory / "project.txt").exists() and args.action in ("logs", "cleanup"):
            return
        rehearsal = Rehearsal(args.directory)
        if args.action == "check":
            rehearsal.validate()
        elif (args.directory / "owned-project").exists():
            if args.action == "build":
                rehearsal.build()
            elif args.action == "run":
                rehearsal.runtime()
            elif args.action == "logs":
                rehearsal.logs()
            elif args.action == "cleanup":
                rehearsal.run(["down", "-v", "--remove-orphans"])
                print("PASS: disposable production CI resources removed.")
        else:
            raise RuntimeError("Production CI project ownership was not established.")
    except Exception:
        print(f"FAIL: production CI {args.action}; inspect sanitized logs.", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
