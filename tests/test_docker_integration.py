"""Safety checks for the disposable Docker harness; actual runtime coverage belongs in CI."""

import subprocess

import pytest

from scripts import docker_integration as ci


@pytest.fixture
def stack(tmp_path):
    directory = tmp_path / "docker-check"
    ci.prepare(directory, "feely-ci-unit-test")
    return ci.DockerIntegration(directory)


def test_preparation_uses_separate_mock_configuration_and_refuses_overwrite(tmp_path, monkeypatch):
    directory = tmp_path / "docker-check"
    monkeypatch.setenv("DATABASE_URL", "sqlite:///reference-must-not-be-used.db")
    monkeypatch.setenv("OPENAI_API_KEY", "real-host-key-must-not-be-used")
    monkeypatch.setenv("LLM_PROVIDER", "openai")
    ci.prepare(directory, "feely-ci-unit-test")
    stack = ci.DockerIntegration(directory)
    assert stack.values["LLM_PROVIDER"] == "mock"
    assert stack.values["OPENAI_API_KEY"] == ""
    assert stack.values["SMTP_HOST"] == "mailpit"
    assert stack.values["TERMS_VERSION"] == "docker-ci-v1"
    assert "DATABASE_URL" not in stack.environment
    assert "OPENAI_API_KEY" not in stack.environment
    assert "LLM_PROVIDER" not in stack.environment
    assert stack.environment["FEELY_DOCKER_ENV_FILE"] == str(stack.config)
    original = stack.config.read_bytes()
    with pytest.raises(FileExistsError):
        ci.prepare(directory, "feely-ci-unit-test")
    assert stack.config.read_bytes() == original


@pytest.mark.parametrize("project", ["feely-local", "default", "", "feely-ci-../bad", "feely-ci-X"])
def test_refuses_projects_outside_disposable_namespace(tmp_path, project):
    with pytest.raises(ci.CheckFailed):
        ci.prepare(tmp_path / "check", project)
    assert not (tmp_path / "check").exists()


@pytest.mark.parametrize(
    "text, secret",
    [
        ("a known secret: ci-password-for-this-run", "ci-password-for-this-run"),
        ("password=unexpected-unregistered-password", "unexpected-unregistered-password"),
        ('{"access_token": "unregistered-token"}', "unregistered-token"),
        (
            "postgresql+psycopg://feely:unregistered-db-password@postgres/feely",
            "unregistered-db-password",
        ),
        ("GET /?reset_password_token=unregistered-reset-token", "unregistered-reset-token"),
        ("activation PIN is: 582931", "582931"),
        (
            "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fake_signature",
            "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.fake_signature",
        ),
        ("api-key sk-proj-unregistered0123456789key", "sk-proj-unregistered0123456789key"),
    ],
)
def test_log_scanner_detects_and_redacts_known_and_unregistered_secrets(text, secret):
    secrets = ["ci-password-for-this-run"]
    assert ci.leaked_secrets(text, secrets)
    sanitized = ci.redact(text, secrets)
    assert secret not in sanitized
    assert "REDACTED" in sanitized


def test_normal_startup_and_shutdown_logs_are_not_secret_findings():
    text = (
        "Database ready; applying Alembic migrations.\n"
        "INFO: Running upgrade -> 0001_initial, Create the ten-table baseline\n"
        "INFO: Application startup complete.\n"
        "INFO: Application shutdown complete.\n"
    )
    assert not ci.leaked_secrets(text, ["private-password"])
    assert ci.redact(text, ["private-password"]) == text


def test_polling_has_a_deadline_and_sleeps_only_between_probes(monkeypatch):
    now = [0.0]
    monkeypatch.setattr(ci.time, "monotonic", lambda: now[0])
    monkeypatch.setattr(ci.time, "sleep", lambda duration: now.__setitem__(0, now[0] + duration))
    probes = []

    def unavailable():
        probes.append(now[0])
        return False

    with pytest.raises(ci.CheckFailed, match="timed out"):
        ci.poll(unavailable, timeout=2.5, interval=1)
    assert probes == [0, 1, 2, 2.5]
    ci.poll(lambda: True, timeout=2.5)
    assert now[0] == 2.5


def test_failed_log_scan_writes_redacted_diagnostics_and_latches_failure(stack, monkeypatch):
    secret = stack.values["POSTGRES_PASSWORD"]
    monkeypatch.setattr(
        stack, "compose", lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, secret, "")
    )
    with pytest.raises(ci.CheckFailed, match="Sensitive"):
        stack.collect_logs("initial")
    assert secret not in (stack.directory / "initial.log").read_text()
    assert stack.report["secret-scan"] == "FAIL"
    monkeypatch.setattr(
        stack, "compose", lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, "clean", "")
    )
    stack.collect_logs("later")
    assert stack.report["secret-scan"] == "FAIL"


def test_cleanup_never_adopts_a_project_that_failed_ownership_check(stack, monkeypatch):
    commands = []
    monkeypatch.setattr(
        ci.DockerIntegration, "compose", lambda *args, **kwargs: commands.append(args)
    )
    monkeypatch.setattr(
        ci.sys, "argv", ["docker-integration", "cleanup", "--work-dir", str(stack.directory)]
    )
    ci.main()
    assert commands == []


def test_cleanup_always_removes_volumes_for_its_owned_project(stack, monkeypatch):
    (stack.directory / "owned-project").touch()
    commands = []
    monkeypatch.setattr(
        ci.DockerIntegration, "compose", lambda self, *args, **kwargs: commands.append(args)
    )
    monkeypatch.setattr(
        ci.sys, "argv", ["docker-integration", "cleanup", "--work-dir", str(stack.directory)]
    )
    ci.main()
    assert commands == [("down", "-v", "--remove-orphans")]


def test_nonempty_fresh_database_stops_before_backend_start_or_volume_deletion(stack, monkeypatch):
    commands = []

    def compose(*args, **kwargs):
        commands.append(args)
        return subprocess.CompletedProcess(args, 0, "1\n", "")

    monkeypatch.setattr(stack, "compose", compose)
    monkeypatch.setattr(stack, "wait_healthy", lambda services: None)
    with pytest.raises(ci.CheckFailed, match="not empty"):
        stack.run()
    assert not any(command[0] == "down" or "backend" in command for command in commands)


def test_command_failure_never_echoes_raw_output(stack, monkeypatch, capsys):
    secret = stack.values["SECRET_KEY"]
    monkeypatch.setattr(
        ci.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 1, secret, ""),
    )
    with pytest.raises(ci.CheckFailed) as error:
        stack.compose("build", "backend")
    assert secret not in str(error.value)
    assert secret not in capsys.readouterr().out
    assert secret not in (stack.directory / "command-error.log").read_text()
