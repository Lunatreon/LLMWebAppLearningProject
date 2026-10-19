from datetime import datetime
from typing import Literal

from app.schemas.user import UserCreate

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class AdminStatus(BaseModel):
    is_admin: bool = True
    username: str


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=256)


class AdminToken(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AdminUserRead(BaseModel):
    role: Literal["member", "test", "admin"] = "member"
    id: int
    email: EmailStr
    username: str
    display_name: str | None = None
    is_active: bool
    is_email_verified: bool
    auth_provider: str
    created_at: datetime
    last_login_at: datetime | None = None
    subscription_status: str = "none"
    subscription_plan: str = "free"
    premium: bool = False
    stripe_subscription: bool = False


class AdminUserUpdate(BaseModel):
    role: Literal["member", "test", "admin"] | None = None
    email: EmailStr | None = None
    username: str | None = Field(
        default=None,
        min_length=3,
        max_length=80,
        pattern=r"^[a-zA-Z0-9_.-]+$",
    )
    display_name: str | None = Field(default=None, max_length=120)
    is_active: bool | None = None
    is_email_verified: bool | None = None

    @field_validator("username", "display_name", mode="before")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class AdminUserCreate(UserCreate):
    role: Literal["member", "test", "admin"] = "member"
    display_name: str | None = Field(default=None, max_length=120)


class AdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class AdminSubscriptionReset(BaseModel):
    confirmation: Literal["REMOVE_SUBSCRIPTION"]


class AdminPromptRead(BaseModel):
    kind: Literal["chat", "topic"]
    text: str


class AdminPromptUpdate(BaseModel):
    text: str = Field(min_length=100, max_length=30_000)

    model_config = ConfigDict(extra="forbid")


class AdminPromptBundle(BaseModel):
    prompts: list[AdminPromptRead]
