"""Provider-independent result types and client contracts."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

TextChunkCallback = Callable[[str], Awaitable[None]]


@dataclass
class ChatLLMResult:
    assistant_message: str
    profile: dict[str, Any]
    map_suggestion: dict[str, str] | None = None


@dataclass
class TopicLLMResult:
    topic: str
    description: str
    existing_topic_id: str | None = None
    parent_topic_id: str | None = None
    additional_topics: list["TopicLLMResult"] = field(default_factory=list)
    category: str = "other"
    related_topic_ids: list[str] = field(default_factory=list)
    map_suggestion: dict[str, Any] | None = None


@dataclass
class JournalLLMResult:
    suggestions: list[dict[str, str]]


class ChatLLMClient(Protocol):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        """Return the direct chat response and complete updated user profile."""


class TopicLLMClient(Protocol):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        """Return a topic and short description for an analysed chat."""
