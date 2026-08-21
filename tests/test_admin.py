from app.core.config import settings
from app.core.security import hash_password
import pytest

from app.services.llm import PromptConfigurationError, read_system_prompt


def register_and_login(client, email: str, username: str, password: str = "secure-pass"):
    assert client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": password},
    ).status_code == 201
    token = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": email, "password": password},
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def configure_and_login_admin(monkeypatch, client, username: str = "site-admin"):
    password = "separate-admin-pass"
    monkeypatch.setattr(settings, "admin_username", username)
    monkeypatch.setattr(settings, "admin_password_hash", hash_password(password))
    response = client.post(
        "/api/v1/admin/login",
        json={"username": username, "password": password},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_admin_routes_are_allowlisted_and_manage_users(monkeypatch, client):
    admin_headers = configure_and_login_admin(monkeypatch, client)
    user_headers = register_and_login(client, "member@example.com", "member-user")

    assert client.get("/api/v1/admin/status", headers=user_headers).status_code == 401
    assert client.get("/api/v1/admin/prompts", headers=user_headers).status_code == 401
    assert client.get("/api/v1/users/me/account", headers=admin_headers).status_code == 401
    assert client.get("/api/v1/admin/status", headers=admin_headers).json() == {
        "is_admin": True,
        "username": "site-admin",
    }

    users = client.get("/api/v1/admin/users", headers=admin_headers).json()
    member = next(user for user in users if user["email"] == "member@example.com")
    updated = client.patch(
        f"/api/v1/admin/users/{member['id']}",
        headers=admin_headers,
        json={"display_name": "Test Member", "is_email_verified": True},
    )
    assert updated.status_code == 200
    assert updated.json()["display_name"] == "Test Member"
    assert updated.json()["is_email_verified"] is True

    reset = client.post(
        f"/api/v1/admin/users/{member['id']}/password",
        headers=admin_headers,
        json={"new_password": "new-secure-pass"},
    )
    assert reset.status_code == 200
    assert client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "member@example.com", "password": "new-secure-pass"},
    ).status_code == 200

    removed = client.post(
        f"/api/v1/admin/users/{member['id']}/subscription/remove",
        headers=admin_headers,
        json={"confirmation": "REMOVE_SUBSCRIPTION"},
    )
    assert removed.status_code == 200
    assert removed.json()["premium"] is False


def test_admin_prompt_edits_are_loaded_from_files(monkeypatch, client, tmp_path):
    admin_headers = configure_and_login_admin(monkeypatch, client, "prompt-admin")
    monkeypatch.setattr(settings, "prompt_directory", str(tmp_path / "prompts"))

    original = client.get("/api/v1/admin/prompts", headers=admin_headers)
    assert original.status_code == 200
    assert {prompt["kind"] for prompt in original.json()["prompts"]} == {"chat", "topic"}
    assert all(prompt["text"] == "" for prompt in original.json()["prompts"])
    with pytest.raises(PromptConfigurationError):
        read_system_prompt("chat")

    changed_text = "You are the test chat prompt. " + ("Keep this editable and safe. " * 5)
    changed = client.put(
        "/api/v1/admin/prompts/chat",
        headers=admin_headers,
        json={"text": changed_text},
    )
    assert changed.status_code == 200
    assert read_system_prompt("chat") == changed_text.strip()
    assert (tmp_path / "prompts" / "chat_system.txt").read_text(encoding="utf-8").strip() == changed_text.strip()


def test_admin_login_is_independent_and_requires_configuration(monkeypatch, client):
    monkeypatch.setattr(settings, "admin_username", None)
    monkeypatch.setattr(settings, "admin_password_hash", None)
    unavailable = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "separate-admin-pass"},
    )
    assert unavailable.status_code == 503

    monkeypatch.setattr(settings, "admin_username", "admin")
    monkeypatch.setattr(settings, "admin_password_hash", hash_password("right-admin-pass"))
    rejected = client.post(
        "/api/v1/admin/login",
        json={"username": "admin", "password": "wrong-admin-pass"},
    )
    assert rejected.status_code == 401
