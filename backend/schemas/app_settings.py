from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Provider = Literal["mock", "local", "openai", "anthropic", "ollama"]


class AppPreferences(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    chat_provider: Provider
    chat_model: str = Field(max_length=200)
    topic_provider: Provider
    topic_model: str = Field(max_length=200)
    feedback_enabled: bool
    password_reset_enabled: bool
    premium_features_enabled: bool
    rate_limit_llm_free_user_per_day: int = Field(ge=0, le=100000)
    rate_limit_llm_user_per_day: int = Field(ge=0, le=100000)

    @model_validator(mode="after")
    def validate_models(self):
        for role in ("chat", "topic"):
            provider = getattr(self, role + "_provider")
            model = getattr(self, role + "_model").strip()
            if provider in {"mock", "local"}:
                model = ""
            elif not model or any(ord(c) < 32 for c in model):
                raise ValueError(f"A model identifier is required for the {role} provider.")
            setattr(self, role + "_model", model)
        return self


class AppPreferencesWrite(AppPreferences):
    expected_revision: int = Field(ge=0)
