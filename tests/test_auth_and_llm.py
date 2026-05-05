def test_user_can_register_login_and_send_llm_message(client):
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "luna@example.com",
            "username": "luna",
            "password": "super-secret",
        },
    )
    assert register_response.status_code == 201
    assert register_response.json()["email"] == "luna@example.com"

    login_response = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "luna@example.com", "password": "super-secret"},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]

    llm_response = client.post(
        "/api/v1/llm/message",
        json={"message": "I love building cozy productivity apps."},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert llm_response.status_code == 200
    body = llm_response.json()
    assert "assistant_message" in body
    assert body["profile"]["message_count"] == 1
    assert body["profile"]["last_user_message"] == "I love building cozy productivity apps."
