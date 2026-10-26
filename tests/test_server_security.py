import asyncio

import jwt
import pytest
from fastapi.testclient import TestClient

from backend.core.config import Settings, settings
from backend.core.middleware import RequestSizeLimitMiddleware
from backend.core.rate_limit import SlidingWindowRateLimiter
from backend.website import app as website_app


@pytest.mark.parametrize(
    "path",
    [
        "/.env",
        "/.git/config",
        "/feely.db",
        "/@fs/.env?raw??",
        "/openapi.json",
        "/docs",
        "/redoc",
        "/assets/",
        "/app/core/config.py",
        "/backend/core/config.py",
    ],
)
def test_private_files_and_docs_are_not_public(client, path):
    assert client.get(path).status_code == 404
    with TestClient(website_app) as website:
        assert website.get(path).status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/users/me/profile",
        "/api/v1/users/me/map",
        "/api/v1/llm/chats",
        "/api/v1/admin/users",
    ],
)
def test_private_api_requires_authentication(client, path):
    response = client.get(path)
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"


def test_tokens_forged_using_old_example_key_are_rejected(client):
    token = jwt.encode(
        {"sub": "1", "token_type": "user", "exp": 4102444800},
        "change-this-secret-before-deploying",
        algorithm="HS256",
    )
    assert (
        client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )


def test_example_key_is_rejected_even_in_local_mode():
    config = Settings(
        _env_file=None, secret_key="change-this-secret-before-deploying", environment="local"
    )
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        config.validate_runtime_security()


def test_scan_limits_cannot_be_evaded_by_changing_headers(client, monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_http_per_minute", 2)
    monkeypatch.setattr(settings, "trust_proxy_headers", True)
    assert client.get("/.env").status_code == 404
    assert (
        client.get(
            "/.git/config", headers={"User-Agent": "different", "X-Forwarded-For": "1.2.3.4"}
        ).status_code
        == 404
    )
    response = client.get(
        "/openapi.json", headers={"X-Real-IP": "5.6.7.8", "X-Forwarded-For": "5.6.7.8"}
    )
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


def test_chunked_and_misreported_bodies_cannot_reach_endpoint():
    async def check(headers, chunks, expected):
        called = False
        output = []

        async def endpoint(scope, receive, send):
            nonlocal called
            called = True
            assert (await receive())["body"] == b"1234"

        messages = iter(
            {"type": "http.request", "body": chunk, "more_body": i < len(chunks) - 1}
            for i, chunk in enumerate(chunks)
        )

        async def receive():
            return next(messages)

        async def send(message):
            output.append(message)

        await RequestSizeLimitMiddleware(endpoint, 4)(
            {"type": "http", "headers": headers}, receive, send
        )
        assert called == (expected is None)
        if expected:
            assert output[0]["status"] == expected

    for headers in ([], [(b"content-length", b"1")]):
        asyncio.run(check(headers, [b"12", b"345"], 413))
    asyncio.run(check([], [b"12", b"34"], None))


def test_public_website_only_serves_approved_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.api.routes.website.WEBSITE_ROOT", tmp_path)
    (tmp_path / "index.html").write_text("public page")
    (tmp_path / "credentials.json").write_text("secret material")
    with TestClient(website_app) as website:
        assert website.get("/").text == "public page"
        assert website.get("/credentials.json").status_code == 404
        assert website.get("/%2e%2e/.env").status_code == 404
        assert website.head("/index.html").status_code == 200


def test_limiter_reclaims_expired_identities(monkeypatch):
    now = [0.0]
    monkeypatch.setattr("backend.core.rate_limit.monotonic", lambda: now[0])
    limiter = SlidingWindowRateLimiter()
    assert limiter.check("old", 1, 30)[0]
    now[0] = 61
    assert limiter.check("new", 1, 30)[0]
    assert "old" not in limiter._events


def test_other_user_cannot_read_or_delete_chat(client):
    def login_as(name):
        response = client.post(
            "/api/v1/auth/register",
            json={
                "email": f"{name}@example.com",
                "username": name,
                "password": "test-password-123",
            },
        )
        assert response.status_code == 201
        login = client.post(
            "/api/v1/auth/login",
            json={
                "email_or_username": name,
                "password": "test-password-123",
            },
        )
        return {"Authorization": f"Bearer {login.json()['access_token']}"}

    owner = login_as("owner_security")
    response = client.post("/api/v1/llm/chats", json={}, headers=owner)
    assert response.status_code == 201
    chat_id = response.json()["chat_id"]
    stranger = login_as("stranger_security")
    assert client.get(f"/api/v1/llm/chats/{chat_id}", headers=stranger).status_code == 404
    assert client.delete(f"/api/v1/llm/chats/{chat_id}", headers=stranger).status_code == 404
    assert client.get(f"/api/v1/llm/chats/{chat_id}", headers=owner).status_code == 200
