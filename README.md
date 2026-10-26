# FeelY

FeelY is a reflection app with chat, a personal map, account management and
optional paid subscriptions. The API is Python/FastAPI; the website is React.

## Start with Docker

Follow [Docker startup](deployment/README.md) to generate `.env.docker` once, then:

```sh
docker compose --env-file .env.docker up -d --build --wait
```

Open **http://127.0.0.1:5173**. Activation PINs and reset emails appear at
**http://127.0.0.1:8025**. The default chat provider is a local mock.

```sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --follow --tail 100
docker compose --env-file .env.docker down
```

The default stack includes the website, API, PostgreSQL and test mail. Stopping
preserves data and prompt edits. Docker is the only required host runtime.

For your own webserver use [production deployment](docs/DEPLOYMENT_PRODUCTION.md)
and `compose.production.yml`. Its template and Docker support files live in
`deployment/`. [Mail setup](docs/EMAIL_SETUP.md) covers Hetzner, your own SMTP/IMAP
server and the optional Cloudflare bridge.

## Where things live

| Location | Purpose |
| --- | --- |
| `backend/` | FastAPI app: HTTP routes, business rules, models and LLM integrations |
| `frontend-react/src/` | React pages, feature logic, API clients and frontend tests |
| `frontend-react/public/` | Admin/webmail tools, images, styles and legal documents |
| `migrations/` + `alembic.ini` | Versioned database changes; required for PostgreSQL |
| `prompts/` | Editable chat and topic prompts |
| `deployment/` | Docker images, setup templates/helpers, health checks and proxy |
| `scripts/` | Setup, migration, release and validation tools; [script index](scripts/README.md) |
| `tests/` | Python integration/domain tests and standalone JavaScript checks |
| `docs/` | [Documentation index](docs/README.md), code guide and operational guides |
| `deployment/mail/` | Mail options: local testing, IMAP/SMTP and optional Cloudflare bridge |

The two root Compose files are the startup entry points. `deployment/` contains
both image definitions, local/production configuration templates, setup and
container startup helpers. `scripts/` contains occasional operator and validation
tools, rather than separate application launchers.

Local configuration, databases and generated files stay outside source control.
Existing `.env` and SQLite data are preserved; [migrate data](docs/DATABASE_MIGRATION.md)
explicitly before switching an existing installation to Docker.

## Find a change

Start with [the code guide](docs/CODE_GUIDE.md) for the request flow and where to
put new code. See [the frontend architecture](frontend-react/ARCHITECTURE.md) for
React boundaries and [the LLM guide](backend/llm/README.md) for model integrations.

For configuration beyond local defaults, use [feature settings](docs/FEATURES.md),
[email setup](docs/EMAIL_SETUP.md), [database migration](docs/DATABASE_MIGRATION.md)
and [production deployment](docs/DEPLOYMENT_PRODUCTION.md).

Inspect the [complete database schema](docs/DATABASE_SCHEMA.md),
[map storage](docs/MAP_DATABASE_SCHEMA.md) and [design review](docs/DATABASE_REVIEW.md)
for the relational model and remaining improvement areas.
