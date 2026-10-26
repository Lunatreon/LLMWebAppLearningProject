# Deploy FeelY on your own server

Use a Linux server with Docker Engine and Compose 2.30+, a domain pointing to the
server, and incoming ports 80/443. Node and Python run inside images. Run all
commands from the repository root. This is a single-host deployment.

```text
Browser -> Caddy HTTPS + React website -> API -> PostgreSQL
```

Only Caddy publishes ports. PostgreSQL uses an internal network. The backend has
outbound connectivity for model, mail and CAPTCHA providers. Production does not
run Mailpit or require a Cloudflare tunnel.

## Configure

Check out a tested release, then create private configuration:

```sh
umask 077
cp deployment/.env.production.example .env.production
chmod 600 .env.production
docker build --tag feely-backend --file deployment/backend.Dockerfile .
```

Generate a separate value for each of `SECRET_KEY`, `POSTGRES_PASSWORD` and
`POSTGRES_APP_PASSWORD`:

```sh
docker run --rm --entrypoint python feely-backend -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Generate an independent map-content key:

```sh
docker run --rm --entrypoint python feely-backend -c 'import base64,secrets; print(base64.b64encode(secrets.token_bytes(32)).decode())'
```

Store it under the active ID in `CONTENT_ENCRYPTION_KEYS` and preserve the key ring
across updates/restores. Database dumps do not contain the decryption keys; protect
a separate recovery copy of the private environment. Do not reuse the signing key.

Edit `.env.production`. Preserve the signing key across updates and restores.
Set `DATABASE_URL` to use the application DB role/password, not the bootstrap
administrator. Use URL-safe passwords or URL-encode the password in that URL.

| Settings | Configure |
| --- | --- |
| Website | Domain, public HTTPS URL, exact CORS origins, allowed hosts, certificate email |
| Database | Database name, separate bootstrap/application roles and passwords |
| Proxy | Unused private subnet and distinct reserved Caddy/backend IP addresses |
| Model | Chat/topic provider, model and backend API credentials |
| Mail | SMTP delivery credentials, authorized sender and TLS; [mail setup](EMAIL_SETUP.md) |
| Registration | Turnstile site and secret keys for your domain |
| Terms | Published HTTPS document URL, version and exact SHA-256 |

Activation, password recovery and rate limiting remain enabled in production.
Stripe and administrator webmail are optional. No provider secrets belong in
`VITE_*` settings. Buying a server does not configure domain, mail or model accounts.

## Validate and start

Run configuration preparation inside the backend image. The bind mount exposes
this checkout to the helper; no Docker socket or host Python is needed:

```sh
docker run --rm --user "$(id -u):$(id -g)" --entrypoint python \
  --mount "type=bind,source=$PWD,target=/workspace" --workdir /workspace \
  feely-backend -m deployment.production prepare --env-file .env.production --replace
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up -d --build --wait
docker compose --env-file .env.production -f compose.production.yml ps
```

Preparation validates settings and writes `.env.production.backend` with limited
file permissions. It filters out bootstrap DB credentials. Regenerate this file
whenever you change `.env.production`, then recreate containers. Runtime env-file
raw mode preserves literal `$`, `#` and quotes in SMTP passwords.

Run production using only `-f compose.production.yml`; do not merge local Compose
into it. The backend applies Alembic migrations before starting. Failed migrations
stop startup. The PostgreSQL app role is a non-superuser database owner, initialized
only when its volume is empty. Changing an env password does not rotate an existing
PostgreSQL role; update the database credentials explicitly.

Caddy obtains certificates automatically once DNS and ports 80/443 reach the host.
Open your configured HTTPS domain and check registration, activation, login, chat
and password reset. Follow [production smoke checks](PRODUCTION_SMOKE_TEST.md)
for a full acceptance pass. SMTP acceptance alone does not prove inbox delivery.

```sh
docker compose --env-file .env.production -f compose.production.yml logs --tail 100
docker compose --env-file .env.production -f compose.production.yml exec -T backend python -m deployment.healthcheck
docker compose --env-file .env.production -f compose.production.yml down
```

Stopping preserves database, prompt and TLS volumes. Never use `down -v` on a
production installation you need to retain. Existing local/native data requires
an explicit [migration](DATABASE_MIGRATION.md); changing Compose files does not copy it.

## Optional administrator login

Configure credentials using the backend image and the same private env file:

```sh
docker run --rm -it --user "$(id -u):$(id -g)" --entrypoint python \
  --mount "type=bind,source=$PWD,target=/workspace" --workdir /workspace \
  feely-backend scripts/set_admin_password.py --env-file .env.production --username admin
```

