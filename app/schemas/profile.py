from typing import Any, Literal

from pydantic import BaseModel, Field


class ProfileRead(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class ProfileUpdate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


MapEntryCategory = Literal[
    "inherited_script",
    "merged_topic",
    "own_perception",
    "value",
    "body_signal",
    "practice",
    "evidence",
]


class SelfAuthorshipMapRead(BaseModel):
    topic_spaces: list[dict[str, Any]] = Field(default_factory=list)
    unassigned_entries: list[dict[str, Any]] = Field(default_factory=list)
    updated_at: str | None = None


class MapEntryCreate(BaseModel):
    category: MapEntryCategory
    text: str = Field(min_length=1, max_length=1000)
    topic_space_id: str | None = Field(default=None, max_length=64)
    source_chat_id: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=1000)


class MapEntryCreateResponse(BaseModel):
    entry: dict[str, Any]
    map: SelfAuthorshipMapRead


class MapEntryUpdate(BaseModel):
    category: MapEntryCategory | None = None
    text: str | None = Field(default=None, min_length=1, max_length=1000)
    reason: str | None = Field(default=None, max_length=1000)
    topic_space_id: str | None = Field(default=None, max_length=64)


class MapEntryUpdateResponse(BaseModel):
    entry: dict[str, Any]
    map: SelfAuthorshipMapRead


class MapEntryDeleteResponse(BaseModel):
    deleted: bool
    entry: dict[str, Any]
    map: SelfAuthorshipMapRead


TopicCategory = Literal["person", "trait", "experience", "other"]


class TopicSpaceCreate(BaseModel):
    category: TopicCategory = "other"
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    chat_id: str | None = Field(default=None, max_length=120)
    parent_topic_id: str | None = Field(default=None, max_length=64)
    related_topic_ids: list[str] = Field(default_factory=list, max_length=24)


class TopicSpaceUpdate(BaseModel):
    category: TopicCategory | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parent_topic_id: str | None = Field(default=None, max_length=64)
    related_topic_ids: list[str] | None = Field(default=None, max_length=24)


class TopicSpaceMerge(BaseModel):
    target_topic_space_id: str = Field(min_length=1, max_length=64)


class TopicSpaceResponse(BaseModel):
    topic: dict[str, Any]
    map: SelfAuthorshipMapRead


class TopicSpaceDeleteResponse(BaseModel):
    deleted: bool
    topic: dict[str, Any]
    map: SelfAuthorshipMapRead


class PracticeUpdate(BaseModel):
    status: Literal["active", "paused", "completed"]
    reflection: str | None = Field(default=None, max_length=2000)


class PracticeUpdateResponse(BaseModel):
    practice: dict[str, Any]
    map: SelfAuthorshipMapRead
