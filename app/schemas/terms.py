from typing import Literal

from pydantic import BaseModel, Field, StrictBool


class AcceptTerms(BaseModel):
    accepted: StrictBool
    version: str = Field(min_length=1, max_length=80)
    document_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    client: Literal["web", "android", "api"] = "api"