Regenerate the filtered environment and recreate the backend afterward. Open
`/admin.html` on the website. See [administration](admin.md) and [webmail](WEBMAIL_SETUP.md).

## Backups

Initial procedure: daily custom-format `pg_dump`, an additional dump before schema
changes, seven daily/four weekly/three monthly recovery points as a starting
retention policy, encrypted off-server copies, and a monthly isolated restore
test. Adjust retention/RPO/RTO to actual operational requirements. A Docker volume
or Hetzner VM snapshot alone is not the backup system. Do not add a complex
backup platform before this small procedure is reliable and scheduled.

Example server-side Bash procedure (restricted backup directory, no passwords in
arguments). Keep the previous successful backup until off-server transfer is verified:

```bash
set -euo pipefail
umask 077
backup_dir=/srv/feely-backups
install -d -m 700 "$backup_dir"
backup_name="feely-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
compose_prod() { docker compose --env-file .env.production -f compose.production.yml "$@"; }
compose_prod exec -T postgres sh -eu -c \
  'umask 077; exec pg_dump --username "$POSTGRES_APP_USER" --dbname "$POSTGRES_DB" --format=custom --file="$1"' \
  sh "/tmp/$backup_name"
compose_prod cp "postgres:/tmp/$backup_name" "$backup_dir/$backup_name.partial"
chmod 600 "$backup_dir/$backup_name.partial"
mv "$backup_dir/$backup_name.partial" "$backup_dir/$backup_name"
compose_prod exec -T postgres rm -- "/tmp/$backup_name"
sha256sum "$backup_dir/$backup_name" > "$backup_dir/$backup_name.sha256"
```

`pg_dump` uses the local socket and non-superuser DB owner inside PostgreSQL;
no DB port is opened. Copy the binary archive with `compose cp`; do not use
PowerShell text redirection for binary dumps. Archive edited `prompts_data`
separately while administrator editing is paused, and retain matching release
metadata. Protect Caddy TLS state and recovery secrets separately. A DB dump does
not include those volumes, roles or the master env.

Schedule this under a restricted host timer/cron account, capture success/failure
without secrets, transfer the archive/checksum over authenticated encrypted transport
to an **off-server destination**, then apply retention only after verifying transfer.
Do not retain the only archive on the Docker host. A provider/destination and
its access credentials are external deployment inputs, not included in this repo.

## Restore and recovery checks

Restore to a **new empty database/project/host**, never the active production DB.
Select the release that wrote the dump. On a separate Docker host, create a private
restore master/filtered env with the matching JWT key and fresh DB credentials.
If using the same host, choose a non-conflicting ingress subnet/IPs and a unique
project name first. Validate the restore configuration before creating resources.
Do not start the backend before restoring: its startup would migrate the empty DB.

```bash
restore_project=feely-restore-<unique-rehearsal-id>
compose_restore() { docker compose --env-file .env.restore -f compose.production.yml --project-name "$restore_project" "$@"; }
compose_restore up -d postgres
# Wait for PostgreSQL health with bounded polling; do not assume a fixed sleep is enough.
compose_restore cp /<private-backup-path>/<archive.dump> postgres:/tmp/restore.dump
compose_restore exec -T postgres sh -eu -c \
  'pg_restore --username "$POSTGRES_USER" --role "$POSTGRES_APP_USER" --dbname "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error /tmp/restore.dump'
compose_restore exec -T postgres rm -- /tmp/restore.dump
compose_restore run --rm --no-deps --entrypoint python backend -m alembic current
compose_restore run --rm --no-deps --entrypoint python backend -m alembic heads
```

Compare current/heads and inspect application tables/counts and known
records before new writes. Restore prompt edits if needed with UID/GID 10001
ownership, then start the restored backend, run readiness and the smoke checklist
on an isolated route. Record archive date, duration and verification results; test
at least monthly and after material DB changes. Dispose of rehearsal resources
only after verifying its unique project identity. Never copy a `down -v` command
from CI into the active production procedure.

## Updates

Take a database/prompt backup and record the current release/image identifiers.
Check out the tested release, rebuild `feely-backend` with the build command above,
rerun configuration preparation, then run the production Compose startup command.
Review migrations before upgrading and pause writes if compatibility requires it.

For code-only rollback, select the previous compatible release, rebuild and
recreate. For incompatible schema/data changes, restore the pre-update backup
into a separate database before switching traffic. Image rollback does not undo
schema changes. Keep release-matched configuration and signing keys available.

## Development checks

The disposable rehearsal lives in `scripts/production_ci.py`; it uses synthetic
credentials and isolated projects. It is a developer/CI tool, not a startup step.
