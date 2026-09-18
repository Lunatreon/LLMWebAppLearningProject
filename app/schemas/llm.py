from typing import Any

from pydantic import BaseModel, Field, model_validator

from app.schemas.profile import TopicCategory


class LLMRequest(BaseModel):
    message: str | None = Field(default=None, min_length=1, max_length=8000)
    context: str | None = Field(default=None, min_length=1, max_length=8000)
    chat_id: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def require_chat_text(self) -> "LLMRequest":
        if not self.input_text.strip():
            raise ValueError("Either message or context must be provided.")
        return self

    @property
    def input_text(self) -> str:
        return self.context if self.context is not None else self.message or ""


class ChatCreateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=120)


class ChatRead(BaseModel):
    chat_id: str
    title: str
    message_count: int
    updated_at: str | None = None
    pending_topic: dict[str, Any] | None = None
    pending_topics: list[dict[str, Any]] = Field(default_factory=list)
    pending_map_suggestion: dict[str, Any] | None = None
    messages: list[dict[str, Any]] = Field(default_factory=list)


class TopicSuggestion(BaseModel):
    category: TopicCategory = "other"
    related_topic_ids: list[str] = Field(default_factory=list)
    chat_id: str
    topic: str
    description: str
    confidence: float
    matched_patterns: list[str]
    status: str = "pending"
    existing_topic_id: str | None = None
    parent_topic_id: str | None = None
    suggestion_id: str | None = None
    queue_position: int = 1
    queue_total: int = 1


class LLMResponse(BaseModel):
    assistant_message: str
    profile: dict[str, Any]
    chat_id: str
    chat_info: dict[str, Any]
    map_suggestion: dict[str, Any] | None = None
    topic_analysis_status: str = "queued"


class TopicSuggestionResponse(BaseModel):
    suggestion: TopicSuggestion | None = None
    suggestions: list[TopicSuggestion] = Field(default_factory=list)
    chat_title: str | None = None


class TopicConfirmationRequest(BaseModel):
    category: TopicCategory = "other"
    related_topic_ids: list[str] = Field(default_factory=list, max_length=24)
    chat_id: str = Field(min_length=1, max_length=120)
    topic: str = Field(min_length=1, max_length=120)
    description: str = Field(min_length=1, max_length=2000)
    accepted: bool = True
    existing_topic_space_id: str | None = Field(default=None, max_length=64)
    parent_topic_space_id: str | None = Field(default=None, max_length=64)


class TopicConfirmationResponse(BaseModel):
    accepted: bool
    profile: dict[str, Any]


class MapSuggestionConfirmationRequest(BaseModel):
    chat_id: str = Field(min_length=1, max_length=120)
    accepted: bool = True
    category: str = Field(min_length=1, max_length=40)
    text: str = Field(min_length=1, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)
    topic_space_id: str | None = Field(default=None, max_length=64)


class MapSuggestionConfirmationResponse(BaseModel):
    accepted: bool
    entry: dict[str, Any] | None = None
    map: dict[str, Any]
