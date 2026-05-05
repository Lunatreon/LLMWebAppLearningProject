from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserCreate(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=80, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)


class UserRead(BaseModel):
    id: int
    email: EmailStr
    username: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
