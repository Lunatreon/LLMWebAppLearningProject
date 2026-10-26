"""Ollama transport, streaming, generation scheduling, and startup warming."""

import asyncio
import json
import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any

import httpx
from fastapi import HTTPException, status

from backend.core.config import settings
from backend.llm.context import chat_request_payload, topic_request_payload
from backend.llm.json_response import parse_json_response, raise_bad_gateway
from backend.llm.responses import (
    CHAT_RESPONSE_SCHEMA,
    TOPIC_RESPONSE_SCHEMA,
    topic_response_schema,
    chat_result_from_payload,
    topic_result_from_payload,
)
from backend.llm.streaming import (
    assistant_message_prefix_from_json,
    top_level_json_string_value_start,
)
from backend.llm.types import ChatLLMResult, TextChunkCallback, TopicLLMResult
from backend.llm.prompts import llm_system_prompt as read_system_prompt

logger = logging.getLogger(__name__)


ollama_generation_lock = asyncio.Lock()


async def warm_ollama_model() -> None:
    """Load configured Ollama role models without blocking application startup."""
    role_models: list[tuple[str, str, int]] = []
    if (settings.chat_llm_provider or settings.llm_provider).lower() == "ollama":
        role_models.append(
            (
                "chat",
                settings.ollama_chat_model or settings.ollama_model,
                settings.ollama_chat_num_gpu,
            )
        )
    if (settings.topic_llm_provider or settings.llm_provider).lower() == "ollama":
        role_models.append(
            (
                "topic",
                settings.ollama_topic_model or settings.ollama_model,
                settings.ollama_topic_num_gpu,
            )
        )
    for role, model, num_gpu in role_models:
        try:
            async with (
                ollama_generation_lock,
                httpx.AsyncClient(
                    base_url=settings.ollama_base_url.rstrip("/"),
                    timeout=settings.ollama_timeout_seconds,
                ) as client,
            ):
                response = await client.post(
                    "/api/generate",
                    json={
                        "model": model,
                        "prompt": "",
                        "stream": False,
                        "keep_alive": settings.ollama_keep_alive,
                        "options": {
                            "num_ctx": settings.ollama_context_window,
                            "num_gpu": num_gpu,
                        },
                    },
                )
                response.raise_for_status()
            logger.info("Ollama %s model %s is warm and ready", role, model)
        except Exception:
            # Readiness must not prevent auth, stored chats, or other API features.
            logger.exception("Could not prewarm Ollama %s model %s", role, model)


class OllamaBaseClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_seconds: float,
        context_window: int,
        max_tokens: int,
        num_gpu: int,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.client: Any | None = None
        self.model = model
        self.context_window = context_window
        self.max_tokens = max_tokens
        self.num_gpu = num_gpu

    async def post(self, path: str, payload: dict[str, Any]) -> httpx.Response:
        if self.client is not None:
            return await self.client.post(path, json=payload)
        async with httpx.AsyncClient(
            base_url=self.base_url,
            timeout=self.timeout_seconds,
        ) as client:
            return await client.post(path, json=payload)

    @asynccontextmanager
    async def stream(
        self,
        path: str,
        payload: dict[str, Any],
    ) -> AsyncIterator[httpx.Response]:
        if self.client is not None:
            async with self.client.stream(path, json=payload) as response:
                yield response
            return
        async with (
            httpx.AsyncClient(
                base_url=self.base_url,
                timeout=self.timeout_seconds,
            ) as client,
            client.stream("POST", path, json=payload) as response,
        ):
            yield response

    def chat_request_body(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any] | None,
        temperature: float,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        return {
            "model": self.model,
            "stream": stream,
            "think": False,
            "keep_alive": settings.ollama_keep_alive,
            **({"format": response_schema} if response_schema is not None else {}),
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_payload},
            ],
            "options": {
                "num_ctx": self.context_window,
                "num_predict": self.max_tokens,
                "num_gpu": self.num_gpu,
                "temperature": temperature,
            },
        }

    async def request_json(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any] | None,
        temperature: float,
    ) -> dict[str, Any]:
        started_at = monotonic()
        try:
            # Avoid competing local generations fighting over the same RAM/VRAM.
            async with ollama_generation_lock:
                response = await self.post(
                    "/api/chat",
                    self.chat_request_body(
                        system_prompt,
                        user_payload,
                        response_schema,
                        temperature,
                        stream=False,
                    ),
                )
            response.raise_for_status()
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Could not connect to Ollama. Start Ollama and make sure "
                    f"it is available at {self.base_url}."
                ),
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Ollama took too long to generate a response",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = ollama_error_detail(exc.response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {detail}",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {exc}",
            ) from exc

        logger.info(
            "Ollama model %s completed in %.2fs",
            self.model,
            monotonic() - started_at,
        )

        try:
            response_payload = response.json()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Ollama returned an invalid HTTP response",
            ) from exc

        if not isinstance(response_payload, dict):
            raise_bad_gateway("Ollama returned an unexpected HTTP response")
        # Ollama reports nanoseconds. Record timings, never prompt/reply text,
        # so model loading, input processing and generation can be distinguished.
        logger.info(
            "Ollama timing model=%s num_gpu=%s load_s=%.2f prompt_s=%.2f generation_s=%.2f input_tokens=%s output_tokens=%s",
            self.model,
            self.num_gpu,
            float(response_payload.get("load_duration") or 0) / 1e9,
            float(response_payload.get("prompt_eval_duration") or 0) / 1e9,
            float(response_payload.get("eval_duration") or 0) / 1e9,
            response_payload.get("prompt_eval_count"),
            response_payload.get("eval_count"),
        )
        message = response_payload.get("message")
        content = message.get("content") if isinstance(message, dict) else None
        if response_schema is None:
            # Conversational recovery needs text, not model-generated JSON.
            # Python builds the API envelope after validating the reply.
            if not isinstance(content, str) or not content.strip():
                raise_bad_gateway("The model returned an empty reply")
            if response_payload.get("done_reason") == "length":
                raise_bad_gateway("The model could not finish the reply within its output limit")
            text = content.strip()
            # A model may retain the old envelope despite the plain-text request.
            # Unwrap complete JSON; never show private fields or broken JSON.
            if text.startswith("{") or text.startswith("```json"):
                return {
                    "assistant_message": chat_result_from_payload(
                        parse_json_response(text)
                    ).assistant_message
                }
            return {"assistant_message": text}
        return parse_json_response(content)

    async def request_json_stream(
        self,
        system_prompt: str,
        user_payload: str,
        response_schema: dict[str, Any],
        temperature: float,
        on_text_chunk: TextChunkCallback,
    ) -> tuple[dict[str, Any], str]:
        """Stream Ollama NDJSON while exposing only the assistant text field."""

        started_at = monotonic()
        generated_json = ""
        emitted_text = ""
        stream_finished = False
        finish_reason = None
        generated_tokens = None
        try:
            # Ollama can stream its structured JSON a fragment at a time. Keep
            # the full JSON private and emit only the decoded assistant message.
            async with (
                ollama_generation_lock,
                self.stream(
                    "/api/chat",
                    self.chat_request_body(
                        system_prompt,
                        user_payload,
                        response_schema,
                        temperature,
                        stream=True,
                    ),
                ) as response,
            ):
                if response.is_error:
                    await response.aread()
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        raise_bad_gateway("Ollama returned an invalid stream event")
                    if not isinstance(event, dict):
                        raise_bad_gateway("Ollama returned an unexpected stream event")
                    if isinstance(event.get("error"), str):
                        raise_bad_gateway(f"Ollama request failed: {event['error']}")

                    message = event.get("message")
                    content = message.get("content") if isinstance(message, dict) else None
                    if isinstance(content, str):
                        generated_json += content
                        visible_text = assistant_message_prefix_from_json(generated_json)
                        if len(visible_text) > len(emitted_text):
                            delta = visible_text[len(emitted_text) :]
                            emitted_text = visible_text
                            await on_text_chunk(delta)
                    if event.get("done") is True:
                        stream_finished = True
                        finish_reason = event.get("done_reason")
                        generated_tokens = event.get("eval_count")
        except httpx.ConnectError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=(
                    "Could not connect to Ollama. Start Ollama and make sure "
                    f"it is available at {self.base_url}."
                ),
            ) from exc
        except httpx.TimeoutException as exc:
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Ollama took too long to generate a response",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = ollama_error_detail(exc.response)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {detail}",
            ) from exc
        except httpx.RequestError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Ollama request failed: {exc}",
            ) from exc

        if not stream_finished:
            raise_bad_gateway("Ollama ended the response stream unexpectedly")
        # A decoded prefix is not necessarily a complete reply. Only recover
        # damaged metadata after the assistant's JSON string has closed.
        value_start = top_level_json_string_value_start(generated_json, "assistant_message")
        if value_start is not None:
            try:
                # A literal newline is malformed JSON, but does not mean the
                # reply was truncated. Require a closing quote even here.
                json.JSONDecoder(strict=False).raw_decode(generated_json[value_start - 1 :])
            except ValueError:
                logger.warning(
                    "Invalid streamed chat text: model=%s stop=%s tokens=%s budget=%s",
                    self.model,
                    finish_reason,
                    generated_tokens,
                    self.max_tokens,
                )
                raise_bad_gateway("The reply was cut short before it finished. Please try again.")
        logger.info(
            "Ollama model %s completed in %.2fs",
            self.model,
            monotonic() - started_at,
        )
        try:
            payload = parse_json_response(generated_json)
        except HTTPException as exc:
            if exc.status_code != status.HTTP_502_BAD_GATEWAY or not emitted_text.strip():
                raise
            # The assistant_message string is decoded incrementally before any
            # private structured fields are exposed. If Qwen finishes that
            # message but damages the surrounding JSON, keep the useful reply
            # and discard only the optional profile/map data.
            logger.warning(
                "Recovering %s streamed assistant characters after malformed Ollama JSON",
                len(emitted_text),
            )
            payload = {
                "assistant_message": emitted_text,
                "profile": {},
                "map_suggestion": None,
            }
        return payload, emitted_text


