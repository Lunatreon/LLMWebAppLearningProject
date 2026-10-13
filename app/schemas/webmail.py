from pydantic import BaseModel, EmailStr, Field, field_validator


class Compose(BaseModel):
    to: EmailStr
    subject: str = Field(max_length=300)
    body: str = Field(min_length=1, max_length=30000)
    reply_to_id: int | None = None

    @field_validator("subject")
    @classmethod
    def no_header_injection(cls, value):
        if "\r" in value or "\n" in value:
            raise ValueError("Subject must be one line")
        return value
