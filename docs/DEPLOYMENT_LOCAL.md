# Local Docker

Use [Run FeelY](../STARTUP.md) for the everyday commands. The full local app uses
the `app` Compose profile; omitting the profile leaves React to host Vite.

## Services and storage

```text
Browser :5173 -> frontend (Caddy + built React) -> backend:8000
                                                   |-> postgres:5432
                                                   |-> mailpit:1025
Browser :8000 ------------------------------------> backend:8000
Browser :8025 ------------------------------------> mailpit:8025
```

All published local ports bind to `127.0.0.1`. PostgreSQL and SMTP have no host
port mappings. The local frontend uses HTTP; public TLS belongs to the separate
[production stack](DEPLOYMENT_PRODUCTION.md).

The backend entrypoint waits for PostgreSQL, runs `alembic upgrade head`, then
starts one Uvicorn worker. A migration failure prevents the API from starting.
The backend runs as UID/GID 10001 with a read-only root and writable `/tmp` and
prompt volume. The frontend reuses the existing production React/Caddy image.

Named volumes under the `feely-local` project hold the database and edited prompts.
Mailpit captures test mail locally; no external email is sent by the default setup.
The frontend is compiled into its image. Rebuild after changing source or public
assets. Administrator prompt edits persist in the backend prompt volume.

## Generate configuration without host Python

From repository-root PowerShell, with Docker running:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" --workdir /workspace python:3.13.14-slim-bookworm python scripts/setup_docker_env.py
```

The helper creates `.env.docker` with independent random signing/database secrets
and leaves any existing file unchanged. It does not copy data or settings from
`.env`. Use `--env-file .env.docker` on every local Compose command.

## Validation tools

Python deployment tests: `python -m pytest tests/test_deployment.py tests/test_docker_integration.py`.
The [script index](../scripts/README.md) describes the disposable Docker integration
harness and production checks. The integration harness validates the base three
services without the optional frontend profile; it does not render React pages.
CI configuration lives in `.github/workflows/docker-integration.yml`.

Earlier phase-by-phase evidence is retained in
[Docker validation history](archive/DOCKER_VALIDATION_HISTORY.md). It includes
retired features and old machine limitations; use the current guides for setup.
