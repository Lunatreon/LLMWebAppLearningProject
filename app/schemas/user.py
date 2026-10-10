from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StrictBool, field_validator


class UserCreate(BaseModel):
    terms_accepted: StrictBool = False
    terms_version: str | None = Field(default=None, max_length=80)
    terms_document_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    email: EmailStr
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    website: str | None = Field(default=None, max_length=200)
    captcha_token: str | None = Field(default=None, max_length=4096)

    @field_validator("username", mode="before")
    @classmethod
    def strip_username(cls, value: str) -> str:
        return str(value).strip()


class UserRead(BaseModel):
    id: int
    email: EmailStr
    username: str
    display_name: str | None = None
    bio: str | None = None
    avatar_url: str | None = None
    is_email_verified: bool = False
    role: str = "member"
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserAccountRead(UserRead):
    auth_provider: str = "password"
    google_connected: bool = False
    has_password: bool = True
    email_verified_at: datetime | None = None
    last_login_at: datetime | None = None


class UserAccountUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = Field(default=None, min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    display_name: str | None = Field(default=None, max_length=120)
    bio: str | None = Field(default=None, max_length=500)
    avatar_url: str | None = Field(default=None, max_length=500)

    @field_validator("username", "display_name", "bio", "avatar_url", mode="before")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = str(value).strip()
        return cleaned or None


class PasswordChangeRequest(BaseModel):
    current_password: str | None = Field(default=None, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class AccountDeleteRequest(BaseModel):
    password: str | None = Field(default=None, max_length=128)
