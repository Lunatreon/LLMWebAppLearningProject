from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "FeelY Backend"
    api_v1_prefix: str = "/api/v1"
    environment: str = "local"
    secret_key: str = "change-this-secret-before-deploying"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = "sqlite:///./feely.db"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5500",
            "http://127.0.0.1:5500",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "null",
        ]
    )

    llm_provider: str = "mock"
    chat_llm_provider: str | None = None
    topic_llm_provider: str | None = None
    openai_api_key: str | None = None
    openai_model: str = "gpt-5.4-mini"
    openai_chat_model: str | None = None
    openai_topic_model: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
