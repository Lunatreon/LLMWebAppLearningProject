# Backend structure

Structural/readability cleanup completed on 2026-10-13. Application behavior,
HTTP contracts, SQLite queries/transactions, ORM behavior, authentication, email
and LLM behavior are preserved. No PostgreSQL, Docker or database migration was added
by that structural cleanup. The subsequent [database portability foundation](DATABASE_MIGRATION.md)
adds opt-in PostgreSQL, Alembic and migration verification without relocating domain code.
The [audit](archive/BACKEND_STRUCTURE_AUDIT.md) records every original router/schema/service/
LLM module, DB/email locations, cross-module imports and the proposed boundaries.

## Package rename and local cleanup (2026-10-21)

The Python package is now `backend/`. Imports, Uvicorn entry points, Docker
build inputs, scripts, tests and setup instructions use `backend`.
Run `python -m uvicorn backend.main:app` from the repository root; the root
`main.py` compatibility entry point continues to export the same FastAPI app.
The container working directory remains `/app`, with Python code in `/app/backend`.

The obsolete bytecode-only `services/llm/` tree and generated Python/test caches
were removed. The active LLM code lives in `backend/llm/`. All remaining source
folders support application, frontend, deployment, migration, prompt or test work.

## Where code belongs

```text
backend/
  api/
    dependencies.py, router.py
    routes/              HTTP handlers, including the separate public website router
  schemas/               Pydantic request/response models
  services/              billing, usage, Map domain, Terms, email workflows, webmail
  llm/
    providers/           factory, OpenAI, Anthropic, Ollama, deterministic local provider
    tasks/               summaries, pattern/suggestion/topic helpers
    context.py, prompts.py, streaming.py, json_response.py, responses.py, types.py
  integrations/email.py  authenticated SMTP transport
  db/                    engine/session, datetime compatibility, local SQLite init, schema checks
  models/                existing SQLAlchemy declarations
  core/                  settings, security, middleware, CAPTCHA, rate limits
  main.py                API app/lifespan entry point
  website.py             public website app/middleware entry point
```

Routes depend on schemas and named services/tasks. Providers depend on shared LLM
infrastructure; model-facing tasks may use domain Map helpers. The Map service
does not call providers. Email workflows own token rules/composition and use the
SMTP integration; webmail retains durable delivery/acknowledgement ordering.
Use clear absolute imports, not a generic utils or repository framework.

`self_authorship.py` deliberately remains a service: it owns Map CRUD, accepted
profile fields and merge protection. Moving it wholesale into LLM infrastructure
would confuse authoritative user data with model suggestions. Database operations
stay in their existing routes/services; transaction boundaries are not relocated.

## Moves and extraction

| Old location | New location |
| --- | --- |
| `app/services/llm/` (14 Python modules and README) | `backend/llm/`, preserving provider/task filenames |
| `app/services/prompts.py` | `backend/llm/prompts.py` |
| `app/services/conversation_summary.py` | `backend/llm/tasks/conversation_summary.py` |
| `app/services/map_suggestions.py` | `backend/llm/tasks/map_suggestions.py` |
| `app/services/pattern_recognition.py` | `backend/llm/tasks/pattern_recognition.py` |
| `app/services/topic_matching.py` | `backend/llm/tasks/topic_matching.py` |
| `app/core/mail.py` | `backend/integrations/email.py` |
| `app/core/email_verification.py` | `backend/services/email_verification.py` |
| `app/core/password_reset.py` | `backend/services/password_reset.py` |
| `app/core/feedback_mail.py` | `backend/services/feedback_notifications.py` |
| FeedbackCreate / FeedbackRead in feedback route | `backend/schemas/feedback.py`, unchanged class names/validators |
| AcceptTerms in terms route | `backend/schemas/terms.py`, unchanged class name/fields |
| Compose in webmail route | `backend/schemas/webmail.py`, unchanged class name/header validation |
| Public website constants/handler | `backend/api/routes/website.py`; entry-point exports retained for callers |

