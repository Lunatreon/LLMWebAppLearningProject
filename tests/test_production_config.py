"""Production guards and offline OpenAI transport behavior, without real credentials."""

import asyncio
import json
import os
import shutil

import httpx
import pytest
from fastapi.testclient import TestClient
from openai import AsyncOpenAI
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from backend.core.config import settings
from backend.core.production import public_https_url
from backend.llm.providers.openai import OpenAIChatLLMClient
from backend.main import create_app
from scripts.production_ci import create_fixture
from deployment.production import load_production, write_backend_environment
from deployment.production import check_compose, compose_command


@pytest.fixture
def production(tmp_path):
    folder = tmp_path / "production"
    create_fixture(folder, "feely-prod-ci-unit")
    config, values = load_production(folder / ".env.production")
    return config, values, folder


def test_valid_production_config_never_loads_host_credentials(production, monkeypatch):
    config, values, folder = production
    monkeypatch.setenv("OPENAI_API_KEY", "host-key-that-must-not-be-used")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///host-reference.db")
    loaded, _ = load_production(folder / ".env.production")
    assert loaded.openai_api_key == config.openai_api_key
    assert loaded.database_url == config.database_url
    backend = (folder / ".env.production.backend").read_text()
    assert values["POSTGRES_PASSWORD"] not in backend
    assert "POSTGRES_APP_PASSWORD=" not in backend
    assert "POSTGRES_PASSWORD=" not in backend
    assert config.secret_key in backend


@pytest.mark.skipif(not shutil.which("docker"), reason="Docker CLI is not installed")
def test_production_compose_after_docker_file_consolidation(production):
    config, values, folder = production
    command, environment = compose_command(folder / ".env.production", values)
    model = check_compose(config, values, command, environment)
    assert set(model["services"]) == {"backend", "postgres", "caddy"}


@pytest.mark.parametrize(
    "changes, field",
    [
        ({"database_url": "sqlite:///fallback.db"}, "DATABASE_URL"),
        ({"database_url": "postgresql://postgres:private-value@postgres/feely"}, "DATABASE_URL"),
        ({"database_url": "postgresql://feely_app@postgres/feely"}, "DATABASE_URL"),
        ({"public_app_url": "http://localhost:5173"}, "PUBLIC_APP_URL"),
        ({"cors_origins": ["*"]}, "CORS_ORIGINS"),
        ({"cors_origins": ["null"]}, "CORS_ORIGINS"),
        ({"cors_origins": ["http://127.0.0.1:5173"]}, "CORS_ORIGINS"),
        ({"allowed_hosts": ["*"]}, "ALLOWED_HOSTS"),
        ({"api_docs_enabled": True}, "API_DOCS_ENABLED"),
        ({"basic_auth_enabled": True}, "BASIC_AUTH_ENABLED"),
        ({"trust_proxy_headers": True}, "TRUST_PROXY_HEADERS"),
        ({"email_verification_required": False}, "activation"),
        ({"password_reset_enabled": False}, "recovery"),
        ({"smtp_host": "mailpit"}, "SMTP_HOST"),
        ({"smtp_use_tls": False}, "SMTP_USE_TLS"),
        ({"smtp_use_ssl": True}, "SMTP_USE_TLS"),
        ({"turnstile_verify_url": "http://localhost/siteverify"}, "TURNSTILE_VERIFY_URL"),
        ({"turnstile_secret_key": "1x0000000000000000000000000000000AA"}, "test keys"),
        ({"terms_version": ""}, "TERMS_VERSION"),
        ({"chat_llm_provider": "mock"}, "CHAT_LLM_PROVIDER"),
        ({"topic_llm_provider": "local"}, "TOPIC_LLM_PROVIDER"),
        ({"openai_api_key": ""}, "OPENAI_API_KEY"),
        ({"openai_api_key": "<replace-this-private-key>"}, "OPENAI_API_KEY"),
        ({"openai_model": ""}, "OPENAI_CHAT_MODEL"),
        ({"stripe_enabled": True}, "STRIPE_ENABLED"),
        ({"webmail_enabled": True}, "WEBMAIL_ENABLED"),
        ({"rate_limit_enabled": False}, "RATE_LIMIT_ENABLED"),
        ({"rate_limit_login_identifier_attempts": 0}, "RATE_LIMIT_LOGIN_IDENTIFIER_ATTEMPTS"),
    ],
)
def test_unsafe_production_config_fails_without_echoing_private_values(production, changes, field):
    config, _, _ = production
    with pytest.raises(RuntimeError, match=field) as error:
        config.model_copy(update=changes).validate_runtime_security()
    assert config.secret_key not in str(error.value)
    assert "private-value" not in str(error.value)


