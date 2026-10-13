# Backend structural audit and target

Audited before code changes on 2026-10-13. All Python modules under `app/`,
route/schema definitions, imports, DB access, integrations, tests and source-relative
asset paths were indexed. Baseline: 176 passed, six stale assertions failed, one
opt-in live-server test skipped. No production behavior is changed to satisfy tests.

## Complete inventory

The original public website also defined its GET/HEAD handler in `app/website.py`.
It now lives in `app/api/routes/website.py`; `app.website:app` remains the entry point.

### FastAPI routers

- `app/api/routes/admin.py`
- `app/api/routes/auth.py`
- `app/api/routes/billing.py`
- `app/api/routes/feedback.py`
- `app/api/routes/health.py`
- `app/api/routes/journal.py`
- `app/api/routes/llm.py`
- `app/api/routes/terms.py`
- `app/api/routes/users.py`
- `app/api/routes/webmail.py`

### Pydantic schemas

- `app/schemas/admin.py`
- `app/schemas/auth.py`
- `app/schemas/billing.py`
- `app/schemas/journal.py`
- `app/schemas/llm.py`
- `app/schemas/profile.py`
- `app/schemas/user.py`

### Business/task services

- `app/services/billing.py`
- `app/services/chat_usage.py`
- `app/services/conversation_summary.py`
- `app/services/map_suggestions.py`
- `app/services/pattern_recognition.py`
- `app/services/prompts.py`
- `app/services/self_authorship.py`
- `app/services/terms.py`
- `app/services/topic_matching.py`
- `app/services/webmail.py`

### LLM infrastructure/providers/tasks

- `app/services/llm/context.py`
- `app/services/llm/json_response.py`
- `app/services/llm/providers/anthropic.py`
- `app/services/llm/providers/factory.py`
- `app/services/llm/providers/local.py`
- `app/services/llm/providers/ollama.py`
- `app/services/llm/providers/openai.py`
- `app/services/llm/responses.py`
- `app/services/llm/streaming.py`
- `app/services/llm/tasks/journal.py`
- `app/services/llm/types.py`

Inline models to relocate unchanged: FeedbackCreate/FeedbackRead from feedback,
AcceptTerms from terms, Compose from webmail. Names, fields, validators and defaults
remain identical; routes retain their functions and response declarations.

## Database and email boundaries

- DB/ORM access: `app/api/dependencies.py`.
- DB/ORM access: `app/api/routes/admin.py`.
- DB/ORM access: `app/api/routes/auth.py`.
- DB/ORM access: `app/api/routes/billing.py`.
- DB/ORM access: `app/api/routes/feedback.py`.
- DB/ORM access: `app/api/routes/journal.py`.
- DB/ORM access: `app/api/routes/llm.py`.
- DB/ORM access: `app/api/routes/terms.py`.
- DB/ORM access: `app/api/routes/users.py`.
- DB/ORM access: `app/api/routes/webmail.py`.
- DB/ORM access: `app/db/base.py`.
- DB/ORM access: `app/db/init_db.py`.
- DB/ORM access: `app/db/session.py`.
- DB/ORM access: `app/models/billing.py`.
- DB/ORM access: `app/models/feedback.py`.
- DB/ORM access: `app/models/mail_message.py`.
- DB/ORM access: `app/models/terms.py`.
- DB/ORM access: `app/models/user.py`.
- DB/ORM access: `app/services/billing.py`.
- DB/ORM access: `app/services/chat_usage.py`.
- DB/ORM access: `app/services/terms.py`.
- DB/ORM access: `app/services/webmail.py`.

DB engine/session setup is in db/session.py; initialization and existing SQLite
column/index handling are in db/init_db.py. ORM declarations remain in models/.
Routes and billing/chat_usage/terms/webmail services currently own transactions.
No repository layer or transaction relocation is proposed.

SMTP transport is core/mail.py. Verification/reset token rules plus message
composition are core/email_verification.py and core/password_reset.py; feedback
notifications are core/feedback_mail.py. services/webmail.py combines MIME parsing,
Cloudflare retrieval, durable storage and polling; routes/webmail.py composes sent mail.
SMTP will move to integrations/email.py; workflows move to services/. Webmail
polling/storage and Stripe billing orchestration remain cohesive deferred work.

## Cross-module imports and cycles

