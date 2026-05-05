from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email_or_username: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=128)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
