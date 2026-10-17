# Production configuration inventory ? Backend Phase 4

Every field in `app/core/config.py:Settings` is listed below. Names are environment
variables. **REQUIRED PRODUCTION SECRET** is conditional when the named integration
is disabled. No configured values or credentials are recorded. The checked-in
production template contains only placeholders and safe non-secret configuration.

## Backend settings

| Setting | Classification | Requirement / purpose |
| --- | --- | --- |
| `APP_NAME` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `API_V1_PREFIX` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `ENVIRONMENT` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `ADMIN_USERNAME` | OPTIONAL | Optional administrator account; hash the password using the existing security helper. |
| `ADMIN_PASSWORD_HASH` | REQUIRED PRODUCTION SECRET | Required only to enable administrator login; disabled when admin credentials are absent. |
| `ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `SECRET_KEY` | REQUIRED PRODUCTION SECRET | Random signing/HMAC key, >=32 characters; stable across releases/restores. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `DATABASE_URL` | REQUIRED PRODUCTION SECRET | PostgreSQL app-owner URL contains its password; never print it as ordinary config. SQLite fallback is rejected in production. |
| `CORS_ORIGINS` | REQUIRED PRODUCTION CONFIG | Exact HTTPS frontend origins, no slash/path/port wildcard/null/loopback; include PUBLIC_APP_URL. |
| `TRUST_PROXY_HEADERS` | DEVELOPMENT ONLY | Legacy compatibility flag, not used to parse headers. Must remain false; production Uvicorn trusts the Caddy IP explicitly. |
| `ALLOWED_HOSTS` | REQUIRED PRODUCTION CONFIG | Exact backend/Caddy hostnames; no wildcard. The internal readiness probe sends the first allowed Host. |
| `MAX_REQUEST_BODY_BYTES` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `API_DOCS_ENABLED` | DEVELOPMENT ONLY | Must remain false for this production configuration. |
| `RATE_LIMIT_HTTP_PER_MINUTE` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `BASIC_AUTH_ENABLED` | DEVELOPMENT ONLY | Must remain false in production. Normal JWT auth is unchanged. |
| `BASIC_AUTH_USERNAME` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `BASIC_AUTH_PASSWORD` | DEVELOPMENT ONLY | Development/staging compatibility secret; Basic auth conflicts with Bearer Authorization and is disabled in production. |
| `RATE_LIMIT_ENABLED` | REQUIRED PRODUCTION CONFIG | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_API_PER_MINUTE` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_AUTH_IP_PER_MINUTE` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_REGISTER_IP_PER_HOUR` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_LOGIN_IDENTIFIER_ATTEMPTS` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_LOGIN_IDENTIFIER_WINDOW_SECONDS` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_PASSWORD_RESET_IDENTIFIER_PER_HOUR` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_LLM_USER_PER_MINUTE` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_LLM_FREE_USER_PER_DAY` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `RATE_LIMIT_LLM_USER_PER_DAY` | OPTIONAL | Existing process-local limit; positive in production. Single worker/container initially; counters reset on restart. |
| `CAPTCHA_ENABLED` | REQUIRED PRODUCTION CONFIG | Existing registration CAPTCHA setting; no account or external call is needed for normal CI. |
| `CAPTCHA_PROVIDER` | REQUIRED PRODUCTION CONFIG | Existing registration CAPTCHA setting; no account or external call is needed for normal CI. |
| `TURNSTILE_SITE_KEY` | REQUIRED PRODUCTION CONFIG | Public, frontend-safe; create it for the actual frontend hostname. |
| `TURNSTILE_SECRET_KEY` | REQUIRED PRODUCTION SECRET | Required in production; published Cloudflare test keys are rejected. |
| `TURNSTILE_ACTION` | REQUIRED PRODUCTION CONFIG | Existing registration CAPTCHA setting; no account or external call is needed for normal CI. |
| `TURNSTILE_VERIFY_URL` | OPTIONAL | Official HTTPS Siteverify URL only in production; local verification doubles remain available outside production. |
| `TURNSTILE_TIMEOUT_SECONDS` | OPTIONAL | Existing registration CAPTCHA setting; no account or external call is needed for normal CI. |
| `ANDROID_APP_ENABLED` | OPTIONAL | Optional existing API configuration; no Android deployment is introduced. |
| `ANDROID_PACKAGE_NAME` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `TERMS_VERSION` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `TERMS_DOCUMENT_URL` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `TERMS_DOCUMENT_SHA256` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `EMAIL_VERIFICATION_ENABLED` | REQUIRED PRODUCTION CONFIG | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `EMAIL_VERIFICATION_REQUIRED` | REQUIRED PRODUCTION CONFIG | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS` | OPTIONAL | Compatibility expiry for already-issued high-entropy verification links; new mail uses PIN expiry. |
| `EMAIL_VERIFICATION_PIN_EXPIRE_MINUTES` | OPTIONAL | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `EMAIL_VERIFICATION_MAX_ATTEMPTS` | OPTIONAL | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `FEEDBACK_ENABLED` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `FEEDBACK_EMAIL_TO` | OPTIONAL | Optional recipient; blank keeps feedback storage without outgoing notification. |
| `WEBMAIL_ENABLED` | OPTIONAL | Optional bridge feature; false in initial production template. |
| `WEBMAIL_ADDRESS` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `WEBMAIL_WORKER_URL` | OPTIONAL | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `WEBMAIL_BRIDGE_SECRET` | REQUIRED PRODUCTION SECRET | Required if WEBMAIL_ENABLED=true; separate from SMTP and JWT keys. |
| `PASSWORD_RESET_ENABLED` | REQUIRED PRODUCTION CONFIG | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `PASSWORD_RESET_TOKEN_EXPIRE_MINUTES` | OPTIONAL | Existing activation/recovery policy; PIN/token behavior and limits are unchanged. |
| `PUBLIC_APP_URL` | REQUIRED PRODUCTION CONFIG | Exact public HTTPS React origin; password-reset links use it. Activation currently uses a PIN, not a URL. |
| `SMTP_HOST` | REQUIRED PRODUCTION CONFIG | Vendor-neutral SMTP setting; exactly one TLS mode is enabled in production. |
| `SMTP_PORT` | REQUIRED PRODUCTION CONFIG | Vendor-neutral SMTP setting; exactly one TLS mode is enabled in production. |
| `SMTP_USERNAME` | OPTIONAL | Conditional SMTP authentication account; configure together with its password. |
| `SMTP_PASSWORD` | REQUIRED PRODUCTION SECRET | Required with SMTP_USERNAME; a configured TLS relay may omit both. |
| `SMTP_FROM_EMAIL` | REQUIRED PRODUCTION CONFIG | Vendor-neutral SMTP setting; exactly one TLS mode is enabled in production. |
| `SMTP_USE_TLS` | REQUIRED PRODUCTION CONFIG | Vendor-neutral SMTP setting; exactly one TLS mode is enabled in production. |
| `SMTP_USE_SSL` | REQUIRED PRODUCTION CONFIG | Vendor-neutral SMTP setting; exactly one TLS mode is enabled in production. |
| `STRIPE_ENABLED` | OPTIONAL | Optional paid integration; false in initial production template. |
| `STRIPE_SECRET_KEY` | REQUIRED PRODUCTION SECRET | Required if STRIPE_ENABLED=true; disabled integration needs no Stripe credentials. |
| `STRIPE_WEBHOOK_SECRET` | REQUIRED PRODUCTION SECRET | Required if STRIPE_ENABLED=true; signed webhook authentication remains unchanged. |
| `STRIPE_PRICE_MONTHLY` | OPTIONAL | Required only for enabled billing; return URLs must use HTTPS and the retained reference account flow. |
| `STRIPE_PRICE_YEARLY` | OPTIONAL | Required only for enabled billing; return URLs must use HTTPS and the retained reference account flow. |
| `STRIPE_CHECKOUT_SUCCESS_URL` | OPTIONAL | Required only for enabled billing; return URLs must use HTTPS and the retained reference account flow. |
| `STRIPE_CHECKOUT_CANCEL_URL` | OPTIONAL | Required only for enabled billing; return URLs must use HTTPS and the retained reference account flow. |
| `STRIPE_PORTAL_RETURN_URL` | OPTIONAL | Required only for enabled billing; return URLs must use HTTPS and the retained reference account flow. |
| `PREMIUM_FEATURES_ENABLED` | OPTIONAL | Explicit commercial policy. false preserves the current free test phase; do not enable Stripe accidentally. |
| `LLM_PROVIDER` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `CHAT_LLM_PROVIDER` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |
| `TOPIC_LLM_PROVIDER` | REQUIRED PRODUCTION CONFIG | Explicitly select openai in production; legacy default local would otherwise override the base provider. |
| `JOURNAL_LLM_PROVIDER` | REQUIRED PRODUCTION CONFIG | Falls back through Topic then base provider; production template selects openai explicitly. |
| `OPENAI_API_KEY` | REQUIRED PRODUCTION SECRET | Required when any effective Chat/Topic/Journal provider is openai. Backend only. |
| `OPENAI_TIMEOUT_SECONDS` | OPTIONAL | Per-attempt SDK timeout; default 600 preserves SDK behavior, production template 60. SDK retries are separate. |
| `OPENAI_MAX_RETRIES` | OPTIONAL | SDK retries 0..3; default 2, no application retry layer added. |
| `OPENAI_MODEL` | REQUIRED PRODUCTION CONFIG | Optional per-role model override; falls back to OPENAI_MODEL. Model access must be verified by the operator. |
| `OPENAI_CHAT_MODEL` | OPTIONAL | Optional per-role model override; falls back to OPENAI_MODEL. Model access must be verified by the operator. |
| `OPENAI_TOPIC_MODEL` | OPTIONAL | Optional per-role model override; falls back to OPENAI_MODEL. Model access must be verified by the operator. |
| `OPENAI_JOURNAL_MODEL` | OPTIONAL | Optional per-role model override; falls back to OPENAI_MODEL. Model access must be verified by the operator. |
| `ANTHROPIC_API_KEY` | REQUIRED PRODUCTION SECRET | Required only if an Anthropic role is selected; backend only. |
| `ANTHROPIC_MODEL` | OPTIONAL | Optional Anthropic provider/model setting; relevant only when selected. |
| `ANTHROPIC_CHAT_MODEL` | OPTIONAL | Optional Anthropic provider/model setting; relevant only when selected. |
| `ANTHROPIC_TOPIC_MODEL` | OPTIONAL | Optional Anthropic provider/model setting; relevant only when selected. |
| `ANTHROPIC_JOURNAL_MODEL` | OPTIONAL | Optional Anthropic provider/model setting; relevant only when selected. |
| `ANTHROPIC_MAX_TOKENS` | OPTIONAL | Optional Anthropic provider/model setting; relevant only when selected. |
| `OLLAMA_BASE_URL` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_MODEL` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_CHAT_MODEL` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_TOPIC_MODEL` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_JOURNAL_MODEL` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_TIMEOUT_SECONDS` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_CONTEXT_WINDOW` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_CHAT_TEMPERATURE` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_CHAT_MAX_TOKENS` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_TOPIC_MAX_TOKENS` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_JOURNAL_MAX_TOKENS` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_CHAT_NUM_GPU` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_TOPIC_NUM_GPU` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_JOURNAL_NUM_GPU` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_KEEP_ALIVE` | OPTIONAL | Optional external Ollama configuration; mock/local are development-only. No Ollama service is deployed here. |
| `OLLAMA_PREWARM` | OPTIONAL | Keep false in this initial OpenAI production topology; relevant only to a separately configured Ollama deployment. |
| `PROMPT_DIRECTORY` | REQUIRED PRODUCTION CONFIG | Existing application setting; preserve its default unless deployment requirements justify an explicit value. |