- `app.api.dependencies` -> `app.core.config`, `app.core.rate_limit`, `app.core.security`, `app.db.session`, `app.models.user`, `app.services.billing`, `app.services.terms`.
- `app.api.router` -> `app.api.dependencies`, `app.api.routes`.
- `app.api.routes.admin` -> `app.api.dependencies`, `app.core.config`, `app.core.security`, `app.models.user`, `app.schemas.admin`, `app.services.billing`, `app.services.prompts`.
- `app.api.routes.auth` -> `app.api.dependencies`, `app.core.captcha`, `app.core.config`, `app.core.email_verification`, `app.core.password_reset`, `app.core.rate_limit`, `app.core.security`, `app.models.terms`, `app.models.user`, `app.schemas.auth`, `app.schemas.user`, `app.services.terms`.
- `app.api.routes.billing` -> `app.api.dependencies`, `app.core.config`, `app.models.user`, `app.schemas.billing`, `app.services.billing`.
- `app.api.routes.feedback` -> `app.api.dependencies`, `app.core.config`, `app.core.feedback_mail`, `app.core.rate_limit`, `app.models.feedback`, `app.models.user`.
- `app.api.routes.journal` -> `app.api.dependencies`, `app.models.user`, `app.schemas.journal`, `app.services.billing`, `app.services.llm.tasks.journal`, `app.services.self_authorship`.
- `app.api.routes.llm` -> `app.api.dependencies`, `app.core.config`, `app.core.rate_limit`, `app.db.session`, `app.models.user`, `app.schemas.llm`, `app.services.billing`, `app.services.chat_usage`, `app.services.conversation_summary`, `app.services.llm.providers.factory`, `app.services.llm.types`, `app.services.map_suggestions`, `app.services.pattern_recognition`, `app.services.self_authorship`, `app.services.topic_matching`.
- `app.api.routes.terms` -> `app.api.dependencies`, `app.models.terms`, `app.models.user`, `app.services.terms`.
- `app.api.routes.users` -> `app.api.dependencies`, `app.core.config`, `app.core.security`, `app.models.user`, `app.schemas.profile`, `app.schemas.user`, `app.services.billing`, `app.services.self_authorship`.
- `app.api.routes.webmail` -> `app.api.dependencies`, `app.core.config`, `app.core.mail`, `app.core.rate_limit`, `app.models.mail_message`, `app.services.webmail`.
- `app.core.captcha` -> `app.core.config`, `app.core.rate_limit`.
- `app.core.email_verification` -> `app.core.config`, `app.core.mail`, `app.models.user`.
- `app.core.feedback_mail` -> `app.core.config`, `app.core.mail`.
- `app.core.mail` -> `app.core.config`.
- `app.core.middleware` -> `app.core.config`, `app.core.rate_limit`.
- `app.core.password_reset` -> `app.core.config`, `app.core.mail`, `app.models.user`.
- `app.core.rate_limit` -> `app.core.config`.
- `app.core.security` -> `app.core.config`.
- `app.db.init_db` -> `app.db.base`, `app.db.session`, `app.models`.
- `app.db.session` -> `app.core.config`.
- `app.main` -> `app.api.router`, `app.core.config`, `app.core.middleware`, `app.db.init_db`, `app.services.llm.providers.ollama`, `app.services.webmail`.
- `app.models.__init__` -> `app.models.billing`, `app.models.feedback`, `app.models.user`.
- `app.models.billing` -> `app.db.base`, `app.models.user`.
- `app.models.feedback` -> `app.db.base`, `app.models.user`.
- `app.models.mail_message` -> `app.db.base`.
- `app.models.terms` -> `app.db.base`, `app.models.user`.
- `app.models.user` -> `app.db.base`.
- `app.schemas.admin` -> `app.schemas.user`.
- `app.schemas.journal` -> `app.schemas.profile`.
- `app.schemas.llm` -> `app.schemas.profile`.
- `app.services.billing` -> `app.core.config`, `app.models.billing`, `app.models.user`, `app.schemas.billing`.
- `app.services.chat_usage` -> `app.core.config`, `app.models.user`.
- `app.services.llm.__init__` -> `app.services.llm.providers.factory`, `app.services.llm.providers.ollama`, `app.services.llm.tasks.journal`, `app.services.llm.types`.
- `app.services.llm.context` -> `app.services.self_authorship`.
- `app.services.llm.providers.anthropic` -> `app.services.llm.context`, `app.services.llm.json_response`, `app.services.llm.responses`, `app.services.llm.types`, `app.services.prompts`.
- `app.services.llm.providers.factory` -> `app.core.config`, `app.services.llm.providers.anthropic`, `app.services.llm.providers.local`, `app.services.llm.providers.ollama`, `app.services.llm.providers.openai`, `app.services.llm.types`.
- `app.services.llm.providers.local` -> `app.services.llm.context`, `app.services.llm.types`, `app.services.pattern_recognition`, `app.services.topic_matching`.
- `app.services.llm.providers.ollama` -> `app.core.config`, `app.services.llm.context`, `app.services.llm.json_response`, `app.services.llm.responses`, `app.services.llm.streaming`, `app.services.llm.types`, `app.services.prompts`.
- `app.services.llm.providers.openai` -> `app.services.llm.context`, `app.services.llm.json_response`, `app.services.llm.responses`, `app.services.llm.types`, `app.services.prompts`.
- `app.services.llm.responses` -> `app.services.llm.json_response`, `app.services.llm.types`, `app.services.self_authorship`.
- `app.services.llm.tasks.journal` -> `app.core.config`, `app.services.llm.context`, `app.services.llm.json_response`, `app.services.llm.providers.anthropic`, `app.services.llm.providers.factory`, `app.services.llm.providers.local`, `app.services.llm.providers.ollama`, `app.services.llm.providers.openai`, `app.services.llm.responses`, `app.services.llm.types`, `app.services.prompts`.
- `app.services.prompts` -> `app.core.config`.
- `app.services.terms` -> `app.core.config`, `app.models.terms`.
- `app.services.topic_matching` -> `app.services.self_authorship`.
- `app.services.webmail` -> `app.core.config`, `app.db.session`, `app.models.mail_message`.
- `app.website` -> `app.core.middleware`.

