"""Fail closed on incomplete production configuration without disclosing its values."""

from email.utils import parseaddr
import ipaddress
import re
from urllib.parse import urlsplit

from sqlalchemy.engine import make_url


def configured(value: str | None) -> bool:
    text = (value or "").strip()
    return bool(text) and not any(
        marker in text.lower() for marker in ("<", ">", "change-me", "replace-me")
    )


def public_https_url(value: str, *, origin_only: bool = False) -> bool:
    try:
        url = urlsplit(value)
        if not configured(value) or url.scheme != "https" or not url.hostname:
            return False
        if url.username or url.password or url.fragment:
            return False
        if url.hostname == "localhost" or url.hostname.endswith((".localhost", ".local")):
            return False
        try:
            if not ipaddress.ip_address(url.hostname).is_global:
                return False
        except ValueError:
            if not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z][a-z0-9-]*", url.hostname):
                return False
        if origin_only and (url.path not in ("", "/") or url.query):
            return False
        return url.port is None or url.port == 443
    except ValueError:
        return False


def validate_production_config(config) -> None:
    if not configured(config.secret_key):
        raise RuntimeError("SECRET_KEY must be configured; placeholders are not credentials.")
    try:
        database = make_url(config.database_url)
        valid_database = (
            database.get_backend_name() in {"postgres", "postgresql"}
            and configured(database.host)
            and configured(database.database)
            and configured(database.username)
            and configured(database.password)
            and database.username not in {"postgres", "feely_bootstrap"}
        )
    except Exception:
        valid_database = False
    if not valid_database:
        raise RuntimeError(
            "DATABASE_URL must select PostgreSQL with a non-bootstrap application role and password."
        )
    if not public_https_url(config.public_app_url, origin_only=True):
        raise RuntimeError("PUBLIC_APP_URL must be the configured public HTTPS frontend origin.")
    if not config.cors_origins or any(
        not public_https_url(origin, origin_only=True) or origin.endswith("/")
        for origin in config.cors_origins
    ):
        raise RuntimeError(
            "CORS_ORIGINS must list exact public HTTPS origins without paths or trailing slashes."
        )
    if config.public_app_url.rstrip("/") not in config.cors_origins:
        raise RuntimeError("CORS_ORIGINS must include the PUBLIC_APP_URL frontend origin.")
    if not config.allowed_hosts or any(
        not configured(host)
        or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9.-]*", host)
        or host == "localhost"
        for host in config.allowed_hosts
    ):
        raise RuntimeError(
            "ALLOWED_HOSTS must list explicit production hostnames without wildcards or ports."
        )
    if config.api_docs_enabled or config.basic_auth_enabled:
        raise RuntimeError("API_DOCS_ENABLED and BASIC_AUTH_ENABLED must be false in production.")
    if config.trust_proxy_headers:
        raise RuntimeError(
            "TRUST_PROXY_HEADERS is a compatibility flag; use the bounded Uvicorn proxy configuration."
        )
    if not (
        config.email_verification_enabled
        and config.email_verification_required
        and config.password_reset_enabled
    ):
        raise RuntimeError(
            "Production requires email verification, required activation and password recovery to be enabled."
        )
    if not config.email_delivery_configured or not configured(config.smtp_host):
        raise RuntimeError("SMTP_HOST, SMTP_PORT and SMTP_FROM_EMAIL must be configured.")
    if config.smtp_host.lower() in {"mailpit", "localhost", "127.0.0.1", "::1"}:
        raise RuntimeError(
            "SMTP_HOST must use a production delivery service, not a local mail capture target."
        )
    if config.smtp_use_tls == config.smtp_use_ssl:
        raise RuntimeError(
            "Enable exactly one of SMTP_USE_TLS (STARTTLS) and SMTP_USE_SSL (implicit TLS)."
        )
    if bool(config.smtp_username) != bool(config.smtp_password) or (
        config.smtp_password and not configured(config.smtp_password)
    ):
        raise RuntimeError(
            "SMTP_USERNAME and SMTP_PASSWORD must be configured together when SMTP authentication is used."
        )
    sender = config.smtp_from_email or ""
    if (
        not configured(sender)
        or "@" not in parseaddr(sender)[1]
        or "\n" in sender
        or "\r" in sender
    ):
        raise RuntimeError("SMTP_FROM_EMAIL must be a valid configured sender mailbox.")
    if (
        not public_https_url(config.turnstile_verify_url)
        or config.turnstile_verify_url
        != "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    ):
        raise RuntimeError(
            "TURNSTILE_VERIFY_URL must use the official HTTPS Siteverify endpoint in production."
        )
    if not configured(config.turnstile_site_key) or not configured(config.turnstile_secret_key):
        raise RuntimeError(
            "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must not contain placeholders."
        )
    if (
        not config.terms_version.strip()
        or not public_https_url(config.terms_document_url)
        or not config.terms_document_sha256
    ):
        raise RuntimeError(
            "TERMS_VERSION, TERMS_DOCUMENT_URL and TERMS_DOCUMENT_SHA256 must identify the published HTTPS Terms document."
        )
    providers = {
        "CHAT": config.chat_llm_provider or config.llm_provider,
        "TOPIC": config.topic_llm_provider or config.llm_provider,
        "JOURNAL": config.journal_llm_provider or config.topic_llm_provider or config.llm_provider,
    }
    for role, value in providers.items():
        provider = value.lower()
        if provider not in {"openai", "anthropic", "ollama"}:
            raise RuntimeError(
                f"{role}_LLM_PROVIDER must explicitly select a production provider; mock/local are development only."
            )
        if provider == "openai" and not configured(config.openai_api_key):
            raise RuntimeError(f"OPENAI_API_KEY is required for the {role} provider.")
        if provider == "openai":
            model = getattr(config, f"openai_{role.lower()}_model") or config.openai_model
            if not configured(model):
                raise RuntimeError(
                    f"OPENAI_{role}_MODEL or OPENAI_MODEL must identify a configured model."
                )
        if provider == "anthropic" and not configured(config.anthropic_api_key):
            raise RuntimeError(f"ANTHROPIC_API_KEY is required for the {role} provider.")
    if config.stripe_enabled:
        if not all(
            (
                config.stripe_checkout_configured,
                config.stripe_portal_configured,
                config.stripe_webhook_configured,
            )
        ):
            raise RuntimeError(
                "STRIPE_ENABLED requires Checkout, Portal and webhook configuration."
            )
        if not configured(config.stripe_secret_key) or not configured(config.stripe_webhook_secret):
            raise RuntimeError("Stripe credentials must be configured, not placeholders.")
        for value in (
            config.stripe_checkout_success_url,
            config.stripe_checkout_cancel_url,
            config.stripe_portal_return_url,
        ):
            if not public_https_url(value or ""):
                raise RuntimeError("Stripe return URLs must be configured public HTTPS URLs.")
    if config.webmail_enabled and (
        not public_https_url(config.webmail_worker_url)
        or not configured(config.webmail_bridge_secret)
    ):
        raise RuntimeError(
            "WEBMAIL_ENABLED requires an HTTPS WEBMAIL_WORKER_URL and WEBMAIL_BRIDGE_SECRET."
        )
    if not config.rate_limit_enabled:
        raise RuntimeError("RATE_LIMIT_ENABLED must be true in production.")
    for name in type(config).model_fields:
        if (
            name.startswith("rate_limit_")
            and name != "rate_limit_enabled"
            and getattr(config, name) <= 0
        ):
            raise RuntimeError(f"{name.upper()} must be positive in production.")
    if config.max_request_body_bytes <= 0:
        raise RuntimeError("MAX_REQUEST_BODY_BYTES must be positive in production.")
