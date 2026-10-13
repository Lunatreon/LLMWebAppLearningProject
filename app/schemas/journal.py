from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.profile import TopicCategory

JournalSuggestionKind = Literal["topic", "map_entry"]
JournalSuggestionStatus = Literal["pending", "saved", "dismissed"]


class JournalSuggestion(BaseModel):
    topic_category: TopicCategory = "other"
    id: str
    kind: JournalSuggestionKind
    category: str
    title: str = ""
    text: str
    reason: str
    status: JournalSuggestionStatus = "pending"
    created_at: str
    saved_item_id: str | None = None


class JournalEntryRead(BaseModel):
    entry_date: str
    content: str = ""
    word_count: int = 0
    suggestions: list[JournalSuggestion] = Field(default_factory=list)
    analysis_stale: bool = False
    analysed_at: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class JournalEntryListItem(BaseModel):
    entry_date: str
    excerpt: str
    word_count: int
    suggestion_count: int
    updated_at: datetime


class JournalEntryUpdate(BaseModel):
    content: str = Field(default="", max_length=100_000)

    model_config = ConfigDict(extra="forbid")


class JournalAnalysisResponse(BaseModel):
    entry: JournalEntryRead


class JournalSuggestionDecision(BaseModel):
    topic_category: TopicCategory | None = None
    accepted: bool = True
    category: str | None = Field(default=None, max_length=40)
    title: str | None = Field(default=None, max_length=120)
    text: str | None = Field(default=None, max_length=1000)
    topic_space_id: str | None = Field(default=None, max_length=64)

    model_config = ConfigDict(extra="forbid")


class JournalSuggestionDecisionResponse(BaseModel):
    suggestion: JournalSuggestion
    map: dict