No runtime source-level import cycles were found (TYPE_CHECKING ORM backreferences
are excluded). Package initialization imports register ORM models and are retained.
The LLM package facade eagerly re-exports factories/tasks/types, but all repository
callers already use concrete modules; remove that unused facade in the new package.

## Large/mixed files deliberately deferred

- api/routes/llm.py (999 lines): routes, stream/background orchestration and persistence.
- services/self_authorship.py (719): authoritative Map CRUD and profile/LLM merge protection.
- services/billing.py (698): Stripe integration and transaction/webhook orchestration.
- llm providers Ollama (502) and local (482): provider behavior/fallbacks.
- api/routes/users.py (431), auth.py (359), journal.py (302): HTTP plus transaction workflows.

Splitting these algorithms/transactions is an architecture rewrite, outside this
structural pass. In particular self_authorship stays a domain service; only
model-facing summary/pattern/suggestion/topic helpers move into llm/tasks/.

## Internally consistent target

```text
app/
  api/                 router registration, HTTP routes/dependencies
  schemas/             all Pydantic request/response models
  services/            billing, usage, Map domain, Terms, email workflows, webmail
  llm/
    providers/         factory, OpenAI, Anthropic, Ollama, deterministic local provider
    tasks/             journal, conversation_summary, map_suggestions, pattern_recognition, topic_matching
    context.py, json_response.py, responses.py, streaming.py, types.py, prompts.py
  integrations/        authenticated SMTP transport
  db/, models/         existing SQLite/SQLAlchemy setup and ORM declarations
  core/                configuration, security, middleware, CAPTCHA and rate limiting
  main.py, website.py  unchanged application entry points and route semantics
```

Dependency direction: routes -> schemas/services/LLM tasks; tasks/providers ->
shared LLM infrastructure and domain services; email workflows -> SMTP integration;
all infrastructure may use core configuration. Domain Map operations do not import
providers. Keep package initializers minimal; preserve ORM registration side effects.

Implementation: move modules, update imports and monkeypatch targets, preserve
source-relative pattern/prompt paths, extract the four inline schemas verbatim,
then Black-format Python at width 100. Validate full OpenAPI/router/ORM metadata
against the before snapshot, normalized Python AST against moved originals, full
tests, disposable FastAPI startup and real frontend/backend contracts.
