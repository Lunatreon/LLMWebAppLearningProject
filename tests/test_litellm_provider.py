import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import openai
import pytest
from fastapi import HTTPException

from backend.core.config import settings
from backend.llm.providers.factory import get_chat_llm_client, get_topic_llm_client


@pytest.fixture
def proxy(monkeypatch):
    for name, value in {
        "chat_llm_provider": "litellm",
        "topic_llm_provider": "litellm",
        "litellm_base_url": "https://proxy.example.com/team/v1/",
        "litellm_api_key": "test-proxy-key",
        "litellm_model": "shared-alias",
        "litellm_chat_model": None,
        "litellm_topic_model": None,
        "litellm_timeout_seconds": 12,
        "litellm_max_retries": 0,
    }.items():
        monkeypatch.setattr(settings, name, value)


@pytest.mark.parametrize("role", ["chat", "topic"])
@pytest.mark.parametrize("override", [False, True])
def test_proxy_transport_and_response_contract(monkeypatch, proxy, role, override):
    if override:
        monkeypatch.setattr(settings, f"litellm_{role}_model", f"{role}-alias")
    requests = []
    clients = []
    sdk = openai.AsyncOpenAI
    payload = (
        {"assistant_message": "A reflective reply"}
        if role == "chat"
        else {"topic": "Work", "description": "Finding balance"}
    )

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(payload)}}]},
        )

    def build_client(**kwargs):
        assert kwargs["timeout"].read == 12
        assert kwargs["max_retries"] == 0
        client = sdk(
            **kwargs, http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        )
        clients.append(client)
        return client

    monkeypatch.setattr(openai, "AsyncOpenAI", build_client)

    async def run():
        if role == "chat":
            callback = AsyncMock()
            result = await get_chat_llm_client().respond(
                "A busy day", {}, {}, "id", on_text_chunk=callback
            )
            assert result.assistant_message == payload["assistant_message"]
            callback.assert_awaited_once_with(payload["assistant_message"])
        else:
            assert (await get_topic_llm_client().create_topic({})).topic == "Work"

    asyncio.run(run())
    assert clients[0].is_closed()
    assert len(requests) == 1
    request = requests[0]
    assert str(request.url) == "https://proxy.example.com/team/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer test-proxy-key"
    body = json.loads(request.content)
    assert body["model"] == (f"{role}-alias" if override else "shared-alias")
    assert body["response_format"] == {"type": "json_object"}
    assert [message["role"] for message in body["messages"]] == ["system", "user"]
    assert json.loads(body["messages"][1]["content"])


@pytest.mark.parametrize(
    "field,value,expected",
    [
        ("litellm_base_url", None, "LITELLM_BASE_URL"),
        ("litellm_base_url", "ftp://proxy.example.com", "LITELLM_BASE_URL"),
        ("litellm_base_url", "https://user:secret@proxy.example.com", "LITELLM_BASE_URL"),
        ("litellm_api_key", " ", "LITELLM_API_KEY"),
        ("litellm_model", "", "LITELLM_CHAT_MODEL"),
    ],
)
def test_missing_proxy_configuration(monkeypatch, proxy, field, value, expected):
    monkeypatch.setattr(settings, field, value)
    with pytest.raises(HTTPException, match=expected):
        get_chat_llm_client()


def test_proxy_errors_are_sanitized_and_client_closed(monkeypatch, proxy, caplog):
    sdk = openai.AsyncOpenAI
    clients = []

    def build_client(**kwargs):
        transport = httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": {"message": "private-response"}})
        )
        client = sdk(**kwargs, http_client=httpx.AsyncClient(transport=transport))
        clients.append(client)
        return client

    monkeypatch.setattr(openai, "AsyncOpenAI", build_client)
    with pytest.raises(RuntimeError, match="LiteLLM provider request failed") as error:
        asyncio.run(get_chat_llm_client().respond("private-input", {}, {}, "id"))
    assert clients[0].is_closed()
    assert "private-response" not in str(error.value) + caplog.text
    assert "test-proxy-key" not in caplog.text
