"""OpenAI transport using the official asynchronous SDK."""

from typing import Any
import logging
import httpx

from backend.core.config import settings

from backend.llm.context import chat_request_payload, topic_request_payload
from backend.llm.json_response import parse_json_response
from backend.llm.responses import chat_result_from_payload, topic_result_from_payload
from backend.llm.types import ChatLLMResult, TextChunkCallback, TopicLLMResult
from backend.llm.prompts import llm_system_prompt as read_system_prompt

logger = logging.getLogger(__name__)


class OpenAIBaseClient:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(
            api_key=api_key,
            timeout=httpx.Timeout(
                settings.openai_timeout_seconds,
                connect=min(5.0, settings.openai_timeout_seconds),
            ),
            max_retries=settings.openai_max_retries,
        )
        self.model = model

    async def complete(self, messages):
        from openai import APIError

        try:
            return await self.client.chat.completions.create(
                model=self.model,
                response_format={"type": "json_object"},
                messages=messages,
            )
        except APIError as error:
            # SDK exceptions may contain the provider response or private request text.
            logger.warning(
                "OpenAI request failed: error_type=%s status=%s",
                type(error).__name__,
                getattr(error, "status_code", None),
            )
            raise RuntimeError("OpenAI provider request failed.") from None
        finally:
            # Each factory-created provider owns one request, including cancellation.
            await self.client.close()


class OpenAIChatLLMClient(OpenAIBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        response = await self.complete(
            [
                {
                    "role": "system",
                    "content": read_system_prompt("chat"),
                },
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                },
            ],
        )
        result = chat_result_from_payload(parse_json_response(response.choices[0].message.content))
        if on_text_chunk is not None:
            await on_text_chunk(result.assistant_message)
        return result


class OpenAITopicLLMClient(OpenAIBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        response = await self.complete(
            [
                {
                    "role": "system",
                    "content": read_system_prompt("topic"),
                },
                {
                    "role": "user",
                    "content": topic_request_payload(
                        chat_info,
                        matched_patterns,
                        topic_hint,
                        available_topics,
                    ),
                },
            ],
        )
        return topic_result_from_payload(parse_json_response(response.choices[0].message.content))