class OllamaChatLLMClient(OllamaBaseClient):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        from copy import copy

        request = {
            "system_prompt": read_system_prompt("chat"),
            "user_payload": chat_request_payload(user_input, profile, chat_info, chat_id),
            "response_schema": CHAT_RESPONSE_SCHEMA,
            "temperature": settings.ollama_chat_temperature,
        }
        emitted_text = ""
        recovered = False
        try:
            if on_text_chunk is None:
                payload = await self.request_json(**request)
            else:
                payload, emitted_text = await self.request_json_stream(
                    **request,
                    on_text_chunk=on_text_chunk,
                )
            result = chat_result_from_payload(payload)
        except HTTPException as exc:
            if exc.status_code != 502 or exc.detail not in {
                "The reply was cut short before it finished. Please try again.",
                "LLM returned invalid JSON",
                "LLM returned an empty response",
                "LLM returned a non-object JSON response",
                "Chat-LLM response did not match the expected schema",
            }:
                raise
            retry = copy(self)
            retry.max_tokens = max(self.max_tokens, min(3072, max(1536, self.max_tokens * 2)))
            # Remove the editable prompt's standard JSON contract/example so
            # recovery does not make the model follow conflicting formats.
            request["system_prompt"] = re.sub(
                r"(?ms)^OUTPUT CONTRACT\s*\n.*?(?=^INPUT AND MEMORY\s*$)",
                "",
                request["system_prompt"],
            )
            request["system_prompt"] = re.sub(
                r"(?m)^Output:.*$",
                "",
                request["system_prompt"],
            )
            request["system_prompt"] += (
                "\nTRANSPORT OVERRIDE FOR THIS REPLY: The application handles JSON. "
                "Return ONLY the conversational reply as plain text, not JSON, code fences, "
                "field names, or reasoning notes. This replaces earlier JSON formatting "
                "instructions and examples, while all reflection and safety guidance still applies. "
                "Use at most 100 words and end with a complete sentence. Do not repeat passages."
            )
            request["response_schema"] = None
            request["temperature"] = 0.2
            logger.warning(
                "Recovering malformed chat reply with a %s-token budget", retry.max_tokens
            )
            # Regenerate from the original input, not the broken partial answer.
            # Deliver it only in the final result so two replies are not joined.
            result = chat_result_from_payload(await retry.request_json(**request))
            recovered = True
        if (
            on_text_chunk is not None
            and not recovered
            and result.assistant_message.startswith(emitted_text)
        ):
            remaining_text = result.assistant_message[len(emitted_text) :]
            if remaining_text:
                await on_text_chunk(remaining_text)
        return result


class OllamaTopicLLMClient(OllamaBaseClient):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        from copy import copy

        request = {
            "system_prompt": read_system_prompt("topic"),
            "user_payload": topic_request_payload(
                chat_info, matched_patterns, topic_hint, available_topics
            ),
            "response_schema": topic_response_schema(),
            "temperature": 0.2,
        }
        try:
            return topic_result_from_payload(await self.request_json(**request))
        except HTTPException as exc:
            if exc.status_code != 502 or exc.detail not in {
                "LLM returned invalid JSON",
                "LLM returned an empty response",
                "LLM returned a non-object JSON response",
                "Topic-LLM response did not match the expected schema",
            }:
                raise
            # Retry once with room for the structured envelope. Do not reuse
            # broken JSON as evidence or alter this client's configured budget.
            retry = copy(self)
            retry.max_tokens = max(self.max_tokens, min(3072, max(1536, self.max_tokens * 2)))
            request["system_prompt"] += (
                "\nReturn a complete compact JSON object. At most one primary topic, "
                "additional_topics must be [], and at most one brief observation. "
                "Finish all required fields. Do not repeat text."
            )
            request["temperature"] = 0.0
            logger.warning(
                "Retrying malformed map analysis with a %s-token budget", retry.max_tokens
            )
            return topic_result_from_payload(await retry.request_json(**request))


def ollama_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text or f"HTTP {response.status_code}"
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return f"HTTP {response.status_code}"
