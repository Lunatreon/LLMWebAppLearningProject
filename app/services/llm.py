import json
from dataclasses import dataclass
from typing import Any, Protocol

from fastapi import HTTPException, status

from app.core.config import settings


@dataclass
class LLMResult:
    assistant_message: str
    profile: dict[str, Any]


class LLMClient(Protocol):
    async def respond(self, user_input: str, profile: dict[str, Any]) -> LLMResult:
        """Return an assistant response and a complete updated user profile."""


class LocalProfileLLMClient:
    """Development fallback that behaves like a tiny deterministic profile updater."""

    async def respond(self, user_input: str, profile: dict[str, Any]) -> LLMResult:
        updated_profile = dict(profile or {})
        updated_profile["last_user_message"] = user_input
        updated_profile["message_count"] = int(updated_profile.get("message_count", 0)) + 1

        recent_messages = list(updated_profile.get("recent_messages", []))
        recent_messages.append(user_input)
        updated_profile["recent_messages"] = recent_messages[-10:]

        assistant_message = (
            "I received your message and updated your profile context. "
            "Connect a real LLM provider to generate personalized replies."
        )
        return LLMResult(assistant_message=assistant_message, profile=updated_profile)


class OpenAILLMClient:
    def __init__(self, api_key: str, model: str) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key)
        self.model = model

    async def respond(self, user_input: str, profile: dict[str, Any]) -> LLMResult:
        response = await self.client.chat.completions.create(
            model=self.model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are the FeelY app assistant. Reply with valid JSON only. "
                        "The JSON object must contain `assistant_message` as a string and "
                        "`profile` as the complete updated user profile object. Use the "
                        "existing profile to refer to past experiences, preferences, goals, "
                        "and important context. Preserve useful existing profile fields and "
                        "update the profile when the user shares durable information."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {
                            "current_profile": profile or {},
                            "new_user_input": user_input,
                        },
                        ensure_ascii=True,
                    ),
                },
            ],
        )

        content = response.choices[0].message.content
        if not content:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM returned an empty response",
            )

        try:
            payload = json.loads(content)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM returned invalid JSON",
            ) from exc

        assistant_message = payload.get("assistant_message")
        updated_profile = payload.get("profile")
        if not isinstance(assistant_message, str) or not isinstance(updated_profile, dict):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="LLM response did not match the expected schema",
            )

        return LLMResult(assistant_message=assistant_message, profile=updated_profile)


def get_llm_client() -> LLMClient:
    if settings.llm_provider.lower() == "openai":
        if not settings.openai_api_key:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="OPENAI_API_KEY must be configured when LLM_PROVIDER is openai",
            )
        return OpenAILLMClient(api_key=settings.openai_api_key, model=settings.openai_model)

    return LocalProfileLLMClient()
