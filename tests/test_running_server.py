import os
from uuid import uuid4

import httpx
import pytest


BASE_URL = os.getenv("FEELY_TEST_SERVER_URL", "http://127.0.0.1:8000").rstrip("/")
API_URL = f"{BASE_URL}/api/v1"


def assert_server_is_running() -> None:
    try:
        response = httpx.get(f"{API_URL}/health", timeout=5.0)
    except httpx.RequestError as exc:
        pytest.fail(
            f"Could not connect to the running API server at {BASE_URL}. "
            "Start it with: python -m uvicorn app.main:app --reload. "
            f"Original error: {exc}"
        )

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_running_server_auth_profile_and_llm_flow():
    assert_server_is_running()

    suffix = uuid4().hex[:12]
    email = f"live-test-{suffix}@example.com"
    username = f"live_test_{suffix}"
    password = "super-secret-password"

    register_response = httpx.post(
        f"{API_URL}/auth/register",
        json={
            "email": email,
            "username": username,
            "password": password,
        },
        timeout=10.0,
    )

    assert register_response.status_code == 201
    registered_user = register_response.json()
    assert registered_user["email"] == email
    assert registered_user["username"] == username

    login_response = httpx.post(
        f"{API_URL}/auth/login",
        json={"email_or_username": email, "password": password},
        timeout=10.0,
    )

    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    me_response = httpx.get(f"{API_URL}/users/me", headers=headers, timeout=10.0)
    assert me_response.status_code == 200
    assert me_response.json()["email"] == email

    profile_data = {"favorite_topic": "cozy productivity", "message_count": 0}
    update_profile_response = httpx.put(
        f"{API_URL}/users/me/profile",
        json={"data": profile_data},
        headers=headers,
        timeout=10.0,
    )
    assert update_profile_response.status_code == 200
    assert update_profile_response.json()["data"] == profile_data

    read_profile_response = httpx.get(
        f"{API_URL}/users/me/profile",
        headers=headers,
        timeout=10.0,
    )
    assert read_profile_response.status_code == 200
    assert read_profile_response.json()["data"] == profile_data

    llm_response = httpx.post(
        f"{API_URL}/llm/message",
        json={"message": "I love building cozy productivity apps."},
        headers=headers,
        timeout=20.0,
    )

    assert llm_response.status_code == 200
    body = llm_response.json()
    assert "assistant_message" in body
    assert body["profile"]["message_count"] == 1
    assert body["profile"]["last_user_message"] == "I love building cozy productivity apps."
