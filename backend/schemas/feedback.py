from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class FeedbackCreate(BaseModel):
    category: Literal["bug", "idea", "general"] = "general"
    message: str = Field(min_length=3, max_length=5000)

    @field_validator("message", mode="before")
    @classmethod
    def strip_message(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class FeedbackRead(BaseModel):
    id: int
    category: str
    message: str
    email: str
    created_at: datetime
