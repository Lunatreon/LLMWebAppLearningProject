# Start FeelY with Docker

Docker Engine/Desktop with Linux containers and Compose 2.30+ is the only host
runtime required. Run the commands below from the repository root. Python, Node,
PostgreSQL and the website run in containers.

## Local app

Generate `.env.docker` once. This keeps existing settings and data unchanged.

PowerShell:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" --workdir /workspace python:3.13.14-slim-bookworm python deployment/setup.py
```

Linux/macOS:

```sh
docker run --rm --user "$(id -u):$(id -g)" --mount "type=bind,source=$PWD,target=/workspace" --workdir /workspace python:3.13.14-slim-bookworm python deployment/setup.py
```

Start the whole app:

```sh
docker compose --env-file .env.docker up -d --build --wait
```

| Address | Opens |
| --- | --- |
| http://127.0.0.1:5173 | FeelY website, `/admin.html` and `/webmail.html` |
| http://127.0.0.1:8025 | Mailpit test inbox with activation PINs and reset links |
| http://127.0.0.1:8000/api/v1/health | API readiness |

Register, retrieve the activation PIN from Mailpit, and sign in. Chat uses a mock
provider until you configure a model. Mailpit captures test mail locally; the
optional admin webmail inbox needs [mail configuration](../docs/EMAIL_SETUP.md).

```sh
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs --follow --tail 100
docker compose --env-file .env.docker down
```

The generated `.env.docker` also contains an independent map-encryption key.
Protect and back it up separately from database dumps. Existing installations
need the [map upgrade step](../docs/MAP_DATABASE_SCHEMA.md#upgrade-an-existing-docker-installation)
before starting revision 0003.

`down` stops/removes containers and preserves database and prompt volumes.
Use the startup command again after changing code or configuration. Do not use
`down -v` unless you intend to erase the volumes. Existing SQLite data is not
automatically imported; see [data migration](../docs/DATABASE_MIGRATION.md).

## Public server

Use [server deployment](../docs/DEPLOYMENT_PRODUCTION.md). Its production Compose
file serves the website/API over HTTPS and keeps PostgreSQL private. Configure
`deployment/.env.production.example` as `.env.production` first. Setup and
validation run in the backend image; no host Python environment is needed.

## Startup files

| File | Responsibility |
| --- | --- |
| `../compose.yml` | Full local app: website, API, PostgreSQL, test mail |
| `../compose.production.yml` | Public server: HTTPS website/API and PostgreSQL |
| `backend.Dockerfile`, `frontend.Dockerfile` | Build API and website images |
| `.env.example`, `setup.py` | Generate local configuration with random secrets |
| `.env.production.example`, `production.py` | Production settings and validation |
| `entrypoint.py`, `healthcheck.py` | Container database migration/startup and readiness |
| `Caddyfile`, `postgres/` | Reverse proxy and production database initialization |

The runtime helpers are invoked by Docker. There are no separate native or batch
launchers. VS Code tasks use these same Compose commands.

## Troubleshooting

- Docker cannot connect: start Docker Desktop/the Docker daemon and wait for the
  Linux engine. Windows requires working virtualization/WSL prerequisites.
- Port conflict: local defaults are 5173, 8000 and 8025. Edit `FEELY_WEB_PORT`,
  `FEELY_API_PORT`, `FEELY_MAILPIT_PORT` in `.env.docker`; update `PUBLIC_APP_URL`
  and `CORS_ORIGINS` when changing the website port.
- Startup fails: inspect `ps` and `logs`. Migration failures prevent API startup.
- Unexpected configuration: clear stale shell variables such as `DATABASE_URL`,
  `SECRET_KEY`, `POSTGRES_*` and `FEELY_DOCKER_ENV_FILE`; they override env files.
- Rebuilt prompts appear unchanged: the persistent volume preserves admin edits.
