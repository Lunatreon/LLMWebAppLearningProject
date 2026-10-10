"""Select configured providers and validate their credentials."""

from typing import NoReturn

from fastapi import HTTPException, status

from app.core.config import settings
from app.services.llm.providers.anthropic import AnthropicChatLLMClient, AnthropicTopicLLMClient
from app.services.llm.providers.local import LocalChatLLMClient, LocalTopicLLMClient
from app.services.llm.providers.ollama import OllamaChatLLMClient, OllamaTopicLLMClient
from app.services.llm.providers.openai import OpenAIChatLLMClient, OpenAITopicLLMClient
from app.services.llm.types import ChatLLMClient, TopicLLMClient


def ensure_openai_api_key() -> str:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENAI_API_KEY must be configured when LLM_PROVIDER is openai",
        )
    return settings.openai_api_key


def ensure_anthropic_api_key() -> str:
    if not settings.anthropic_api_key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="ANTHROPIC_API_KEY must be configured when LLM_PROVIDER is anthropic",
        )
    return settings.anthropic_api_key


def unsupported_provider(provider: str) -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=(
            f"Unsupported LLM provider '{provider}'. "
            "Use mock, openai, anthropic, or ollama."
        ),
    )


def get_chat_llm_client() -> ChatLLMClient:
    provider = (settings.chat_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAIChatLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_chat_model or settings.openai_model,
        )
    if provider == "anthropic":
        return AnthropicChatLLMClient(
            api_key=ensure_anthropic_api_key(),
            model=settings.anthropic_chat_model or settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
        )
    if provider == "ollama":
        return OllamaChatLLMClient(
            base_url=settings.ollama_base_url,
            model=settings.ollama_chat_model or settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            context_window=settings.ollama_context_window,
            max_tokens=settings.ollama_chat_max_tokens,
            num_gpu=settings.ollama_chat_num_gpu,
        )
    if provider in {"mock", "local"}:
        return LocalChatLLMClient()
    unsupported_provider(provider)


def get_topic_llm_client() -> TopicLLMClient:
    provider = (settings.topic_llm_provider or settings.llm_provider).lower()
    if provider == "openai":
        return OpenAITopicLLMClient(
            api_key=ensure_openai_api_key(),
            model=settings.openai_topic_model or settings.openai_model,
        )
    if provider == "anthropic":
        return AnthropicTopicLLMClient(
            api_key=ensure_anthropic_api_key(),
            model=settings.anthropic_topic_model or settings.anthropic_model,
            max_tokens=settings.anthropic_max_tokens,
        )
    if provider == "ollama":
        return OllamaTopicLLMClient(
            base_url=settings.ollama_base_url,
            model=settings.ollama_topic_model or settings.ollama_model,
            timeout_seconds=settings.ollama_timeout_seconds,
            context_window=settings.ollama_context_window,
            max_tokens=settings.ollama_topic_max_tokens,
            num_gpu=settings.ollama_topic_num_gpu,
        )
    if provider in {"mock", "local"}:
        return LocalTopicLLMClient()
    unsupported_provider(provider)
