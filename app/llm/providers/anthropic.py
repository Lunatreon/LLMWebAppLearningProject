"""Anthropic transport using the official asynchronous SDK."""

from typing import Any

from app.llm.context import chat_request_payload, topic_request_payload
from app.llm.json_response import parse_json_response
from app.llm.responses import chat_result_from_payload, topic_result_from_payload
from app.llm.types import ChatLLMResult, TextChunkCallback, TopicLLMResult
from app.llm.prompts import read_system_prompt


class AnthropicBaseClient:
    def __init__(self, api_key: str, model: str, max_tokens: int) -> None:
        from anthropic import AsyncAnthropic

        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model
        self.max_tokens = max_tokens

    @staticmethod
    def response_text(response: Any) -> str:
        return "".join(
            block.text
            for block in response.content
            if getattr(block, "type", None) == "text" and isinstance(block.text, str)
        )


class AnthropicChatLLMClient(AnthropicBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=read_system_prompt("chat"),
            messages=[
                {
                    "role": "user",
                    "content": chat_request_payload(user_input, profile, chat_info, chat_id),
                }
            ],
        )
        result = chat_result_from_payload(parse_json_response(self.response_text(response)))
        if on_text_chunk is not None:
            await on_text_chunk(result.assistant_message)
        return result


class AnthropicTopicLLMClient(AnthropicBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens,
            system=read_system_prompt("topic"),
            messages=[
                {
                    "role": "user",
                    "content": topic_request_payload(
                        chat_info,
                        matched_patterns,
                        topic_hint,
                        available_topics,
                    ),
                }
            ],
        )
        return topic_result_from_payload(parse_json_response(self.response_text(response)))
