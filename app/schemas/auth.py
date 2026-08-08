from pydantic import BaseModel, EmailStr, Field, field_validator


class LoginRequest(BaseModel):
    email_or_username: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email_or_username", mode="before")
    @classmethod
    def strip_identifier(cls, value: str) -> str:
        return str(value).strip()


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class CaptchaConfig(BaseModel):
    enabled: bool
    provider: str | None = None
    site_key: str | None = None
    action: str | None = None


class GoogleAuthConfig(BaseModel):
    enabled: bool
    client_id: str | None = None


class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=20, max_length=8192)


class EmailVerificationRequest(BaseModel):
    email: EmailStr


class EmailVerificationRequestResponse(BaseModel):
    sent: bool
    detail: str


class EmailVerificationConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)


class EmailVerificationConfirmResponse(BaseModel):
    verified: bool
    detail: str
