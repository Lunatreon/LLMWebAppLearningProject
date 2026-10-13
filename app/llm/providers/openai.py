"""OpenAI transport using the official asynchronous SDK."""

from typing import Any

from app.llm.context import chat_request_payload, topic_request_payload
from app.llm.json_response import parse_json_response
from app.llm.responses import chat_result_from_payload, topic_result_from_payload
from app.llm.types import ChatLLMResult, TextChunkCallback, TopicLLMResult
from app.llm.prompts import read_system_prompt


class OpenAIBaseClient:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model


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
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
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
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
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
