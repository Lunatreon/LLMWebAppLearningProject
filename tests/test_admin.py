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


def test_admin_creates_roles_and_revokes_database_admin_access(monkeypatch, client):
    root = configure_and_login_admin(monkeypatch, client)
    accounts = {}
    for role in ("member", "test", "admin"):
        response = client.post("/api/v1/admin/users", headers=root, json={
            "email": f"{role}@example.com", "username": f"role_{role}",
            "password": "account-password", "role": role,
        })
        assert response.status_code == 201
        accounts[role] = response.json()
        assert accounts[role]["role"] == role
        login = client.post("/api/v1/admin/login", json={
            "username": f"{role}@example.com", "password": "account-password",
        })
        assert login.status_code == (200 if role == "admin" else 401)
        if role == "admin":
            database_admin = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.get("/api/v1/admin/users", headers=database_admin).status_code == 200
    assert client.get("/api/v1/users/me", headers=database_admin).status_code == 401
    assert client.patch(f"/api/v1/admin/users/{accounts['admin']['id']}", headers=root,
                        json={"role": "test"}).status_code == 200
    assert client.get("/api/v1/admin/users", headers=database_admin).status_code == 401
    assert client.post("/api/v1/admin/users", headers=root, json={
        "email": "new@example.com", "username": "ROLE_TEST", "password": "account-password",
    }).status_code == 409
    assert client.patch(f"/api/v1/admin/users/{accounts['test']['id']}", headers=root,
                        json={"role": "invalid"}).status_code == 422


def test_regular_accounts_cannot_grant_roles_or_use_debug(monkeypatch, client):
    from test_auth_and_llm import grant_premium_access

    root = configure_and_login_admin(monkeypatch, client)
    client.post("/api/v1/auth/register", json={
        "email": "ordinary@example.com", "username": "ordinary", "password": "account-password",
        "role": "admin",
    })
    token = client.post("/api/v1/auth/login", json={
        "email_or_username": "ordinary", "password": "account-password",
    }).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    member = client.get("/api/v1/users/me/account", headers=headers).json()
    assert member["role"] == "member"
    client.patch("/api/v1/users/me/account", headers=headers, json={"role": "admin"})
    assert client.get("/api/v1/users/me/account", headers=headers).json()["role"] == "member"
    assert client.patch(f"/api/v1/admin/users/{member['id']}", headers=headers,
                        json={"role": "admin"}).status_code == 401
    assert client.post("/api/v1/admin/users", headers=headers, json={
        "email": "blocked@example.com", "username": "blocked", "password": "account-password",
        "role": "admin",
    }).status_code == 401
    grant_premium_access(client, member["email"])
    assert client.post("/api/v1/users/me/map/topics/missing/refresh-preview", headers=headers).status_code == 403
    assert client.post("/api/v1/users/me/map/refresh/apply", headers=headers, json={
        "revision": "0" * 64, "topics": [{"id": "missing", "title": "Name", "category": "other", "description": ""}],
    }).status_code == 403
    for role in ("test", "admin"):
        client.patch(f"/api/v1/admin/users/{member['id']}", headers=root, json={"role": role})
        assert client.get("/api/v1/users/me/account", headers=headers).json()["role"] == role
        # Authorization passed, but this account does not have that topic.
        assert client.post("/api/v1/users/me/map/topics/missing/refresh-preview", headers=headers).status_code == 404
    client.patch(f"/api/v1/admin/users/{member['id']}", headers=root, json={"role": "member"})
    assert client.post("/api/v1/users/me/map/topics/missing/refresh-preview", headers=headers).status_code == 403


def test_legacy_sqlite_role_migration_is_safe_to_repeat(monkeypatch):
    from sqlalchemy import create_engine, text
    from app.db import init_db

    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT)"))
        connection.execute(text("INSERT INTO users (username) VALUES ('existing')"))
    monkeypatch.setattr(init_db, "engine", engine)
    init_db.ensure_sqlite_user_columns()
    init_db.ensure_sqlite_user_columns()
    with engine.connect() as connection:
        assert connection.execute(text("SELECT role FROM users")).scalar_one() == "member"
    engine.dispose()


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
    assert {prompt["kind"] for prompt in original.json()["prompts"]} == {
        "chat",
        "topic",
        "journal",
    }
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
