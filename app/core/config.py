from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

TURNSTILE_TEST_SITE_KEYS = {
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "1x00000000000000000000BB",
    "2x00000000000000000000BB",
    "3x00000000000000000000FF",
}
TURNSTILE_TEST_SECRET_KEYS = {
    "1x0000000000000000000000000000000AA",
    "2x0000000000000000000000000000000AA",
    "3x0000000000000000000000000000000AA",
}


class Settings(BaseSettings):
    app_name: str = "FeelY Backend"
    api_v1_prefix: str = "/api/v1"
    environment: str = "local"
    admin_username: str | None = None
    admin_password_hash: str | None = None
    admin_access_token_expire_minutes: int = 120
    secret_key: str = "change-this-secret-before-deploying"
    access_token_expire_minutes: int = 60 * 24
    database_url: str = "sqlite:///./feely.db"
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "https://feel-y.com",
            "https://www.feel-y.com",
            "https://app.feel-y.com",
            "https://dev.feel-y.com",
            "https://selinabernard.com",
            "https://www.selinabernard.com",
            "http://localhost:3000",
            "http://localhost:5173",
            "http://localhost:5500",
            "http://127.0.0.1:5500",
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "null",
        ]
    )
    trust_proxy_headers: bool = False
    max_request_body_bytes: int = 128_000
    basic_auth_enabled: bool = False
    basic_auth_username: str | None = None
    basic_auth_password: str | None = None
    rate_limit_enabled: bool = True
    rate_limit_api_per_minute: int = 300
    rate_limit_auth_ip_per_minute: int = 30
    rate_limit_register_ip_per_hour: int = 20
    rate_limit_login_identifier_attempts: int = 8
    rate_limit_login_identifier_window_seconds: int = 900
    rate_limit_llm_user_per_minute: int = 30
    rate_limit_llm_free_user_per_day: int = 10
    rate_limit_llm_user_per_day: int = 400
    captcha_enabled: bool = False
    captcha_provider: str = "turnstile"
    turnstile_site_key: str | None = None
    turnstile_secret_key: str | None = None
    turnstile_action: str = "register"
    turnstile_verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    turnstile_timeout_seconds: float = 5.0
    google_auth_enabled: bool = False
    google_client_id: str | None = None
    google_allowed_hosted_domain: str | None = None
    email_verification_enabled: bool = False
    email_verification_required: bool = False
    email_verification_token_expire_hours: int = 24
    public_app_url: str = "http://127.0.0.1:5500"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_tls: bool = True

    stripe_enabled: bool = False
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None
    stripe_price_monthly: str | None = None
    stripe_price_yearly: str | None = None
    stripe_checkout_success_url: str | None = None
    stripe_checkout_cancel_url: str | None = None
    stripe_portal_return_url: str | None = None
    premium_features_enabled: bool = True

    llm_provider: str = "mock"
    chat_llm_provider: str | None = None
    topic_llm_provider: str | None = "local"
    openai_api_key: str | None = None
    openai_model: str = "gpt-5.4-mini"
    openai_chat_model: str | None = None
    openai_topic_model: str | None = None
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_chat_model: str | None = None
    anthropic_topic_model: str | None = None
    anthropic_max_tokens: int = 4096
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3.5:4b"
    ollama_chat_model: str | None = None
    ollama_topic_model: str | None = None
    ollama_timeout_seconds: float = 180.0
    ollama_context_window: int = 2048
    ollama_chat_max_tokens: int = 160
    ollama_topic_max_tokens: int = 128
    ollama_chat_num_gpu: int = 0
    ollama_topic_num_gpu: int = 999
    ollama_keep_alive: int = -1
    ollama_prewarm: bool = True
    prompt_directory: str = "prompts"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def is_local_environment(self) -> bool:
        return self.environment.lower() in {"local", "development", "dev", "test"}

    def validate_runtime_security(self) -> None:
        if self.is_local_environment:
            return

        if self.secret_key == "change-this-secret-before-deploying" or len(self.secret_key) < 32:
            raise RuntimeError("SECRET_KEY must be changed to a long random value before deployment.")

        unsafe_origins = {"*", "null"} & set(self.cors_origins)
        if unsafe_origins:
            origins = ", ".join(sorted(unsafe_origins))
            raise RuntimeError(f"CORS_ORIGINS contains unsafe production origin(s): {origins}.")

        if not self.captcha_enabled:
            raise RuntimeError("CAPTCHA_ENABLED must be true before deployment.")
        if self.captcha_provider.lower() != "turnstile":
            raise RuntimeError("CAPTCHA_PROVIDER must be 'turnstile'.")
        if not self.turnstile_site_key or not self.turnstile_secret_key:
            raise RuntimeError("TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be configured.")
        if (
            self.turnstile_site_key in TURNSTILE_TEST_SITE_KEYS
            or self.turnstile_secret_key in TURNSTILE_TEST_SECRET_KEYS
        ):
            raise RuntimeError("Cloudflare Turnstile test keys cannot be used in production.")
        if not self.turnstile_action.strip():
            raise RuntimeError("TURNSTILE_ACTION must be configured.")
        if self.google_auth_enabled and not self.google_client_id:
            raise RuntimeError("GOOGLE_CLIENT_ID must be configured when Google auth is enabled.")
        if self.email_verification_required and not self.email_verification_enabled:
            raise RuntimeError(
                "EMAIL_VERIFICATION_ENABLED must be true when email verification is required."
            )
        if self.email_verification_enabled and not self.email_delivery_configured:
            raise RuntimeError("SMTP settings must be configured when email verification is enabled.")

    @property
    def email_delivery_configured(self) -> bool:
        return bool(
            self.smtp_host
            and self.smtp_port
            and self.smtp_from_email
            and (not self.smtp_username or self.smtp_password)
        )

    @property
    def stripe_checkout_configured(self) -> bool:
        required_values = (
            self.stripe_secret_key,
            self.stripe_checkout_success_url,
            self.stripe_checkout_cancel_url,
        )
        price_ids = (
            self.stripe_price_monthly,
            self.stripe_price_yearly,
        )
        return (
            self.stripe_enabled
            and all(value and value.strip() for value in required_values)
            and any(value and value.strip() for value in price_ids)
        )

    @property
    def stripe_portal_configured(self) -> bool:
        return self.stripe_enabled and all(
            value and value.strip()
            for value in (
                self.stripe_secret_key,
                self.stripe_portal_return_url,
            )
        )

    @property
    def stripe_webhook_configured(self) -> bool:
        return self.stripe_enabled and all(
            value and value.strip()
            for value in (
                self.stripe_secret_key,
                self.stripe_webhook_secret,
            )
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
