"""Journal analysis orchestration and retry policy."""

import logging

from fastapi import HTTPException, status

from app.core.config import settings
from app.llm.providers.anthropic import AnthropicBaseClient
from app.llm.context import journal_request_payload
from app.llm.providers.factory import (
    ensure_anthropic_api_key,
    ensure_openai_api_key,
    unsupported_provider,
)
from app.llm.json_response import parse_json_response
from app.llm.providers.local import local_journal_analysis
from app.llm.providers.ollama import OllamaBaseClient
from app.llm.providers.openai import OpenAIBaseClient
from app.llm.responses import JOURNAL_RESPONSE_SCHEMA, journal_result_from_payload
from app.llm.types import JournalLLMResult
from app.llm.prompts import read_system_prompt

logger = logging.getLogger(__name__)


async def analyse_journal_text(journal_text: str, entry_date: str) -> JournalLLMResult:
    """Find optional map candidates without changing the user's confirmed map."""

    provider = (
        settings.journal_llm_provider or settings.topic_llm_provider or settings.llm_provider
    ).lower()
    request_payload = journal_request_payload(journal_text, entry_date)

    if provider in {"mock", "local"}:
        return local_journal_analysis(journal_text)
    if provider == "openai":
        client = OpenAIBaseClient(
            api_key=ensure_openai_api_key(),
            model=(
                settings.openai_journal_model
                or settings.openai_topic_model
                or settings.openai_model
            ),
        )
        response = await client.complete(
            [
                {"role": "system", "content": read_system_prompt("journal")},
                {"role": "user", "content": request_payload},
            ],
        )
        return journal_result_from_payload(parse_json_response(response.choices[0].message.content))
    if provider == "anthropic":
        client = AnthropicBaseClient(
            api_key=ensure_anthropic_api_key(),
            model=(
                settings.anthropic_journal_model
                or settings.anthropic_topic_model
                or settings.anthropic_model
            ),
            max_tokens=settings.anthropic_max_tokens,
        )
        response = await client.client.messages.create(
            model=client.model,
            max_tokens=client.max_tokens,
            system=read_system_prompt("journal"),
            messages=[{"role": "user", "content": request_payload}],
        )
        return journal_result_from_payload(parse_json_response(client.response_text(response)))
    if provider == "ollama":
        num_gpu = (
            settings.ollama_journal_num_gpu
            if settings.ollama_journal_num_gpu is not None
            else settings.ollama_topic_num_gpu
        )
        client_options = {
            "base_url": settings.ollama_base_url,
            "model": (
                settings.ollama_journal_model
                or settings.ollama_topic_model
                or settings.ollama_model
            ),
            "timeout_seconds": settings.ollama_timeout_seconds,
            "context_window": settings.ollama_context_window,
            "num_gpu": num_gpu,
        }
        client = OllamaBaseClient(
            **client_options,
            max_tokens=settings.ollama_journal_max_tokens,
        )
        system_prompt = read_system_prompt("journal")
        try:
            payload = await client.request_json(
                system_prompt=system_prompt,
                user_payload=request_payload,
                response_schema=JOURNAL_RESPONSE_SCHEMA,
                temperature=0.2,
            )
            return journal_result_from_payload(payload)
        except HTTPException as exc:
            retryable_details = {
                "LLM returned an empty response",
                "LLM returned invalid JSON",
                "LLM returned a non-object JSON response",
                "Journal-LLM response did not match the expected schema",
            }
            if (
                exc.status_code != status.HTTP_502_BAD_GATEWAY
                or exc.detail not in retryable_details
            ):
                raise

            retry_max_tokens = min(
                1536,
                max(768, settings.ollama_journal_max_tokens * 2),
            )
            logger.warning(
                "Retrying Ollama journal analysis after an incomplete structured response "
                "with %s output tokens",
                retry_max_tokens,
            )
            retry_client = OllamaBaseClient(
                **client_options,
                max_tokens=retry_max_tokens,
            )
            payload = await retry_client.request_json(
                system_prompt=(
                    f"{system_prompt}\n\nKeep every field concise so the complete JSON object "
                    "fits within the response limit."
                ),
                user_payload=request_payload,
                response_schema=JOURNAL_RESPONSE_SCHEMA,
                temperature=0.1,
            )
            return journal_result_from_payload(payload)
    unsupported_provider(provider)
