# Local deployment environment — Backend Phase 3

The primary Compose stack runs the existing FastAPI entry point, PostgreSQL 17
and Mailpit. React stays on the host. The host-based SQLite `.env`, `feely.db`,
legacy website and frontend implementation are untouched. Nothing is deployed
externally. This is a development stack with deployment-style process/schema
ownership, not a production configuration.

## CI Docker validation — Backend Phase 3.5

`.github/workflows/docker-integration.yml` runs on pull requests, pushes to
`main`/`master` (plus `codex/backend-phase35-docker-validation` for this rehearsal),
and manual **Actions → Docker integration → Run workflow**.
It needs no repository secrets, OpenAI key, model server, production database or
external mail account. It uses an Ubuntu 24.04 GitHub-hosted runner with real
Docker Engine/Compose, Python 3.13.14 and Node 24. The official
[checkout](https://github.com/actions/checkout),
[setup-python](https://github.com/actions/setup-python),
[setup-node](https://github.com/actions/setup-node) and
[upload-artifact](https://github.com/actions/upload-artifact) actions are pinned
to commit SHAs. The token has read-only contents permission and checkout does not
persist credentials. Fork PR code runs under `pull_request`, with no secrets.

The workflow installs the existing dev dependencies, runs the complete default
SQLite Python suite and legacy JS suite, then calls `scripts/docker_integration.py`.

The regression step explicitly selects `ENVIRONMENT=local` and a loopback CORS
allowlist without opaque (`null`) origins, reproducing the existing tested local
configuration without copying a developer `.env`. A clean checkout otherwise
uses the application's older fallback CORS list, which includes `null` and
contradicts the existing opaque-origin rejection test. This CI configuration
does not change application defaults or the Docker runtime environment.

It then performs these checks:

1. Generate a separate `.env.docker` with the existing generator, random throwaway
   signing/database secrets, mock LLM, Mailpit and synthetic configured Terms
   metadata. The React reset origin stays `http://127.0.0.1:5173`. No external
   Terms PDF is fetched. Existing `.env` and `.env.docker` are never read or edited.
2. Run `docker compose config --quiet` and actually build the backend image with
   `docker compose build --pull backend`. Shell configuration cannot override the
   generated CI values with host credentials or a different database/provider.
3. Start PostgreSQL/Mailpit first and poll Docker health with a 180-second
   deadline. Assert PostgreSQL has zero public tables before starting FastAPI.
   Then start the backend and wait for all three services' real health checks.
4. Verify the existing public HTTP health response, startup migration, explicit
   idempotent `alembic upgrade head`, `current`/`heads`, and exactly the ten
   application tables plus `alembic_version`. Assert no domain rows were seeded.
5. Stream `deployment/docker_checks.py` into the running backend without adding
   test tooling to its image. Check authenticated backend-to-PostgreSQL queries,
   backend-to-Mailpit SMTP EHLO, UID/GID 10001, no effective capabilities,
   no-new-privileges, read-only application directories and writable prompt/tmp
   locations. Only newly created permission-probe files are removed; permissions
   are never relaxed. Verify mock-provider configuration and no baked `.env`/SQLite.
6. Run `scripts/validate-local-stack.mjs` through the unchanged React API/session
   modules: registration, a real Mailpit activation email/PIN, activation, login,
   configured Terms acceptance/readback, Account update/readback, streamed mock
   Chat, Journal, Map and Practice Reflection, recovery email, React-origin reset
   URL parsing, password reset and login with the replacement password.
7. Snapshot counts and hashes of **every stored column** across all ten tables,
   `docker compose down`, restart and compare before login changes last-login
   timestamps. Then log in and reread the same Account, Terms, Chat, Journal,
   Map and Reflection over HTTP.
8. Stop the backend normally with a 20-second Docker stop timeout and a 30-second
   command bound. Require exit code zero, no OOM/SIGKILL exit, a completed Uvicorn
   shutdown and no traceback in backend logs.
9. Collect logs before each destructive lifecycle boundary. Run explicit
   `docker compose down -v --remove-orphans`, restart and require an empty migrated
   ten-table database and empty Mailpit inbox. Recheck runtime permissions/networking.
10. Scan container logs for the generated DB/signing secrets, actual rehearsal
    passwords, JWTs, activation PIN and reset token, plus patterns for unregistered
    passwords, PostgreSQL credentials, API keys and reset links. A finding fails
    CI; known values/patterns are redacted before any diagnostics are printed or
    uploaded. This is a targeted regression check, not proof that arbitrary future
    secret formats cannot leak.

Readiness retries use bounded polling; there are no unconditional startup sleeps.
Each subprocess and HTTP request has a timeout. A separate `always()` cleanup step
runs `docker compose down -v --remove-orphans`, even after runtime/log failures.
The harness accepts only `feely-ci-*` projects, refuses existing containers/volumes
with that project name, and removes resources only after recording ownership.
The existing `feely-local` stack and DB-only Compose stack are outside this scope.

The Actions job summary and `docker-integration-results` artifact contain per-check
PASS/FAIL/NOT RUN results and sanitized build/container diagnostics, retained seven
days. Raw env files, HTTP state, database rows, message bodies and the private
secret registry are excluded. The working directory is a new private temp folder
outside the build context. Failed jobs print sanitized logs automatically.

### Run the same checks locally when Docker is available

Use a Linux-container Docker daemon, Compose v2+, Python with
`requirements-dev.txt`, and Node 24 with `npm ci --prefix frontend-react`.
Ports **8000 and 8025 must be free**: stop your local reference stack deliberately
before this rehearsal, or use a separate Docker host. Do not point these commands
at production. The harness generates its own configuration; do not pass real keys.

PowerShell, from the repository root:

```powershell
python -m pip install -r requirements-dev.txt
npm ci --prefix frontend-react
$env:ENVIRONMENT = 'local'
$env:CORS_ORIGINS = '["http://127.0.0.1:5500","http://localhost:5500","http://127.0.0.1:5173","http://localhost:5173"]'
python -m pytest -q
node --test --test-concurrency=1 tests/*.test.cjs

$dockerCheckId = [guid]::NewGuid().ToString('N')
$dockerCheckDir = Join-Path $env:TEMP "feely-ci-$dockerCheckId"
python -m scripts.docker_integration prepare --work-dir $dockerCheckDir --project "feely-ci-$dockerCheckId"
if ($LASTEXITCODE -ne 0) { throw 'Docker check preparation failed' }
try {
    foreach ($dockerCheckAction in @('config', 'build', 'run')) {
        python -m scripts.docker_integration $dockerCheckAction --work-dir $dockerCheckDir
        if ($LASTEXITCODE -ne 0) { throw "Docker check failed: $dockerCheckAction" }
    }
} finally {
    try {
        python -m scripts.docker_integration diagnostics --work-dir $dockerCheckDir
        if ($LASTEXITCODE -ne 0) { throw 'Docker diagnostic or secret-scan check failed' }
    } finally {
        python -m scripts.docker_integration cleanup --work-dir $dockerCheckDir
        if ($LASTEXITCODE -ne 0) { throw 'Docker cleanup failed; remove the disposable project manually' }
    }
}
Get-Content (Join-Path $dockerCheckDir 'summary.md')
```

For Bash after installing dependencies:

```bash
set -euo pipefail
export ENVIRONMENT=local
export CORS_ORIGINS='["http://127.0.0.1:5500","http://localhost:5500","http://127.0.0.1:5173","http://localhost:5173"]'
python -m pytest -q
node --test --test-concurrency=1 tests/*.test.cjs
docker_check_id="$(python -c 'import uuid; print(uuid.uuid4().hex)')"
docker_check_dir="${TMPDIR:-/tmp}/feely-ci-$docker_check_id"
python -m scripts.docker_integration prepare --work-dir "$docker_check_dir" --project "feely-ci-$docker_check_id"
finish_docker_check() {
  result=$?
  trap - EXIT
  python -m scripts.docker_integration diagnostics --work-dir "$docker_check_dir" || result=1
  python -m scripts.docker_integration cleanup --work-dir "$docker_check_dir" || result=1
  exit "$result"
}
trap finish_docker_check EXIT
python -m scripts.docker_integration config --work-dir "$docker_check_dir"
python -m scripts.docker_integration build --work-dir "$docker_check_dir"
python -m scripts.docker_integration run --work-dir "$docker_check_dir"
```

Only `summary.md`, `report.json` and `*.log` in that temp folder are safe diagnostic
outputs. Other files contain disposable credentials/tokens and must not be shared.
Keep the folder until cleanup succeeds; then it can be removed. The helper uses
the real Compose file unchanged, overriding only project name and generated env
location. Its explicit reset deletes its own PostgreSQL **and prompt** volumes.

Creating this workflow does not constitute a successful Docker run. Check the
Actions result for the exact commit containing the Phase 3 setup **and** Phase 3.5
files. The development machine still has no Docker daemon; the earlier native
service evidence below must not be read as image, network, volume or signal proof.
Browser-rendered parity remains a separate validation gate; this job exercises
the actual frontend clients over HTTP without rendering React pages.

### Validated Docker run — 2026-10-14

[GitHub Actions run 38555165763](https://github.com/Lunatreon/FeelY/actions/runs/38555165763)
passed on the isolated `codex/backend-phase35-docker-validation` branch at code
commit `5c4f35759d2b7355c388c438150a8dfbeea7156a`. The subsequent documentation
update does not change the validated runtime/scripts. `main` was not updated.

| Check | Observed result |
| --- | --- |
| Image and Compose | Real backend build and Compose configuration passed on Ubuntu/Docker. |
| PostgreSQL and Alembic | Empty pre-start catalogue; startup/explicit upgrade succeeded; current matched heads; all ten application tables existed. |
| Health and networking | All three container health checks passed; HTTP health, authenticated PostgreSQL queries and backend-to-Mailpit SMTP EHLO passed. |
| HTTP and real mail | Registration, activation mail/PIN, login, Terms, Account update, Journal, Map, Reflection, streamed mock Chat and recovery/reset passed; reset URL matched the configured React origin. |
| Persistence and reset | Every stored column survived down/up; saved HTTP records reread successfully; down -v/up produced a fresh migrated DB and empty Mailpit. |
| Shutdown | Normal backend stop finished within the bound, exit zero, no OOM and no traceback, with completed Uvicorn shutdown. |
| Permissions | UID/GID 10001, dropped capabilities, no-new-privileges, read-only app and writable owned prompts/tmp probes passed. No permission fixes were needed. |
| Secrets and cleanup | Container log scan passed; sanitized evidence uploaded; always() teardown removed the disposable containers, network and named volumes. |
| Regression checks | CI: 239 Python tests passed, five skipped; 49 legacy JS tests passed. Local PostgreSQL suite: 243 passed, one skipped. The 21 new harness safety tests are included in those totals. |
| Additional local checks | actionlint 1.7.12, Black, Prettier, Python compilation, generated-env Compose parsing, native PostgreSQL/Mailpit flow and native backend restart/readback passed. |
| Preservation | All 329 captured reference hashes matched, including application code, migrations, both frontends, prompts, existing .env/SQLite DB and the pre-existing Docker runtime files. |

The first clean-runner attempt exposed the existing CORS test's dependence on
local env configuration; the explicit regression-step environment above fixed
that CI setup issue. No application defaults, HTTP contracts, schema, SQL or
Docker runtime architecture were changed. The historical native-only evidence
below is retained as the Phase 3 record; this successful CI run supplies the
previously missing Docker runtime evidence. Hetzner deployment, production
TLS/ingress/secrets/mail/roles/backups review and browser validation remain deferred.

## Quick start

Prerequisites: Docker Desktop with Linux containers / Compose, or Docker Engine
with Compose on Linux; Node compatible with frontend-react/package.json; Python
3.11+ for the small stdlib-only environment generator. Host backend dependencies
are not needed to run the Compose API. The Python image is pinned to
`python:3.13.14-slim-bookworm`, matching the project's tested Python minor/patch.

From the repository root:

```powershell
python scripts/setup_docker_env.py
docker compose --env-file .env.docker config --quiet
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
docker compose --env-file .env.docker logs -f backend
```

The helper generates random local database/signing secrets in ignored `.env.docker`,
never prints them, never overwrites an existing file, and leaves `.env` alone.
Use the **--env-file .env.docker** flag on every Compose command: the existing
`.env` belongs to SQLite development. Shell environment variables take precedence
over env files; clear stale DATABASE_URL/SECRET_KEY/POSTGRES_* exports before
starting if they refer to another environment. `FEELY_DOCKER_ENV_FILE` can point
the backend env_file at a different file when intentionally using an alternative.

Without host Python, the generator can run in the official Python container:

```powershell
docker run --rm --mount "type=bind,source=$($PWD.Path),target=/workspace" --workdir /workspace python:3.13.14-slim-bookworm python scripts/setup_docker_env.py
```

In another terminal:

```powershell
cd frontend-react
npm ci
npm run dev
```

Open React at `http://127.0.0.1:5173`, the API at `http://127.0.0.1:8000/api/v1/health`,
and Mailpit at `http://localhost:8025`. The frontend's existing default API address
matches host port 8000. If you set FEELY_API_PORT to another port, use the existing
frontend API-base configuration as well. No frontend container was added.
The reference website can still be run with the existing host startup commands.

## Services, storage and startup

```text
host React :5173 -> host API :8000 -> backend:8000
                                      |-> postgres:5432
                                      |-> mailpit:1025
host Mailpit UI :8025 --------------------> mailpit:8025
```

Both published ports bind **127.0.0.1**. PostgreSQL and Mailpit SMTP have no host
port mapping; they are available only on the Compose service network. The stack
has project name `feely-local`, separate from the older DB-only compose.db.yml.
PostgreSQL 17.11 uses UTF-8 / C locale and UTC, with DB/user/password from env.
Its persistent `postgres_data` volume is mounted at /var/lib/postgresql/data.

The backend installs only requirements.txt. Pytest moved to requirements-dev.txt
alongside Black; that development file includes runtime requirements for host
tests. The image copies app, Alembic files, startup/probe modules, the existing
migration tool, prompt text and pattern_recognition.txt. The build context allowlist
and explicit COPY operations exclude `.env*`, databases, backups, tests, both
frontend trees, virtualenvs, credentials and unrelated documentation.

UID/GID 10001 runs the API. Its root filesystem is read-only, /tmp is writable
tmpfs, Linux capabilities are dropped, and privilege escalation is disabled.
The `prompts_data` named volume is initialized from the image's prompt files owned
by that UID, preserving the existing administrator prompt editor. Existing volumes
keep edited prompts on rebuild; image defaults do not overwrite them automatically.

Startup is:

1. Compose waits for PostgreSQL and Mailpit health checks.
2. The entrypoint performs a bounded DB retry with connection/query timeouts.
3. It runs **alembic upgrade head once per backend container start**.
4. It execs one Uvicorn process using `app.main:app`; normal FastAPI startup then
   verifies the schema head. It does not use create_all for PostgreSQL.

Migration failure or unavailable DB prevents API launch. There is no reload,
worker manager, per-request migration, Redis, queue or reverse proxy. Keep this
local stack at one backend container; scaled deployment needs separately owned
migrations and review of the existing process-local limits/transaction risks.

## Configuration boundaries

| Setting | Host development | Local Docker | Later production |
| --- | --- | --- | --- |
| Template | root .env.example | deployment/.env.example -> .env.docker | Separate reviewed secret-managed configuration |
| ENVIRONMENT | local | development | production, with existing security checks satisfied |
| DATABASE_URL | sqlite:///./feely.db default | postgresql+psycopg://USER:PASSWORD@postgres:5432/DB | PostgreSQL target, TLS/roles/network policy reviewed |
| POSTGRES_DB / USER / PASSWORD | Not required for SQLite | Generated local credentials / env-selected names | Separate bootstrap/migration/application permissions |
| SECRET_KEY | Existing host secret | Independently generated persistent local secret | Managed secret; preserve correct key during data cutover |
| SMTP | Existing optional provider config | mailpit:1025, no auth/TLS | Real authenticated/TLS SMTP/provider configuration |
| PUBLIC_APP_URL | Existing host setting | http://127.0.0.1:5173 | Actual HTTPS frontend origin |
| CORS_ORIGINS | Existing host origins | Explicit React and reference localhost origins | Exact approved HTTPS origins |
| OPENAI_API_KEY | Optional | Blank for mock; inject at runtime to use OpenAI | Secret manager, backend only |

When changing POSTGRES_DB/USER/PASSWORD, update the matching DATABASE_URL as well;
URL-encode password characters. Initial POSTGRES_* values apply only on an empty
volume; changing them later does not rename a database or rotate its password.
The generator intentionally keeps existing secrets stable across restarts.

Mock LLM startup needs no API key. To use existing OpenAI providers, set
LLM_PROVIDER=openai and OPENAI_API_KEY in .env.docker; the empty role-specific
overrides use that provider. Existing model variables and role overrides remain
available. No SDK/provider/task code changed. Ollama can use the configured
host.docker.internal address where supported; Linux host mapping requires an
explicit developer override. No paid provider was called during validation.

Local email verification and recovery are enabled and use the ordinary SMTP
integration. Mailpit's default SMTP capture is [unencrypted and authentication-free](https://mailpit.axllent.org/docs/configuration/smtp/);
only this development destination has SMTP_USE_TLS=false / SMTP_USE_SSL=false.
Root SMTP production-compatible defaults remain unchanged. No mail relay or
forwarding provider is configured in Mailpit. Incoming Cloudflare webmail is
separate and disabled in this local template.

The existing free-test-phase switch (PREMIUM_FEATURES_ENABLED=false) unlocks
Journal/Map/Reflection without Stripe for local flow tests. Billing/auth code and
production payment gates are unchanged. CAPTCHA is disabled only in this local
template; debug docs and Basic Auth are disabled, and proxy headers are not trusted.
This configuration must not be published as production configuration.

## Activation, reset and manual full flow

Activation remains the existing **six-digit PIN email**; it does not acquire a new
activation link. React registration navigates to its existing /activate flow.
Read the PIN in Mailpit and enter it in React, then use the separate Login step.
PUBLIC_APP_URL controls the existing reset link `/?reset_password_token=...`.
React already handles that legacy query and its /reset-password route, consumes
the token and removes it from navigation. No link semantics or email content changed.

With the stack healthy and Vite running:

1. Register a synthetic account in React; find its activation email in Mailpit.
2. Activate in React with the captured PIN, then Login.
3. Send a Chat message; reload and check saved history.
4. Save a Journal day, create a Map topic/practice, complete it in Reflection;
   reload to check the reflection persists.
5. Request a password reset; open its Mailpit link on the React origin, choose a
   new password, and Login again. Do not paste a reset link into logs or reports.

A repeatable smoke command also uses the **unchanged React clients/session and
reset-link parser**, real HTTP and SMTP capture. It creates only synthetic local
users and never prints credentials, JWTs, PINs or email contents:

```powershell
$env:FEELY_LOCAL_STACK_CHECK = '1'
node scripts/validate-local-stack.mjs
```

Optional FEELY_STACK_API_URL / MAILPIT_URL / APP_URL override loopback targets.
The complete names are FEELY_STACK_API_URL, FEELY_STACK_MAILPIT_URL and
FEELY_STACK_APP_URL. Explicit opt-in is required; use this only against the
isolated local stack, not your host SQLite reference or a deployed API. This is
client/API integration coverage, not a browser rendering or accessibility check.

## Health and logs

The existing /api/v1/health response stays `{"status":"ok"}`. Uvicorn cannot serve
it before lifespan startup has completed. After startup it remains a process/app
liveness endpoint, not a new DB-diagnostics HTTP contract.

Docker's internal Python healthcheck requires that HTTP response **and** a bounded
SELECT 1 on the configured DB. DB failure therefore marks the container unhealthy
even if the HTTP process is alive. No configuration details are exposed. Mailpit
uses its [readyz command](https://github.com/axllent/mailpit/blob/v1.31.5/Dockerfile),
and PostgreSQL uses pg_isready. Check health with `docker compose ... ps`; the
backend image probe is `python -m deployment.healthcheck`.

Uvicorn access logging is disabled in the container command to keep URLs/queries
out of routine logs. Normal startup/errors remain visible; application auth,
email and LLM logic is unchanged. Do not print `.env.docker` or unredacted
`docker compose config` output: rendered configuration includes secrets.

## Stop, restart and deliberate reset

```powershell
docker compose --env-file .env.docker stop
docker compose --env-file .env.docker up -d
docker compose --env-file .env.docker down
```

`down` removes containers/network and **keeps named PostgreSQL and prompt volumes**.
Mailpit messages use its temporary store and disappear when its container is
recreated. Docker volumes are intentionally not bound to the existing feely.db.

Only for an explicitly disposable stack reset:

```powershell
docker compose --env-file .env.docker down -v
```

That deletes **both local PostgreSQL data and edited prompt data**. Keep required
backups first; do not use this to troubleshoot a DB you need to retain. No reset
command was executed against existing data in this phase.

## SQLite migration rehearsal

Use only a disposable snapshot. The [migration guide](DATABASE_MIGRATION.md)
defines source validation, UTC acknowledgement, empty-target refusal, full row
verification and the paused-write cutover/rollback rules. Never mount real feely.db.
For a fresh rehearsal database, first generate the representative synthetic source:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
New-Item -ItemType Directory -Force backups
.\.venv\Scripts\python.exe -m scripts.create_deployment_snapshot --output backups/synthetic-source.db
$taskSnapshot = (Resolve-Path backups/synthetic-source.db).Path
```

This refuses an existing filename, creates all ten tables and includes an activated
synthetic account, valid password hash, Journal, completed practice/reflection,
Chat history, billing/event, Terms, feedback and mail data. Its fixed fixture
credentials are public synthetic values, not default application credentials.

On an **empty** isolated Compose database, before starting backend:

```powershell
docker compose --env-file .env.docker up -d postgres mailpit
docker compose --env-file .env.docker run --rm --entrypoint python backend -m alembic upgrade head
docker compose --env-file .env.docker run --rm --volume "${taskSnapshot}:/migration/source.db:ro" --entrypoint python backend -m scripts.database_migration check-source --source /migration/source.db --assume-naive-utc
docker compose --env-file .env.docker run --rm --volume "${taskSnapshot}:/migration/source.db:ro" --entrypoint python backend -m scripts.database_migration copy --source /migration/source.db --assume-naive-utc
docker compose --env-file .env.docker run --rm --volume "${taskSnapshot}:/migration/source.db:ro" --entrypoint python backend -m scripts.database_migration verify --source /migration/source.db --assume-naive-utc
docker compose --env-file .env.docker up -d backend
$env:FEELY_LOCAL_STACK_CHECK = '1'
$env:FEELY_CHECK_SNAPSHOT = '1'
node scripts/validate-local-stack.mjs
```

The last command authenticates the copied account and verifies preserved ID 42,
Journal content, Map reflection and Chat history, then exercises a fresh full flow.
Verify source equality **before** application writes: the later smoke intentionally
adds new rows, so comparing that evolved DB to the original snapshot would fail.
For another rehearsal, use a separate Compose project/empty volume rather than
overwriting a used target. A real-data cutover must carry the correct existing
SECRET_KEY/provider/Terms/capability configuration; this phase does not perform one.

## Backup/restore rehearsal

Create a custom-format archive inside the DB container, then use Docker cp.
Do **not** redirect pg_dump binary output with Windows PowerShell text redirection,
which can corrupt the archive. Pause writers for a controlled comparison:

```powershell
New-Item -ItemType Directory -Force backups
docker compose --env-file .env.docker stop backend
docker compose --env-file .env.docker exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/feely-backup.dump'
docker compose --env-file .env.docker cp postgres:/tmp/feely-backup.dump backups/feely-backup.dump
docker compose --env-file .env.docker exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" feely_restore'
docker compose --env-file .env.docker exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d feely_restore --no-owner --no-privileges --exit-on-error /tmp/feely-backup.dump'
```

Use a fresh restore database; createdb refuses an existing name. Copy .env.docker
to another **ignored** env file, preserve its SECRET_KEY/settings, change only
DATABASE_URL to the restored DB, and set FEELY_DOCKER_ENV_FILE to that new file.
Restart backend with that file and run alembic check, health and the same full-flow
smoke. Compare all ten typed row sets between original and restore using the
existing read_target / verify_rows verifier, including binary/JSON/timestamps,
before further writes. Preserve backups with restrictive filesystem permissions;
backups/ and *.dump are ignored and excluded from the build context.

For example, after editing .env.docker.restore as described:

```powershell
docker compose --env-file .env.docker.restore up -d --force-recreate backend
docker compose --env-file .env.docker.restore exec -T backend python -m alembic check
docker compose --env-file .env.docker.restore exec -T backend python -m deployment.healthcheck
$env:FEELY_LOCAL_STACK_CHECK = '1'
$env:FEELY_CHECK_SNAPSHOT = '1'
node scripts/validate-local-stack.mjs
```

The database row comparison can run inside the existing backend image, with
REHEARSAL_SOURCE_DATABASE_URL provided only to that probe process:

```python
import os
from app.core.config import settings
from app.db.session import create_database_engine
from scripts.database_migration import read_target, require_target_schema, verify_rows

source = create_database_engine(os.environ["REHEARSAL_SOURCE_DATABASE_URL"])
restored = create_database_engine(settings.database_url)
try:
    with source.connect() as a, restored.connect() as b:
        require_target_schema(a)
        require_target_schema(b)
        report = verify_rows(read_target(a), read_target(b))
        print({name: counts for name, counts in report.items()})
finally:
    source.dispose()
    restored.dispose()
```

Select the original DB URL for source and the restored URL for destination,
preserving secrets in environment rather than printing them. This compares every
typed column and ID, not just counts. Do it before the smoke adds another account.

This proves development recovery, not a production backup system. Production needs
off-host retention, restore timing, roles/extensions/TLS review and rehearsed
cutover/rollback with the actual data and stable secrets.

## Troubleshooting and remaining deployment gates

- Missing env variables: run the generator, use --env-file .env.docker, and check
  shell overrides. The helper will not regenerate keys over an existing file.
- Port 8000/8025 busy: stop only the intended conflicting service or change the
  host port variables and corresponding frontend/smoke URLs.
- Unhealthy DB: inspect postgres logs. Password changes in env do not change an
  already initialized volume; restore the correct secret or rotate it deliberately.
- Failed migration: inspect backend startup logs and run the explicit Alembic
  command. Do not stamp an unknown schema or bypass head checks with create_all.
- No activation/reset mail: inspect Mailpit and SMTP env (host mailpit, port 1025,
  auth/TLS off only here). Activation still needs separate Login. Reset requires
  PUBLIC_APP_URL to match the frontend origin.
- Prompt editing fails: verify the prompt volume's UID 10001 ownership. Preserve
  edited data when correcting permissions; do not delete the volume as a shortcut.
- Docker unavailable: configuration can be validated by standalone Compose and
  a Dockerfile parser, while native PostgreSQL/Mailpit can validate workflows.
  Those checks do not prove image build, Linux UID/volume permissions, PID 1/signal
  handling, container DNS/network readiness, or down/up/down -v persistence.

Before Hetzner deployment, run the actual image/Compose lifecycle and browser flow;
review production TLS/ingress, real CAPTCHA/CORS/mail settings, secret management,
narrower DB roles, durable backups/restore, prompt storage, scaling/migration
ownership and existing long transactions/quota/JSON concurrency risks. No Hetzner,
cloud, reverse proxy, production mail service or monitoring setup was introduced.

## Validation evidence — 2026-10-13

| Check | Result |
| --- | --- |
| Compose configuration | Official standalone Compose v5.6.0 parsed/normalized the stack; health dependencies, three services, loopback mappings, no public PG/SMTP port, read-only backend and volume mappings verified without printing rendered secrets. |
| Dockerfile | Parsed with dockerfile-parse 2.0.1; JSON entrypoint/CMD, pinned official Python manifest and file inputs checked. PostgreSQL 17.11-bookworm and Mailpit v1.31.5 image manifests also confirmed published. |
| Default SQLite regression suite | 218 passed, 5 skipped (four PG-only migration checks plus the existing opt-in live test). |
| PostgreSQL regression suite | 222 passed, one existing opt-in live test skipped, using a non-superuser test DB owner. |
| Deployment-specific tests | Ten new checks cover env preservation, mock/OpenAI config injection, valid read-only rehearsal data, bounded readiness, startup failure gates and combined HTTP/DB health. |
| Legacy JS suite | 49 passed. |
| SQLite -> PostgreSQL rehearsal | Fresh non-superuser-owned PG database, Alembic head, synthetic ten-table source, full before/after value verification; copied account/Journal/Map reflection/Chat reads and a new complete client flow passed. |
| Real SMTP + React client flow | Passed against PostgreSQL 17.11 and actual Mailpit 1.31.5 using normal SMTP/auth code, mock LLM, the existing React clients/session/reset parser. No fixture auth endpoints or fake mail transports. |
| Backup/restore | pg_dump custom archive -> fresh PG DB -> pg_restore; all 15 rows across ten tables compared exactly, schema check clean; restored application and the same full SMTP/React-client flow passed. |
| Readiness | Actual FastAPI lifespan/startup, DB wait, migrations and internal HTTP+DB probe passed on host-based PostgreSQL; migration/DB failure gates tested. |
| Formatting/imports/compile | Black check: 107 files; Prettier check for the new JS smoke; compile checks and imports of all 79 app/deployment modules passed. |
| Preservation | Full OpenAPI unchanged; app, migrations, prompts, both frontend trees, existing .env and feely.db matched baseline hashes. |

Docker Engine/Desktop is **not installed/available here**. Actual workflow,
migration and recovery tests used loopback-only portable PostgreSQL and Mailpit,
not containers. The Compose CLI validates configuration without a daemon; the
Dockerfile parser does not build an image. Linux runtime dependencies, UID/volume
ownership, PID 1 exec/signals, container DNS/network startup and Docker volume
lifecycle remain explicitly unverified. No `docker compose down -v` or actual
production-data migration/deployment was performed. Browser-rendered full-flow
testing of the Docker stack also remains pending.

Python/service image tags are pinned; application dependencies retain their
existing bounded version ranges. A production dependency/image update and locking
policy is still a separate deployment decision. The existing Starlette/httpx
deprecation is the sole Python test warning.
