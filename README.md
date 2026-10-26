# FeelY

FeelY is a reflection app with chat, a personal map, account management and
optional paid subscriptions. The API is Python/FastAPI; the website is React.

## Start here

Open Docker Desktop and wait for its engine to start. From PowerShell in this folder:

```powershell
.\feely.bat start
```

Open **http://127.0.0.1:5173**. Test emails, including activation PINs and password
reset links, appear at **http://127.0.0.1:8025**. The default chat provider is a
local mock; no paid API key is needed. The first start builds both images.

```powershell
.\feely.bat status
.\feely.bat logs
.\feely.bat stop
```

Stopping keeps the database and edited prompts. Startup generates `.env.docker`
only if missing and preserves existing settings. Docker uses its own database;
existing native data is not automatically copied into it.

[Startup and troubleshooting](STARTUP.md) includes plain Compose commands,
frontend development with live reload, and the native alternative.

## Where things live

| Location | Purpose |
| --- | --- |
| `backend/` | FastAPI app: HTTP routes, business rules, models and LLM integrations |
| `frontend-react/src/` | React pages, feature logic, API clients and frontend tests |
| `frontend-react/public/` | Admin/webmail tools, images, styles and legal documents |
| `migrations/` + `alembic.ini` | Versioned database changes; required for PostgreSQL |
| `prompts/` | Editable chat and topic prompts |
| `deployment/` | Container startup, health checks, frontend image and Caddy proxy |
| `scripts/` | Setup, migration, release and validation tools; [script index](scripts/README.md) |
| `tests/` | Python integration/domain tests and standalone JavaScript checks |
| `docs/` | [Documentation index](docs/README.md), code guide and operational guides |
| `cloudflare/webmail/` | Optional inbound-email Worker; not needed for local startup |

`compose.yml` defines local services. Its `app` profile adds the compiled frontend;
the Windows launcher enables it. `Dockerfile` builds the backend and
`deployment/frontend.Dockerfile` builds React/Caddy. Production uses
`compose.production.yml`; `compose.db.yml` is for a database-only native workflow.

`.env*`, `.venv/`, `node_modules/`, `dist/`, caches, databases and logs are local
configuration or generated files, not additional application implementations.
Do not delete environment files or databases as part of a code cleanup.

## Find a change

Start with [the code guide](docs/CODE_GUIDE.md) for the request flow and where to
put new code. See [the frontend architecture](frontend-react/ARCHITECTURE.md) for
React boundaries and [the LLM guide](backend/llm/README.md) for model integrations.
The [structure review](docs/PROJECT_STRUCTURE_REVIEW.md) explains what is used,
what is optional, and what overhead was removed from the main navigation.

For configuration beyond local defaults, use [feature settings](docs/FEATURES.md),
[email setup](docs/EMAIL_SETUP.md), [database migration](docs/DATABASE_MIGRATION.md)
and [production deployment](docs/DEPLOYMENT_PRODUCTION.md).
