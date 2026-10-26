# Run FeelY

## Recommended: Docker

Requirements: Docker Desktop running Linux containers and Compose. Node,
PostgreSQL and Python dependencies run inside the images. The environment
helper uses the existing Python virtual environment when available, otherwise
a temporary Python container.

From PowerShell at the repository root:

```powershell
.\feely.bat start
```

| Address | What it opens |
| --- | --- |
| http://127.0.0.1:5173 | FeelY website, including `/admin.html` and `/webmail.html` tools |
| http://127.0.0.1:8000/api/v1/health | Backend health |
| http://127.0.0.1:8025 | Mailpit test inbox; use this for local activation/reset emails |

The webmail tool needs separate provider configuration; Mailpit works immediately.
Register an account, find its PIN in Mailpit and activate it to log in. Local mock
chat works without an API key. API documentation is disabled by default.

```powershell
.\feely.bat check     # Engine and configuration checks
.\feely.bat status    # Container health and published ports
.\feely.bat logs      # Ctrl+C exits log viewing; containers keep running
.\feely.bat stop      # Stops containers; keeps database and prompt volumes
```

Re-run `start` after code changes to rebuild. This runs the compiled website;
use Vite below for live reload. `start-feely.bat` remains the **native** launcher.

## Plain Compose commands (also usable outside Windows)

Generate `.env.docker` once with Python 3.11+; the helper never overwrites a file:

```sh
python scripts/setup_docker_env.py
docker compose --env-file .env.docker --profile app config --quiet
docker compose --env-file .env.docker --profile app up -d --build --wait
docker compose --env-file .env.docker --profile app ps
docker compose --env-file .env.docker --profile app down
```

If Python is unavailable, generate the file with the Python container command
in [the local Docker guide](docs/DEPLOYMENT_LOCAL.md).

## Edit frontend with live reload

Stop the full app first to free port 5173. Start only the backend, database and mail:

```powershell
.\feely.bat stop
docker compose --env-file .env.docker up -d --build --wait
npm ci --prefix frontend-react
npm run dev --prefix frontend-react
```

This workflow needs Node on the host. Open http://127.0.0.1:5173. Host Vite calls
the Docker API on port 8000. See [frontend development](frontend-react/README.md).

## Configuration and data

- Docker reads `.env.docker`, generated from `deployment/.env.example`.
- Native startup reads `.env`, based on `.env.example`.
- Production uses `.env.production` and `compose.production.yml` with its own guide.

Existing native data stays separate. Docker PostgreSQL and edited prompts live in
named volumes and survive `stop`, `down` and rebuilds. Do not use `down -v` unless
you intend to erase those Docker volumes. See [data transfer](docs/DATABASE_MIGRATION.md)
before switching an existing installation.

For a native installation, follow [native setup](docs/DEPLOYMENT_NATIVE.md).

## Troubleshooting

- **Docker API / named pipe unavailable:** open Docker Desktop and wait for the
  Linux engine. Installing the CLI alone does not start an engine.
- **Virtual Machine Platform not enabled / no virtualization available:** Docker
  Desktop cannot start the Linux engine until Windows virtualization prerequisites
  are enabled. Check Windows Virtual Machine Platform and firmware virtualization;
  this machine reported this error during the structure review.
- **Port already allocated:** stop the previous native backend or Vite instance.
  Local defaults are 8000, 5173 and 8025. You can set `FEELY_API_PORT`,
  `FEELY_WEB_PORT` and `FEELY_MAILPIT_PORT` in `.env.docker`. If the website port
  changes, update `PUBLIC_APP_URL` and `CORS_ORIGINS` to match. Host Vite also needs
  its API base adjusted if the backend port changes.
- **Startup fails:** run `.\feely.bat status` and `.\feely.bat logs`. Database
  migration failures stop backend startup; resolve the reported error first.
- **Unexpected database/provider:** shell variables override Compose env files.
  Clear stale `DATABASE_URL`, `SECRET_KEY`, `POSTGRES_*` or
  `FEELY_DOCKER_ENV_FILE` exports before running local commands.
- **Prompt edits seem unchanged after rebuilding:** the persistent prompt volume
  keeps administrator edits. A rebuild does not replace those edits.
