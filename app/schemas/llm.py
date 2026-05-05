from typing import Any

from pydantic import BaseModel, Field


class LLMRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)


class LLMResponse(BaseModel):
    assistant_message: str
    profile: dict[str, Any]
