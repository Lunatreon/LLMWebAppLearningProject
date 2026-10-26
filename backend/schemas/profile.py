from typing import Any, Literal, Annotated

from pydantic import BaseModel, Field
from backend.services.map_categories import catalog


class ProfileRead(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class ProfileUpdate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


# Category keys are validated against the database catalog by the service.
MapEntryCategory = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]


class SelfAuthorshipMapRead(BaseModel):
    revision: int = 0
    categories: list[dict[str, Any]] = Field(default_factory=catalog)
    topic_spaces: list[dict[str, Any]] = Field(default_factory=list)
    unassigned_entries: list[dict[str, Any]] = Field(default_factory=list)
    updated_at: str | None = None


class MapEntryCreate(BaseModel):
    working_on: bool = Field(default=False, strict=True)
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    category: MapEntryCategory
    completion_percent: int | None = Field(default=None, ge=0, le=100, strict=True)
    text: str = Field(min_length=1, max_length=1000)
    topic_space_id: str | None = Field(default=None, max_length=64)
    source_chat_id: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=1000)


class MapEntryCreateResponse(BaseModel):
    entry: dict[str, Any]
    map: SelfAuthorshipMapRead


class MapEntryUpdate(BaseModel):
    working_on: bool | None = Field(default=None, strict=True)
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    category: MapEntryCategory | None = None
    completion_percent: int | None = Field(default=None, ge=0, le=100, strict=True)
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


TopicCategory = MapEntryCategory


class TopicSpaceCreate(BaseModel):
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    category: TopicCategory = "other"
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    chat_id: str | None = Field(default=None, max_length=120)
    parent_topic_id: str | None = Field(default=None, max_length=64)
    related_topic_ids: list[str] = Field(default_factory=list, max_length=24)


class TopicSpaceUpdate(BaseModel):
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    category: TopicCategory | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    parent_topic_id: str | None = Field(default=None, max_length=64)
    related_topic_ids: list[str] | None = Field(default=None, max_length=24)


class TopicSpaceMerge(BaseModel):
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    target_topic_space_id: str = Field(min_length=1, max_length=64)


class TopicSpaceResponse(BaseModel):
    topic: dict[str, Any]
    map: SelfAuthorshipMapRead


class TopicSpaceDeleteResponse(BaseModel):
    deleted: bool
    topic: dict[str, Any]
    map: SelfAuthorshipMapRead


class PracticeUpdate(BaseModel):
    expected_revision: int | None = Field(default=None, ge=0, strict=True)
    completion_percent: int | None = Field(default=None, ge=0, le=100, strict=True)
    status: Literal["active", "paused", "completed"]
    reflection: str | None = Field(default=None, max_length=2000)


class PracticeUpdateResponse(BaseModel):
    practice: dict[str, Any]
    map: SelfAuthorshipMapRead