## Compose, frontend and process settings

| Setting | Classification | Requirement / purpose |
| --- | --- | --- |
| `POSTGRES_PASSWORD` | REQUIRED PRODUCTION SECRET | Separate bootstrap administrator secret; excluded from filtered backend env. |
| `POSTGRES_APP_PASSWORD` | REQUIRED PRODUCTION SECRET | Application-owner secret; must match the URL-encoded password in DATABASE_URL. |
| `POSTGRES_DB` | REQUIRED PRODUCTION CONFIG | Initial database name; lowercase identifier. |
| `POSTGRES_USER` | REQUIRED PRODUCTION CONFIG | Bootstrap administrator, never used in DATABASE_URL. |
| `POSTGRES_APP_USER` | REQUIRED PRODUCTION CONFIG | Non-superuser DB owner for Alembic and runtime queries. |
| `INGRESS_DOMAIN` | REQUIRED PRODUCTION CONFIG | Caddy DNS hostname; initial same-origin app/API, or API hostname for separately hosted React. |
| `ACME_EMAIL` | REQUIRED PRODUCTION CONFIG | Certificate contact, not an application secret. |
| `FEELY_PROXY_SUBNET` | REQUIRED PRODUCTION CONFIG | Unused private Docker ingress subnet; check conflicts before deployment. |
| `FEELY_PROXY_IP` | REQUIRED PRODUCTION CONFIG | Reserved Caddy address; sole Uvicorn forwarded-header trust source. |
| `FEELY_BACKEND_IP` | REQUIRED PRODUCTION CONFIG | Different reserved backend address; avoids allocation collision before Caddy starts. |
| `FEELY_PRODUCTION_APP_ENV_FILE` | REQUIRED PRODUCTION CONFIG | Path to filtered raw backend env; generated from the private master file. |
| `VITE_API_BASE_URL` | OPTIONAL | Public build-time value: defaults to /api/v1; absolute HTTPS API URL for external frontend hosting. |
| `FEELY_HEALTH_PORT` | OPTIONAL | Internal readiness probe port, default 8000; do not point it at an external host. |
| `FEELY_DOCKER_ENV_FILE` | DEVELOPMENT ONLY | Existing local stack env selection; production file uses the filtered production env instead. |
| `FEELY_API_PORT` | DEVELOPMENT ONLY | Existing loopback host API port; production backend publishes none. |
| `FEELY_MAILPIT_PORT` | DEVELOPMENT ONLY | Existing Mailpit UI mapping; Mailpit is absent from production. |
| `OPENAI_LOG` | DEVELOPMENT ONLY | SDK debugging must not log private request/response bodies. Not forwarded by the production env filter. |
| `FORWARDED_ALLOW_IPS` | REQUIRED PRODUCTION CONFIG | Expressed as a Uvicorn command argument from FEELY_PROXY_IP, never * or arbitrary client headers. |

## Unsafe defaults and intentional boundaries

- The base Settings defaults include SQLite, a placeholder signing key, `null`/local CORS origins, a loopback PUBLIC_APP_URL, disabled CAPTCHA/email, mock base LLM and local Topic provider. Development conveniences remain, but the production startup checks reject them.
- Every effective LLM role is validated. OpenAI model/key selection is backend configuration; no keys enter Vite build args or the Caddy env. SDK per-attempt timeouts and retry count are explicit.
- Optional Stripe, webmail and administrator credentials are required only when those integrations are enabled. SMTP relay auth is optional only when both username/password are absent; TLS is mandatory.
- `Settings` does not consume arbitrary FORWARDED headers. Only Uvicorn resolves them after matching the single trusted proxy source. Rate limits use request.client.host.
- No production key/SMTP/domain/model access is verified by network in CI. A syntactically complete dummy configuration cannot prove provider account permissions or DNS/TLS delivery.
- `mock`/`local` LLM selections and Turnstile dummy keys are development/test only; production never silently falls back to them. The production CI fixture uses non-working synthetic credentials, never calls those providers, and only validates configuration/startup.