def test_filtered_env_preserves_literal_smtp_password_and_refuses_overwrite(production):
    config, _, folder = production
    password = 'literal-$dollar#hash"quote'
    target = folder / "runtime.env"
    write_backend_environment(config.model_copy(update={"smtp_password": password}), target)
    assert f"SMTP_PASSWORD={password}\n" in target.read_text()
    before = target.read_bytes()
    with pytest.raises(FileExistsError):
        write_backend_environment(config, target)
    assert target.read_bytes() == before
    if os.name != "nt":
        assert target.stat().st_mode & 0o777 == 0o600


def test_database_passwords_must_match_and_roles_must_differ(production):
    _, _, folder = production
    master = folder / ".env.production"
    text = master.read_text()
    master.write_text(
        text.replace("POSTGRES_APP_USER=feely_app", "POSTGRES_APP_USER=feely_bootstrap")
    )
    with pytest.raises(RuntimeError, match="differ"):
        load_production(master)


def test_public_urls_reject_credentials_loopback_and_invalid_origins():
    assert public_https_url("https://app.example.invalid", origin_only=True)
    assert not public_https_url("https://127.0.0.1")
    assert not public_https_url("https://app.example.invalid:5173")
    assert not public_https_url("https://user:password@app.example.invalid")
    assert not public_https_url("https://app.example.invalid/path", origin_only=True)


@pytest.mark.parametrize(
    "peer, expected", [("172.30.20.2", "198.51.100.7"), ("198.51.100.9", "198.51.100.9")]
)
def test_only_the_selected_proxy_can_set_client_ip_and_scheme(peer, expected):
    captured = {}

    async def app(scope, receive, send):
        captured.update(scope)

    async def check():
        middleware = ProxyHeadersMiddleware(app, trusted_hosts=["172.30.20.2"])
        await middleware(
            {
                "type": "http",
                "scheme": "http",
                "client": (peer, 1234),
                "headers": [
                    (b"x-forwarded-for", b"198.51.100.7"),
                    (b"x-forwarded-proto", b"https"),
                ],
            },
            None,
            None,
        )

    asyncio.run(check())
    assert captured["client"][0] == expected
    assert captured["scheme"] == ("https" if peer == "172.30.20.2" else "http")


def test_configured_hosts_reject_unknown_hosts_without_changing_health_contract(monkeypatch):
    monkeypatch.setattr(settings, "allowed_hosts", ["app.example.invalid"])
    client = TestClient(create_app(init_database=False), base_url="https://app.example.invalid")
    assert client.get("/api/v1/health").json() == {"status": "ok"}
    assert client.get("/api/v1/health", headers={"Host": "unexpected.invalid"}).status_code == 400


def test_openai_uses_explicit_sdk_limits_and_preserves_one_chunk_callback(monkeypatch):
    captured = {}

    async def transport(request):
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "id": "ci-completion",
                "object": "chat.completion",
                "created": 0,
                "model": "configured-model",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": json.dumps(
                                {"assistant_message": "A private reply.", "profile": {}}
                            ),
                        },
                    }
                ],
            },
        )

    def sdk(**kwargs):
        captured.update(kwargs)
        return AsyncOpenAI(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
        )

    monkeypatch.setattr("openai.AsyncOpenAI", sdk)
    monkeypatch.setattr(settings, "openai_timeout_seconds", 15)
    monkeypatch.setattr(settings, "openai_max_retries", 0)

    async def check():
        provider = OpenAIChatLLMClient("ci-not-real-key", "configured-model")
        chunks = []

        async def on_chunk(text):
            chunks.append(text)

        result = await provider.respond(
            "Private question", {}, {}, "ci-chat", on_text_chunk=on_chunk
        )
        assert result.assistant_message == "A private reply."
        assert chunks == ["A private reply."]
        assert provider.client.is_closed()

    asyncio.run(check())
    assert captured["timeout"].read == 15 and captured["timeout"].connect == 5
    assert captured["max_retries"] == 0
    assert captured["payload"]["model"] == "configured-model"
    assert captured["payload"]["response_format"] == {"type": "json_object"}
    assert captured["payload"].get("stream", False) is False


