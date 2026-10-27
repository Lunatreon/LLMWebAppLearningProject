"""Exercise only a disposable feely-ci-* Compose project; never the local reference stack."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import quote
from urllib.request import urlopen

from deployment.setup import ROOT, create_environment

JWT = re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")
RESET = re.compile(r"(?i)([?&](?:reset_password_token|reset_token|token|reset)=)[^\s&\"<>]+")
ACTIVATION_PIN = re.compile(r"(?i)(activation PIN is:\s*)\d{6}")
DB_CREDENTIALS = re.compile(r"(postgres(?:ql)?(?:\+psycopg)?://[^:\s/]+:)[^@\s]+(@)")
API_KEY = re.compile(r"\b(?:sk-(?:proj-|ant-)?)[A-Za-z0-9_-]{16,}\b")
PASSWORD_FIELD = re.compile(
    r"(?i)((?:[\"']?(?:password|secret_key|api_key|access_token|reset_token)[\"']?)"
    r"\s*[:=]\s*)(?:\"[^\"]+\"|'[^']+'|[^\s,}]+)"
)
PHASES = (
    "compose-config",
    "image-build",
    "fresh-postgres",
    "health",
    "alembic",
    "networking-permissions",
    "http-mailpit",
    "persistence",
    "graceful-shutdown",
    "volume-reset",
    "secret-scan",
)


class CheckFailed(RuntimeError):
    """Only fixed, non-sensitive messages may cross the process boundary."""


def validate_rehearsal_snapshot(snapshot):
    """The HTTP rehearsal saves one account, conversation and completed map practice."""
    expected = {
        "users": 1,
        "user_profiles": 1,
        "chat_sessions": 1,
        "chat_turns": 1,
        "user_maps": 1,
        "map_topics": 1,
        "map_entries": 1,
        "terms_acceptances": 1,
        # Journal history is retained for transfers, but the app no longer creates it.
        "journal_entries": 0,
    }
    for name, count in expected.items():
        actual = snapshot.get("counts", {}).get(name)
        if type(actual) is not int or actual != count:
            observed = str(actual) if type(actual) is int else "missing or invalid"
            raise CheckFailed(
                f"HTTP rehearsal persistence mismatch: {name} expected {count} rows, observed {observed}"
            )


def redact(text, secrets):
    for secret in sorted(set(secrets), key=len, reverse=True):
        if secret:
            text = text.replace(secret, "[REDACTED]")
            text = text.replace(quote(secret, safe=""), "[REDACTED]")
    text = JWT.sub("[REDACTED-JWT]", text)
    text = RESET.sub(r"\1[REDACTED]", text)
    text = ACTIVATION_PIN.sub(r"\1[REDACTED]", text)
    text = DB_CREDENTIALS.sub(r"\1[REDACTED]\2", text)
    text = API_KEY.sub("[REDACTED-API-KEY]", text)
    return PASSWORD_FIELD.sub(r"\1[REDACTED]", text)


def leaked_secrets(text, secrets):
    return any(secret and secret in text for secret in secrets) or any(
        pattern.search(text)
        for pattern in (JWT, RESET, ACTIVATION_PIN, DB_CREDENTIALS, API_KEY, PASSWORD_FIELD)
    )


def poll(check, *, timeout=180, interval=1):
    deadline = time.monotonic() + timeout
    while True:
        if check():
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise CheckFailed("Bounded readiness polling timed out")
        time.sleep(min(interval, remaining))


def read_values(path):
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value.strip().strip("\"'")
    return values


class DockerIntegration:
    def __init__(self, directory):
        self.directory = directory.resolve()
        self.config = self.directory / ".env.docker"
        self.report_file = self.directory / "report.json"
        self.report = json.loads(self.report_file.read_text()) if self.report_file.exists() else {}
        self.project = (self.directory / "project.txt").read_text(encoding="utf-8").strip()
        if not re.fullmatch(r"feely-ci-[a-z0-9][a-z0-9-]{0,40}", self.project):
            raise CheckFailed("Refusing a project outside the disposable feely-ci-* namespace")
        self.values = read_values(self.config)
        self.api_url = f"http://127.0.0.1:{int(self.values['FEELY_API_PORT'])}"
        self.mailpit_url = f"http://127.0.0.1:{int(self.values['FEELY_MAILPIT_PORT'])}"
        # Shell env must not override generated CI values with a developer's real secrets/DB.
        self.environment = {k: v for k, v in os.environ.items() if k not in self.values}
        self.environment["FEELY_DOCKER_ENV_FILE"] = str(self.config)
        self.command = [
            "docker",
            "compose",
            "--project-directory",
            str(ROOT),
            "-f",
            str(ROOT / "compose.yml"),
            "--env-file",
            str(self.config),
            "--project-name",
            self.project,
        ]

    def secrets(self):
        return [
            json.loads(line)
            for line in (self.directory / "secrets.jsonl").read_text().splitlines()
            if line
        ]

    def save(self, phase, result):
        self.report[phase] = result
        self.report_file.write_text(json.dumps(self.report, indent=2) + "\n")
        print(f"{phase}: {result}", flush=True)

    def execute(self, command, *, stdin=None, timeout=60, required=True):
        try:
            result = subprocess.run(
                command,
                input=stdin,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                env=self.environment,
                cwd=ROOT,
            )
        except subprocess.TimeoutExpired:
            raise CheckFailed("A bounded Docker integration command timed out") from None
        output = result.stdout + result.stderr
        # Never stream raw errors, config, inspect output, HTTP responses or container logs.
        if result.returncode and required:
            (self.directory / "command-error.log").write_text(
                redact(output, self.secrets()), encoding="utf-8"
            )
            raise CheckFailed("Docker integration command failed; see sanitized diagnostics")
        return result

    def compose(self, *args, **kwargs):
        return self.execute([*self.command, *args], **kwargs)

    def container(self, service):
        result = self.compose("ps", "--all", "--quiet", service)
        container = result.stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{12,64}", container):
            raise CheckFailed("Expected exactly one container for the service")
        return container

    def state(self, service):
        container = self.container(service)
        result = self.execute(["docker", "inspect", "--format", "{{json .State}}", container])
        return json.loads(result.stdout)

    def wait_healthy(self, services):
        def healthy():
            states = [self.state(service) for service in services]
            if any(state["Status"] in ("exited", "dead") for state in states):
                raise CheckFailed("A service exited before becoming healthy")
            return all(state.get("Health", {}).get("Status") == "healthy" for state in states)

        poll(healthy)

    def probe(self, mode):
        source = (ROOT / "deployment/docker_checks.py").read_text()
        result = self.compose("exec", "-T", "backend", "python", "-", mode, stdin=source)
        return json.loads(result.stdout)

    def collect_logs(self, label):
        result = self.compose("logs", "--no-color", "--timestamps", required=False)
        raw = result.stdout + result.stderr
        secrets = self.secrets()
        (self.directory / f"{label}.log").write_text(redact(raw, secrets), encoding="utf-8")
        # Latch a finding before down removes containers; later clean logs cannot hide it.
        if leaked_secrets(raw, secrets):
            self.save("secret-scan", "FAIL")
            raise CheckFailed("Sensitive material found in container logs; output redacted")
        if result.returncode:
            raise CheckFailed("Could not collect container logs")

    def smoke(self, *, verify_saved=False):
        self.environment.update(
            {
                "FEELY_LOCAL_STACK_CHECK": "1",
                "FEELY_CHECK_SNAPSHOT": "0",
                "FEELY_STACK_API_URL": self.api_url,
                "FEELY_STACK_MAILPIT_URL": self.mailpit_url,
                "FEELY_STACK_APP_URL": self.values["PUBLIC_APP_URL"],
                "FEELY_STACK_PRIVATE_DIR": str(self.directory),
                "FEELY_STACK_VERIFY_SAVED": "1" if verify_saved else "0",
            }
        )
        self.execute(["node", "scripts/validate-local-stack.mjs"], timeout=150)

    def run(self):
        self.save("fresh-postgres", "RUNNING")
        # No backend exists yet: the empty catalogue proves startup migrations do real work.
        self.compose("up", "-d", "postgres", "mailpit", timeout=180)
        self.wait_healthy(("postgres", "mailpit"))
        empty = self.compose(
            "exec",
            "-T",
            "postgres",
            "psql",
            "-U",
            "feely",
            "-d",
            "feely",
            "-At",
            "-c",
            "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'",
        )
        if empty.stdout.strip() != "0":
            raise CheckFailed("Fresh PostgreSQL was not empty before backend startup")
        self.save("fresh-postgres", "PASS")
        self.save("health", "RUNNING")
        self.compose("up", "-d", "backend", "frontend", timeout=180)
        self.wait_healthy(("postgres", "mailpit", "backend", "frontend"))
        with urlopen(self.values["PUBLIC_APP_URL"], timeout=5) as response:
            if response.status != 200 or b'id="root"' not in response.read():
                raise CheckFailed("Compiled frontend did not serve the application")
        with urlopen(self.api_url + "/api/v1/health", timeout=5) as response:
            if json.load(response) != {"status": "ok"}:
                raise CheckFailed("HTTP health response mismatch")
        self.save("health", "PASS")
        self.save("alembic", "RUNNING")
        fresh = self.probe("snapshot")
        if any(count for name, count in fresh["counts"].items() if name != "map_categories"):
            raise CheckFailed("Startup unexpectedly seeded domain rows")
        self.compose("exec", "-T", "backend", "python", "-m", "alembic", "upgrade", "head")
        # CLI and programmatic checks both use the running container's configuration.
        self.compose("exec", "-T", "backend", "python", "-m", "alembic", "current")
        self.compose("exec", "-T", "backend", "python", "-m", "alembic", "heads")
        if self.probe("snapshot") != fresh:
            raise CheckFailed("Alembic upgrade head was not idempotent")
        self.save("alembic", "PASS")
        self.save("networking-permissions", "RUNNING")
        self.probe("runtime")
        self.save("networking-permissions", "PASS")
        self.save("http-mailpit", "RUNNING")
        self.smoke()
        self.save("http-mailpit", "PASS")
        self.save("persistence", "RUNNING")
        before = self.probe("snapshot")
        validate_rehearsal_snapshot(before)
        self.collect_logs("initial")
        self.compose("down", "--remove-orphans", timeout=90)
        self.compose("up", "-d", timeout=180)
        self.wait_healthy(("postgres", "mailpit", "backend", "frontend"))
        # Compare before login updates last_login_at; every stored column must survive.
        if self.probe("snapshot") != before:
            raise CheckFailed("Database rows changed across down/up with volumes preserved")
        self.smoke(verify_saved=True)
        self.save("persistence", "PASS")
        self.save("graceful-shutdown", "RUNNING")
        started = time.monotonic()
        self.compose("stop", "--timeout", "20", "backend", timeout=30)
        state = self.state("backend")
        if state["Running"] or state["ExitCode"] != 0 or state["OOMKilled"]:
            raise CheckFailed("Backend did not exit cleanly on normal stop")
        if time.monotonic() - started >= 30:
            raise CheckFailed("Backend shutdown exceeded the time bound")
        logs = self.compose("logs", "--no-color", "backend").stdout
        if (
            "Traceback (most recent call last)" in logs
            or "Application shutdown complete" not in logs
        ):
            raise CheckFailed("Normal shutdown was incomplete or emitted a traceback")
        self.save("graceful-shutdown", "PASS")
        self.collect_logs("restart-shutdown")
        self.save("volume-reset", "RUNNING")
        self.compose("down", "-v", "--remove-orphans", timeout=90)
        self.compose("up", "-d", timeout=180)
        self.wait_healthy(("postgres", "mailpit", "backend", "frontend"))
        reset = self.probe("snapshot")
        if reset != fresh:
            raise CheckFailed("Explicit volume reset did not produce a fresh migrated database")
        self.probe("runtime")
        with urlopen(self.mailpit_url + "/api/v1/messages", timeout=5) as response:
            if json.load(response)["total"] != 0:
                raise CheckFailed("Mailpit was not fresh after container recreation")
        self.save("volume-reset", "PASS")
        self.collect_logs("reset")
        self.save("secret-scan", "PASS")

    def diagnostics(self):
        try:
            self.collect_logs("final")
        finally:
            summary = "## Docker runtime validation\n\n| Check | Result |\n| --- | --- |\n"
            summary += "".join(
                f"| {phase} | {self.report.get(phase, 'NOT RUN')} |\n" for phase in PHASES
            )
            (self.directory / "summary.md").write_text(summary)
            if os.environ.get("GITHUB_STEP_SUMMARY"):
                with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
                    stream.write(summary)
            if any(self.report.get(phase) != "PASS" for phase in PHASES):
                for path in sorted(self.directory.glob("*.log")):
                    print(f"--- sanitized {path.name} ---", flush=True)
                    print(path.read_text(encoding="utf-8")[-24000:], flush=True)


def prepare(directory, project):
    if not re.fullmatch(r"feely-ci-[a-z0-9][a-z0-9-]{0,40}", project):
        raise CheckFailed("Use a unique disposable project named feely-ci-*")
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    create_environment(directory / ".env.docker")
    config = directory / ".env.docker"
    text = config.read_text()
    # CI-only Terms metadata tests the existing contract; no external PDF is fetched.
    text = text.replace('TERMS_VERSION=""', 'TERMS_VERSION="docker-ci-v1"')
    text = text.replace(
        'TERMS_DOCUMENT_URL=""', 'TERMS_DOCUMENT_URL="https://example.com/ci-terms.pdf"'
    )
    text = text.replace('TERMS_DOCUMENT_SHA256=""', f'TERMS_DOCUMENT_SHA256="{"a" * 64}"')
    config.write_text(text, encoding="utf-8")
    values = read_values(config)
    with (directory / "secrets.jsonl").open("x", encoding="utf-8") as stream:
        os.chmod(stream.name, 0o600)
        for key in ("POSTGRES_PASSWORD", "SECRET_KEY", "CONTENT_ENCRYPTION_KEYS"):
            private_values = [values[key]]
            if key == "CONTENT_ENCRYPTION_KEYS":
                private_values.extend(json.loads(values[key]).values())
            for private in private_values:
                stream.write(json.dumps(private) + "\n")
                if os.environ.get("GITHUB_ACTIONS") == "true":
                    print(f"::add-mask::{private}")
    (directory / "project.txt").write_text(project, encoding="utf-8")
    print("Generated an isolated mock/Mailpit environment; no external credentials used.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action", choices=("prepare", "config", "build", "run", "diagnostics", "cleanup")
    )
    parser.add_argument("--work-dir", required=True, type=Path)
    parser.add_argument("--project")
    args = parser.parse_args()
    phase = {"config": "compose-config", "build": "image-build"}.get(args.action)
    stack = None
    try:
        if args.action == "prepare":
            prepare(args.work_dir.resolve(), args.project or "")
            return
        if not (args.work_dir / "project.txt").exists() and args.action in (
            "diagnostics",
            "cleanup",
        ):
            return  # Setup failed before any project could have been created.
        stack = DockerIntegration(args.work_dir)
        if args.action == "config":
            stack.compose("config", "--quiet")
            # Fail rather than adopt someone else's similarly named containers or volumes.
            containers = stack.execute(
                [
                    "docker",
                    "ps",
                    "-aq",
                    "--filter",
                    f"label=com.docker.compose.project={stack.project}",
                ]
            )
            volumes = stack.execute(
                [
                    "docker",
                    "volume",
                    "ls",
                    "-q",
                    "--filter",
                    f"label=com.docker.compose.project={stack.project}",
                ]
            )
            if containers.stdout.strip() or volumes.stdout.strip():
                raise CheckFailed("Disposable project already exists; choose a new unique name")
            (stack.directory / "owned-project").touch(exist_ok=False)
            stack.save(phase, "PASS")
        elif args.action == "build":
            result = stack.compose("build", "--pull", "backend", "frontend", timeout=600)
            (stack.directory / "build.log").write_text(
                redact(result.stdout + result.stderr, stack.secrets()), encoding="utf-8"
            )
            stack.save(phase, "PASS")
        elif args.action == "run":
            if (
                stack.report.get("image-build") != "PASS"
                or stack.report.get("compose-config") != "PASS"
            ):
                raise CheckFailed("Configuration and actual image build must pass first")
            stack.run()
        elif args.action == "diagnostics":
            if (stack.directory / "owned-project").exists():
                stack.diagnostics()
        elif args.action == "cleanup" and (stack.directory / "owned-project").exists():
            stack.compose("down", "-v", "--remove-orphans", timeout=90)
            print("Disposable Docker containers, networks and named volumes removed.")
    except Exception as error:
        # Subprocess/URL/SQL errors can embed secrets. Details live only in redacted logs.
        if stack and phase:
            stack.save(phase, "FAIL")
        if stack:
            for name, status in list(stack.report.items()):
                if status == "RUNNING":
                    stack.save(name, "FAIL")
        print(
            f"FAIL: Docker integration {args.action}; inspect sanitized diagnostics.",
            file=sys.stderr,
        )
        if isinstance(error, CheckFailed):
            # These messages are deliberately constructed without SQL, HTTP bodies or secrets.
            print(f"Reason: {error}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
