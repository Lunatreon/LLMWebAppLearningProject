from fastapi import Depends
from backend.core.config import settings, Settings
from backend.llm.providers.factory import get_chat_llm_client, get_topic_llm_client
from tests.test_admin import configure_and_login_admin, register_and_login


def test_preferences_persist_apply_to_new_requests_and_reset(monkeypatch, client):
    monkeypatch.setattr(settings, "feedback_enabled", False)
    admin = configure_and_login_admin(monkeypatch, client)
    member = register_and_login(client, "preferences@example.com", "preferences")
    url = "/api/v1/admin/settings"
    assert client.get(url, headers=member).status_code == 401
    original = client.get(url, headers=admin).json()
    assert original["revision"] == 0 and not original["overridden"]
    payload = {**original["values"], "feedback_enabled": True, "expected_revision": 0}
    result = client.put(url, headers=admin, json=payload)
    assert result.status_code == 200
    assert result.json()["revision"] == 1
    assert client.get("/api/v1/feedback/config").json() == {"enabled": True}
    assert settings.feedback_enabled is False  # No global mutation/leak to another request.
    assert client.get(url, headers=admin).json()["values"]["feedback_enabled"] is True
    assert client.put(url, headers=admin, json=payload).status_code == 409
    assert client.delete(url, headers=admin, params={"expected_revision": 0}).status_code == 409
    reset = client.delete(url, headers=admin, params={"expected_revision": 1})
    assert reset.status_code == 200 and reset.json()["revision"] == 2
    assert not reset.json()["overridden"]
    assert client.get("/api/v1/feedback/config").json() == {"enabled": False}


def test_models_reach_provider_factories_without_exposing_credentials(monkeypatch, client):
    from backend.llm.providers import factory

    monkeypatch.setattr(settings, "openai_api_key", "private-test-openai-key")
    monkeypatch.setattr(settings, "anthropic_api_key", "private-test-anthropic-key")
    admin = configure_and_login_admin(monkeypatch, client)
    url = "/api/v1/admin/settings"
    snapshot = client.get(url, headers=admin)
    assert "private-test" not in snapshot.text
    value = snapshot.json()["values"]
    saved = client.put(
        url,
        headers=admin,
        json={
            **value,
            "chat_provider": "openai",
            "chat_model": "custom-chat-model",
            "topic_provider": "anthropic",
            "topic_model": "custom-topic-model",
            "expected_revision": 0,
        },
    )
    assert saved.status_code == 200
    monkeypatch.setattr(factory, "OpenAIChatLLMClient", lambda **kwargs: kwargs)
    monkeypatch.setattr(factory, "AnthropicTopicLLMClient", lambda **kwargs: kwargs)

    @client.app.get("/api/v1/test-provider-settings")
    def probe(chat=Depends(get_chat_llm_client), topic=Depends(get_topic_llm_client)):
        # A separate Settings object must keep its own values.
        return {
            "chat": chat["model"],
            "topic": topic["model"],
            "independent": Settings(chat_llm_provider="mock").chat_llm_provider,
        }

    assert client.get("/api/v1/test-provider-settings").json() == {
        "chat": "custom-chat-model",
        "topic": "custom-topic-model",
        "independent": "mock",
    }


def test_unconfigured_providers_and_invalid_settings_are_rejected(monkeypatch, client):
    monkeypatch.setattr(settings, "openai_api_key", None)
    monkeypatch.setattr(settings, "smtp_host", None)
    admin = configure_and_login_admin(monkeypatch, client)
    url = "/api/v1/admin/settings"
    value = client.get(url, headers=admin).json()["values"]
    payload = {**value, "expected_revision": 0}
    for changes in (
        {"chat_provider": "openai", "chat_model": "model"},
        {"chat_provider": "ollama", "chat_model": " "},
        {"password_reset_enabled": True},
        {"rate_limit_llm_user_per_day": -1},
        {"secret_key": "must-not-be-editable"},
        {"feedback_enabled": "true"},
    ):
        assert client.put(url, headers=admin, json={**payload, **changes}).status_code == 422
    assert client.get(url, headers=admin).json()["revision"] == 0