def test_openai_cancellation_closes_owned_http_request(monkeypatch):
    async def check():
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def transport(request):
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        def sdk(**kwargs):
            return AsyncOpenAI(
                **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
            )

        monkeypatch.setattr("openai.AsyncOpenAI", sdk)
        provider = OpenAIChatLLMClient("ci-not-real-key", "configured-model")
        task = asyncio.create_task(provider.respond("Private question", {}, {}, "ci-chat"))
        await asyncio.wait_for(started.wait(), timeout=2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert cancelled.is_set() and provider.client.is_closed()

    asyncio.run(check())


def test_openai_error_body_never_reaches_logs_or_traceback_message(monkeypatch, caplog):
    private = "private-prompt-and-key-must-not-be-logged"

    async def transport(request):
        return httpx.Response(
            400, json={"error": {"message": private, "type": "invalid_request_error"}}
        )

    def sdk(**kwargs):
        return AsyncOpenAI(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
        )

    monkeypatch.setattr("openai.AsyncOpenAI", sdk)

    async def check():
        provider = OpenAIChatLLMClient("ci-not-real-key", "configured-model")
        with pytest.raises(RuntimeError, match="provider request failed") as error:
            await provider.respond(private, {}, {}, "ci-chat")
        assert error.value.__suppress_context__
        assert private not in str(error.value)
        assert provider.client.is_closed()

    asyncio.run(check())
    assert private not in caplog.text
    assert "BadRequestError" in caplog.text


def test_production_webmail_supports_imap_without_cloudflare(production):
    config, _, _ = production
    config = config.model_copy(
        update={
            "webmail_enabled": True,
            "webmail_provider": "imap",
            "webmail_imap_host": "mail.your-server.de",
            "webmail_imap_username": "info@example.com",
            "webmail_imap_password": "private-mailbox-password",
        }
    )
    config.validate_runtime_security()
    with pytest.raises(RuntimeError, match="IMAP"):
        config.model_copy(update={"webmail_imap_password": ""}).validate_runtime_security()


def test_filtered_environment_serializes_keyring_as_json_and_loads_like_backend(
    production, monkeypatch
):
    from backend.core.config import Settings
    from deployment.production import backend_environment

    config, _, folder = production
    values = backend_environment(config)
    assert json.loads(values["CONTENT_ENCRYPTION_KEYS"]) == config.content_encryption_keys
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    runtime = Settings(_env_file=None)
    assert runtime.content_encryption_keys == config.content_encryption_keys
    assert runtime.cors_origins == config.cors_origins
    assert runtime.allowed_hosts == config.allowed_hosts
    runtime.validate_runtime_security()
    filtered = dict(
        line.split("=", 1) for line in (folder / ".env.production.backend").read_text().splitlines()
    )
    assert json.loads(filtered["CONTENT_ENCRYPTION_KEYS"]) == config.content_encryption_keys


def test_production_runtime_checks_actual_container_environment_before_starting_services(
    production, monkeypatch
):
    from scripts.production_ci import Rehearsal, ProductionCheckFailed

    _, _, folder = production
    rehearsal = Rehearsal(folder)
    commands = []

    def fail(arguments, **kwargs):
        commands.append(arguments)
        raise ProductionCheckFailed("Production CI command failed; see sanitized diagnostics.")

    monkeypatch.setattr(rehearsal, "run", fail)
    with pytest.raises(ProductionCheckFailed):
        rehearsal.runtime()
    assert len(commands) == 1
    assert commands[0][:7] == [
        "run",
        "--rm",
        "--no-deps",
        "--entrypoint",
        "python",
        "backend",
        "-c",
    ]
    assert "validate_runtime_security" in commands[0][-1]


@pytest.mark.parametrize("controlled", [True, False])
def test_production_cli_prints_safe_failure_reason_without_echoing_arbitrary_errors(
    production, monkeypatch, capsys, controlled
):
    from scripts import production_ci

    config, _, folder = production
    (folder / "owned-project").touch()

    def fail(self):
        if controlled:
            raise production_ci.ProductionCheckFailed(
                "Production CI service exited before readiness."
            )
        raise RuntimeError(config.secret_key)

    monkeypatch.setattr(production_ci.Rehearsal, "runtime", fail)
    monkeypatch.setattr(
        production_ci.sys, "argv", ["production-ci", "run", "--directory", str(folder)]
    )
    with pytest.raises(SystemExit) as error:
        production_ci.main()
    assert error.value.code == 1
    output = capsys.readouterr()
    assert config.secret_key not in output.out + output.err
    assert ("Reason: Production CI service exited before readiness." in output.err) is controlled
