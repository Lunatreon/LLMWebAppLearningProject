import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import openai
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.llm.providers.factory import get_chat_llm_client, get_topic_llm_client
from app.llm.tasks.journal import analyse_journal_text


@pytest.mark.parametrize("role", ["chat", "topic", "journal"])
def test_openai_roles_preserve_credentials_models_and_prompt_contract(monkeypatch, role):
    monkeypatch.setattr(settings, f"{role}_llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_api_key", "test-only-key")
    monkeypatch.setattr(settings, f"openai_{role}_model", f"test-{role}-model")
    payloads = {
        "chat": {"assistant_message": "A reflective reply"},
        "topic": {"topic": "Work", "description": "Finding a balance"},
        "journal": {"suggestions": []},
    }
    response = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(payloads[role])))]
    )
    create = AsyncMock(return_value=response)
    credentials = []

    close = AsyncMock()

    def client_factory(*, api_key, timeout, max_retries):
        assert timeout.read == settings.openai_timeout_seconds
        assert timeout.connect == min(5.0, settings.openai_timeout_seconds)
        assert max_retries == settings.openai_max_retries
        credentials.append(api_key)
        return SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create)), close=close
        )

    monkeypatch.setattr(openai, "AsyncOpenAI", client_factory)

    if role == "chat":
        on_chunk = AsyncMock()
        result = asyncio.run(
            get_chat_llm_client().respond("A busy day", {}, {}, "chat-id", on_text_chunk=on_chunk)
        )
        assert result.assistant_message == "A reflective reply"
        on_chunk.assert_awaited_once_with("A reflective reply")
    elif role == "topic":
        result = asyncio.run(get_topic_llm_client().create_topic({}, []))
        assert result.topic == "Work"
    else:
        result = asyncio.run(analyse_journal_text("A busy day", "2026-10-10"))
        assert result.suggestions == []

    assert credentials == ["test-only-key"]
    create.assert_awaited_once()
    close.assert_awaited_once()
    request = create.call_args.kwargs
    assert request["model"] == f"test-{role}-model"
    assert request["response_format"] == {"type": "json_object"}
    assert [message["role"] for message in request["messages"]] == ["system", "user"]
    assert request["messages"][0]["content"].strip()
    assert isinstance(json.loads(request["messages"][1]["content"]), dict)


def test_openai_model_fallback_and_missing_key(monkeypatch):
    monkeypatch.setattr(settings, "chat_llm_provider", "openai")
    monkeypatch.setattr(settings, "openai_chat_model", "")
    monkeypatch.setattr(settings, "openai_model", "fallback-model")
    monkeypatch.setattr(settings, "openai_api_key", "test-only-key")
    monkeypatch.setattr(openai, "AsyncOpenAI", lambda **kwargs: object())
    assert get_chat_llm_client().model == "fallback-model"

    monkeypatch.setattr(settings, "openai_api_key", None)
    with pytest.raises(HTTPException, match="OPENAI_API_KEY") as exc:
        get_chat_llm_client()
    assert exc.value.status_code == 500
