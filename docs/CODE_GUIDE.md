# Code guide

Start with [Run FeelY](../STARTUP.md) for installation and commands. This guide
explains where a change belongs. [Backend structure](BACKEND_STRUCTURE.md) and
[frontend architecture](../frontend-react/ARCHITECTURE.md) give more detail.

## Entry points and request flow

`backend/main.py` creates the FastAPI app, installs middleware and mounts the API
router under `/api/v1`. `backend/api/router.py` registers the feature routers.
The root `main.py` exports the same app for compatibility; new commands should
use `backend.main:app`.

A typical request follows:

```text
React feature -> API client -> FastAPI route -> service -> SQLAlchemy -> database
                                  |
                                  +-> LLM provider or email integration when needed
```

1. `frontend-react/src/App.tsx` selects the page; `features/` owns each feature's
   components, state and API calls. Shared HTTP/session behavior lives in `services/`.
2. `backend/api/routes/` parses requests and uses dependencies from
   `backend/api/dependencies.py` for authentication and database sessions.
3. `backend/schemas/` defines validated request and response shapes.
4. `backend/services/` applies business rules. `backend/models/` declares database
   tables. `backend/db/session.py` owns the engine and session factory.
5. `backend/llm/` owns provider selection, model context, response parsing and
   analysis tasks. `backend/integrations/email.py` owns SMTP delivery.

## Where to make a change

| Change | Start here |
| --- | --- |
| Registration, login, activation, recovery | `backend/api/routes/auth.py`, `backend/services/email_verification.py`, `backend/services/password_reset.py`; React `features/auth/` |
| Chat and streaming | `backend/api/routes/llm.py`, `backend/llm/`; React `features/chat/` |
| Map, topics and reflection | `backend/services/self_authorship.py`, `backend/api/routes/users.py`; React `features/map/`, `features/reflection/` |
| Billing and premium access | `backend/services/billing.py`, `backend/api/routes/billing.py`; React `features/account/` |
| Terms | `backend/services/terms.py`, `backend/api/routes/terms.py`, `frontend-react/public/legal/` |
| Feedback | `backend/api/routes/feedback.py`, `backend/services/feedback_notifications.py`; React `features/feedback/` |
| Admin and webmail tools | Backend routers/services plus `frontend-react/public/admin.*`, `webmail.*` |
| Settings, auth, middleware | `backend/core/config.py`, `security.py`, `middleware.py`, `rate_limit.py` |
| Database schema | `backend/models/` and a new Alembic revision in `migrations/versions/` |
| Container startup and health | `deployment/entrypoint.py`, `deployment/healthcheck.py`, `compose.yml` |
| Page layout and appearance | React `components/layout/`, `src/styles/`, `public/styles.css` |

## Configuration ownership

`backend/core/config.py` loads settings. Root `.env` belongs to native startup;
`.env.docker` belongs to local Compose. The templates are `.env.example` and
`deployment/.env.example`. Production has a separate template and preparation tool.
See [feature settings](FEATURES.md) for provider, email and access options.

The React build accepts public settings only. `VITE_API_BASE_URL` defaults to
`/api/v1` in the compiled app. Never put server credentials in frontend settings.

Editable prompts live in `prompts/`. In Docker, administrator edits are stored in
the persistent prompt volume; changing image defaults does not overwrite that
volume. `docs/pattern_recognition.txt` is loaded by
`backend/llm/tasks/pattern_recognition.py` and copied into the backend image.

## Database startup

For PostgreSQL, Alembic owns schema changes. The Docker entrypoint applies
`alembic upgrade head` before starting Uvicorn, and FastAPI startup checks that
the schema is current. Native PostgreSQL setup must run that command explicitly.
Local unversioned SQLite has a development `create_all()` path; this is not the
PostgreSQL migration mechanism. See [database migration](DATABASE_MIGRATION.md).

## Add a feature

1. Add request/response schemas under `backend/schemas/`.
2. Put HTTP handlers in `backend/api/routes/`; register a new router in
   `backend/api/router.py`. Reuse current-user and database dependencies. Keep
   ownership checks explicit for user data.
3. Put reusable domain rules in `backend/services/`. Use `backend/llm/tasks/` for
   model-related analysis and `backend/llm/providers/` for provider integrations.
4. For persisted fields/tables, update the ORM model and add an Alembic revision.
   Preserve existing migration files so older databases can still upgrade.
5. Add the React behavior within the owning `features/` directory. Use the shared
   API client rather than building a second HTTP/session layer.
6. Test changed behavior with the existing backend or frontend fixtures.

See [the LLM guide](../backend/llm/README.md) before adding a provider. Shared
contracts, context builders and validators should remain independent of HTTP routes.

## Validation

Install Python test dependencies into a virtual environment, then run the checks
that cover your change. From repository-root PowerShell:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest -q
npm ci --prefix frontend-react
npm test --prefix frontend-react
npm run build --prefix frontend-react
node --test tests/terms_draft_ui.test.cjs
node --test cloudflare/webmail/worker.test.mjs
```

Python tests use fixtures in `tests/conftest.py`; React tests live in
`frontend-react/src/test/`. The optional running-server test requires a separately
started backend. Docker integration and PostgreSQL contract tools have separate
prerequisites; see [the script index](../scripts/README.md).

The local `app` profile serves a compiled React build through Caddy. For live
reload, run host Vite against the base Docker stack as described in startup.
