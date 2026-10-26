from backend.api.routes import auth as auth_routes
from backend.core.config import settings


def register_and_login(client, email: str, username: str):
    assert (
        client.post(
            "/api/v1/auth/register",
            json={"email": email, "username": username, "password": "original-pass"},
        ).status_code
        == 201
    )
    token = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": email, "password": "original-pass"},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_password_reset_email_changes_password_once(client, monkeypatch):
    sent_tokens = []
    register_and_login(client, "reset@example.com", "reset-user")
    monkeypatch.setattr(settings, "password_reset_enabled", True)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from_email", "hello@feel-y.com")
    monkeypatch.setattr(
        auth_routes,
        "send_password_reset_message",
        lambda user, token: sent_tokens.append((user.email, token)),
    )

    requested = client.post(
        "/api/v1/auth/password-reset/request",
        json={"email": "reset@example.com"},
    )
    assert requested.status_code == 200
    assert requested.json()["sent"] is True
    assert sent_tokens[0][0] == "reset@example.com"

    confirmed = client.post(
        "/api/v1/auth/password-reset/confirm",
        json={"token": sent_tokens[0][1], "new_password": "replacement-pass"},
    )
    assert confirmed.status_code == 200
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email_or_username": "reset@example.com", "password": "replacement-pass"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/v1/auth/password-reset/confirm",
            json={"token": sent_tokens[0][1], "new_password": "another-pass"},
        ).status_code
        == 400
    )
