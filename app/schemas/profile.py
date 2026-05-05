from typing import Any

from pydantic import BaseModel, Field


class ProfileRead(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)


class ProfileUpdate(BaseModel):
    data: dict[str, Any] = Field(default_factory=dict)
