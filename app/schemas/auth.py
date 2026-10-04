from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


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
    token: str | None = Field(default=None, min_length=20, max_length=512)
    email: EmailStr | None = None
    pin: str | None = Field(default=None, pattern=r"^[0-9]{6}$")

    @model_validator(mode="after")
    def require_one_verification_method(self):
        if self.token is not None:
            if self.email is not None or self.pin is not None:
                raise ValueError("Use either a verification link or an email and PIN.")
        elif self.email is None or self.pin is None:
            raise ValueError("Enter your email and six-digit PIN.")
        return self


class EmailVerificationConfirmResponse(BaseModel):
    verified: bool
    detail: str


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetRequestResponse(BaseModel):
    sent: bool
    detail: str


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetConfirmResponse(BaseModel):
    reset: bool
    detail: str