24 whole files moved (23 Python files plus README). Two descriptive filename
renames are mail -> email and feedback_mail -> feedback_notifications. All Python
imports and monkeypatch targets were updated, including one import in the React
disposable fixture. React application code and legacy frontend files are unchanged.
The moved pattern file's source-root depth was corrected; prompts/rules still read
the same `prompts/` and `docs/pattern_recognition.txt` resources.

The unused eager LLM package facade was removed; import from concrete factory,
task and type modules. Package initializers remain minimal. ORM registration/
exports in models and website entry-point compatibility are retained intentionally.
No runtime source-level import cycles were found before or after cleanup; ORM
TYPE_CHECKING backreferences are not runtime cycles. Logger namespaces naturally
follow the moved modules; message content and delivery/error behavior are unchanged.

Large mixed modules remain explicit deferred work: LLM route orchestration
(1074 formatted lines), Map/profile service (720), Stripe billing/webhook service
(674), Ollama provider (530), local provider (499), users routes (431), auth routes
(427). Splitting their algorithms or transaction ownership
belongs in a separately validated architecture change, not this structural pass.

## Formatting and extending

Black is the only added development tool, pinned in requirements-dev.txt with
100-column formatting and a Python 3.11 target in pyproject.toml. Runtime
requirements.txt and the existing environment are unchanged. To install/use it:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m black backend tests
.\.venv\Scripts\python.exe -m black --check backend tests
.\.venv\Scripts\python.exe -m pytest -q
```

Validation used a temporary Black install outside the repository rather than
altering the existing venv. Put new routes in api/routes and register API routers
in api/router; put request/response models in schemas. Add domain operations to a
named service, model operations to llm/tasks and SDK/HTTP implementations to
llm/providers. Keep credentials/configuration in core settings and preserve
existing cancellation/transaction ownership when extending these modules.

## Validation and integrity

- Complete Python suite: **182 passed, one opt-in running-server test skipped**.
  That live-server test was separately enabled against disposable SQLite and
  **passed**, so all 183 collected behaviors were validated. Existing FastAPI/httpx
  deprecation warning remains.
- **49 legacy JavaScript tests passed**, with `node --test --test-concurrency=1 tests/*.test.cjs`.
- Real React Chat/backend HTTP/SQLite contract passed after relocation, including
  history, NDJSON, cancellation, quotas, reactions/reviews and Map source links.
  The real password-recovery/reset contract was also run against a fresh fixture.
- All **75 Python modules import**; compileall and Black checks pass. The complete
  OpenAPI document, **70 API route registrations / 61 paths**, and metadata for
  **ten ORM tables** compare equal to the pre-cleanup snapshot.
- Before the website extraction, **69 executable module ASTs** matched their
  moved originals after normalizing imports and the necessary pattern-path depth;
  all four extracted schema ASTs matched exactly. SQL expressions, statements,
  transactions, defaults and provider/task algorithms were not edited.
- The final public website allowlist/root and **18 GET/HEAD response, redirect,
  security/cache-header checks** match an executable pre-cleanup reference.
  A security test's monkeypatch was retargeted to the new handler module.
- FastAPI started successfully on loopback 18022 with a fresh temporary database,
  mock providers, no SMTP/Stripe/webmail/prewarm, and the existing startup lifecycle.
  No actual local database or external service was used for startup/live tests.

The baseline Python suite had six stale assertions: opaque Origin:null expected
permission despite the existing CORS rejection, and five unversioned asset-string
checks despite the existing cache-busting URLs. Those expectations now reflect
current behavior without changing production CORS/assets. One JS test likewise
expected three gateway attempts while the unchanged loader implements six. No
test was removed or disabled to obtain a passing result.

Temporary validation servers are stopped afterward. Existing application services
are left alone. Website assets, prompt/rule files, SQLite setup and HTTP/DB
semantics remain intact; this is not a database/backend architecture rewrite.
