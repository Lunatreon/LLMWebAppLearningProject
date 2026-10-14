# Production deployment — Backend Phase 4

This prepares a single Linux Docker host. Nothing in this phase deploys to
Hetzner, provisions a domain, requests a certificate or contacts paid providers.
Use a tested revision that includes the Docker setup and this production layer.
Read [the complete configuration inventory](PRODUCTION_CONFIG_AUDIT.md) first.

## 1. Topology and requirements

```text
Internet :80/:443 → Caddy → backend:8000 → postgres:5432
                         ↘ React static files + /reference/ compatibility files
```

Only Caddy publishes host ports. PostgreSQL joins an internal Docker network;
the backend joins that network and a separate ingress network with outbound
connectivity for OpenAI, Siteverify and SMTP. There is no production Mailpit.
The validated initial target is Linux amd64, matching GitHub Actions. Docker
Engine with Compose **2.30+** is required for `extends`, replacement tags and raw
env files. Python 3.11+ with the runtime requirements is needed for the configuration
helper; the application itself runs Python 3.13.14 in its image. Node is built in
the frontend image and need not be installed on the server.

Choose RAM/CPU/disk against expected load and database growth; CI is functional
validation, not a capacity test. Reserve disk for images, PostgreSQL, prompt edits,
TLS state, temporary dumps and at least one restore rehearsal. Restrict SSH to
operators and permit incoming TCP 80/443. Do not open 5432, 8000, 8025 or 1025.
Docker daemon access is privileged server access; limit its operator membership.

The production file reuses backend/PostgreSQL definitions from `compose.yml` via
`extends`. Run **only** `-f compose.production.yml`; do not merge the local file
into it. Local development remains `docker compose --env-file .env.docker ...`.

## 2. Checkout, environment and secrets

Example future server directory: `/srv/feely`, owned by the deployment operator.
All commands below run there, after replacing placeholders. No server credentials
are assumed. Review scripts/config before running them on a server.

```bash
git clone <repository-url> /srv/feely
cd /srv/feely
git checkout <tested-commit-sha>
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
umask 077
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production` locally on the server or install it through your secret
manager. Never commit/upload it, paste it into logs, print rendered Compose JSON,
or use it as a Docker build argument. The template's domain, credential and Terms
placeholders intentionally fail validation. Keep private files out of backups
that lack encryption/access controls. Protect a separate recovery copy of secrets.

Generate **different** random values for `SECRET_KEY`, `POSTGRES_PASSWORD` and
`POSTGRES_APP_PASSWORD`:

```bash
.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Run this in a private terminal for each secret; do not put generated outputs in
CI logs. URL-safe passwords avoid escaping ambiguity. If another password format
is used, URL-encode it in `DATABASE_URL`; the decoded password must match
`POSTGRES_APP_PASSWORD`. Provider-issued OpenAI/SMTP/Turnstile credentials come
from their respective accounts. The JWT key also protects stored PIN/reset token
hashes; retain it across updates and database restores. Changing it invalidates
existing sessions and outstanding auth tokens.

Set the following groups explicitly:

| Group | Required values |
| --- | --- |
| Database | `DATABASE_URL`, `POSTGRES_DB`, bootstrap `POSTGRES_USER`/`POSTGRES_PASSWORD`, separate `POSTGRES_APP_USER`/`POSTGRES_APP_PASSWORD` |
| Auth | strong `SECRET_KEY`; production activation/recovery switches remain enabled |
| Web | `INGRESS_DOMAIN`, `PUBLIC_APP_URL`, `CORS_ORIGINS`, `ALLOWED_HOSTS`, `ACME_EMAIL` |
| Proxy | unused private `FEELY_PROXY_SUBNET` and distinct reserved Caddy/backend IPs |
| LLM | explicit providers for all three roles, backend-only key, model, timeout/retries |
| Mail | SMTP host/port, verified sender, TLS mode and provider credentials if authentication is used |
| Registration | production Turnstile public site key and backend secret for the frontend hostname |
| Terms | published HTTPS document URL, version and exact SHA-256 |

Stripe, webmail and administrator login are optional. Keep them disabled/unconfigured
until their credentials and operational requirements are ready. The initial template
preserves the existing free test-phase policy with `PREMIUM_FEATURES_ENABLED=false`;
switching commercial policy is a deliberate separate configuration decision.

## 3. Validate and filter configuration

```bash
.venv/bin/python -m scripts.production_config prepare --env-file .env.production
.venv/bin/python -m scripts.production_config check --env-file .env.production
docker compose --env-file .env.production -f compose.production.yml config --quiet
```

The helper rejects missing/placeholding required settings without printing their
values. It reads the chosen master file, ignoring developer environment fallbacks,
and creates `.env.production.backend` with restrictive permissions. The backend
receives only application `Settings` fields; it never receives the bootstrap DB
password. Caddy receives only public ingress/certificate configuration, and its
build receives only documented public `VITE_*` settings. Raw Compose env-file
format preserves literal `$`, `#` and quotes in SMTP passwords.

After editing the master, regenerate the filtered file with **`prepare --replace`**
and rerun `check` before recreating services. Keep the output path different from
the master. Use `FEELY_PRODUCTION_APP_ENV_FILE` when intentionally selecting a
different private output. Treat shell variables as potential Compose overrides;
clear stale production variables or run with a controlled deployment environment.
Do not mix `.env.docker` and `.env.production`.

Startup additionally rejects SQLite, administrative DB roles, insecure origins,
placeholder keys, local mail capture, disabled activation/recovery/rate limiting,
mock/local production LLM roles and incomplete enabled integrations. Development
and test settings remain available outside production. The old fallback CORS
allowlist is not safe production configuration and must never be inherited.

## 4. PostgreSQL ownership and startup

The fresh-volume init script creates `POSTGRES_APP_USER` with LOGIN and database
ownership, but **NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS**.
It revokes public database access/schema creation and grants the app owner its
needed connection/schema rights. PostgreSQL 17's `pg_database_owner` public-schema
ownership follows the database owner. Queries, inserts, sequences and Alembic all
use that same non-superuser owner. The bootstrap superuser is available only to
the PostgreSQL container/operator, not the application environment.

This owner role is the simplest initial deployment: the application can also
perform DDL. Future hardening can split migration ownership from a DML-only runtime
role with explicit grants/default privileges. That is not required or implemented
here. Do not give the application superuser rights to resolve a permission error.

The init script runs **only for an empty PostgreSQL volume**. Editing env passwords
does not rotate an existing database role. For an existing migrated/restored DB,
verify ownership and grants explicitly and rotate credentials through PostgreSQL,
then update the master URL and filtered env. Never delete a production volume to
apply an env change. The local stack's superuser-owned volume is not automatically
converted; use the existing documented migration/backup/restore procedures into
a fresh production-owned database.

Startup remains: PostgreSQL health → bounded authenticated DB wait/privilege check
→ `alembic upgrade head` → exec one Uvicorn process. Migration errors stop startup;
FastAPI also requires the exact Alembic heads before serving. Migration output is
visible. Restart and `upgrade head` are idempotent.
The entrypoint also prints `alembic current` after a successful upgrade so the
resulting revision is visible without enabling SQL/parameter logging. Run one
migration owner/process initially; no multi-worker or multi-replica migration race is introduced.

## 5. Build, DNS, Caddy and TLS

```bash
docker compose --env-file .env.production -f compose.production.yml build --pull backend caddy
docker compose --env-file .env.production -f compose.production.yml run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

This validates configuration without starting a public listener or requesting a
certificate. For actual deployment later, create the DNS A record (and AAAA only
when IPv6 is configured/reachable) for `INGRESS_DOMAIN`, point it at the real server,
and allow the ACME HTTP/TLS challenge traffic on 80/443. Initially use direct
DNS-only ingress, without another CDN/proxy layer. Turnstile does not require your
site to be proxied through Cloudflare.

Only after server/domain/credentials are approved and configured:

```bash
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
docker compose --env-file .env.production -f compose.production.yml exec -T backend \
  python -m deployment.healthcheck
curl --fail --silent --show-error https://<app-domain>/api/v1/health
```

The existing health response is liveness: `{"status":"ok"}`. Docker's internal
probe verifies HTTP plus a bounded authenticated DB query and serves as readiness.
It sends an allowed Host header. There is no new public environment/DB diagnostic
endpoint. `ps` must report healthy before the smoke test.

Caddy provides automatic certificates and HTTP→HTTPS redirects. Persist its
`caddy_data` and `caddy_config` volumes; protect certificate/account keys as secrets.
The backend keeps UID/GID10001, read-only application filesystem, dropped
capabilities and owned writable prompt volume/tmp. The official Caddy image keeps
its upstream runtime defaults; it is not a host service or an extra infrastructure
platform. Never solve volume permissions with chmod777.

## 6. Forwarded headers, client IP and host validation

`FEELY_PROXY_IP` is the only address in Uvicorn's `--forwarded-allow-ips`; never
use `*`. Caddy replaces X-Forwarded-For, X-Forwarded-Proto and X-Real-IP using the
actual connection. Client-supplied spoofing headers are not trusted. Uvicorn
sets the request client/scheme only for that trusted connection; application
rate limits continue using `request.client.host`. FastAPI's TrustedHost middleware
checks configured explicit hostnames. The compatibility `TRUST_PROXY_HEADERS`
setting remains false and does not parse arbitrary headers in application code.

Reserve **both** Caddy and backend ingress IPs, so starting the backend before
Caddy cannot consume the proxy's IP. If the default subnet overlaps an existing
network, choose a different unused private subnet and change both addresses.
The database network is internal and PostgreSQL publishes no port.

If adding Cloudflare proxying/a load balancer later, explicitly configure its
trusted address ranges at Caddy and restrict direct bypass traffic before accepting
its client IP headers. Do not enable that trust for the current direct topology.
Absolute auth links use `PUBLIC_APP_URL`, not request Host/forwarding headers.

## 7. OpenAI and provider behavior

All providers/models are selected through backend environment settings. The
template explicitly selects OpenAI for Chat, Topic and Journal; this is necessary
because the legacy Topic default is local. The existing model remains
`gpt-5.4-mini`; operators may select another compatible accessible model through
`OPENAI_MODEL` or per-role overrides without code changes. Verify model/project
permissions before real launch; CI cannot prove account access or billing.

The official asynchronous SDK uses explicit `OPENAI_TIMEOUT_SECONDS` and
`OPENAI_MAX_RETRIES`. Code defaults preserve the SDK's 600-second timeout/two
retries; the production template chooses60seconds per attempt and two retries.
A connection attempt retains the SDK's five-second bound (or the shorter chosen
timeout), rather than inheriting the longer response timeout.
A per-attempt timeout is not an overall deadline; include retry delay/attempts in
latency planning. Do not add another retry loop around these calls. See
[official OpenAI retry guidance](https://developers.openai.com/api/docs/guides/rate-limits#retrying-with-exponential-backoff).

The existing OpenAI adapter uses a completed JSON Chat Completions response, then
one assistant-text callback. It does **not** claim incremental upstream token
streaming. Backend status/text_delta/result/error NDJSON stays unchanged, and
Caddy flushes the stream. Existing Chat cancellation cancels the async request;
each factory-created OpenAI client closes its owned transport on success, error
or cancellation. Offline MockTransport tests cover those cases with no API calls.
Provider failures log only error class/status, not response bodies/prompts; the
existing generic Chat error path remains in use. No key is sent to React/Caddy.

## 8. SMTP, Turnstile and public links

Production SMTP uses the existing `app/integrations/email.py` boundary. Set
`SMTP_HOST`, port, verified `SMTP_FROM_EMAIL`, and provider authentication. Use
exactly one of STARTTLS (`SMTP_USE_TLS=true`, commonly587) or implicit TLS
(`SMTP_USE_SSL=true`, commonly465). Certificate validation and a15-second SMTP
timeout already exist. Both auth fields may be empty only for an intentional TLS
relay. Mailpit/cleartext delivery remains local-only.

Vendor choice stays external configuration:

- [Postmark SMTP](https://postmarkapp.com/developer/user-guide/send-email-with-smtp)
- [Resend SMTP](https://resend.com/docs/send-with-smtp)
- [Amazon SES SMTP](https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html)

Use the chosen provider's verified domain/sender, SPF/DKIM/DMARC guidance and
appropriate SMTP credentials/region. SES SMTP credentials are not a general AWS
access-key replacement. No vendor SDK or hardcoded vendor is introduced. Verify
delivery, spam placement and reset-link origin using the real smoke mailbox.

Create a production Turnstile widget for the exact frontend hostname. The site
key is public and returned by the existing CAPTCHA config endpoint; its secret
stays backend-only. Siteverify checks the existing register action and sends the
resolved client IP. Configure allowed hostnames at Cloudflare; do not allow
localhost on a production widget. Known dummy keys are rejected in production,
while local test doubles/keys remain usable outside it.
The application checks success/action and relies on the widget's hostname
restrictions; it does not maintain a second application hostname allowlist.
Do not use an unrestricted/any-hostname widget for this deployment.
See
[Cloudflare testing/hostname guidance](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
Registration behavior and the CAPTCHA response contract are unchanged.

Set `PUBLIC_APP_URL=https://<real-frontend-domain>` with no path/query/port. Reset
mail keeps its existing `/?reset_password_token=...` URL and React handles it,
scrubs it and keeps the mounted reset form. Activation mail is a six-digit PIN,
not an activation URL, so do not invent link behavior. No newly generated mail
should contain localhost,127.0.0.1,:5500 or:5173.

## 9. React deployment and legacy dependencies

**Recommended initial option A:** Caddy serves the production React build plus
`/api/v1` on one domain. Set `VITE_API_BASE_URL=/api/v1`, and both reference
destinations to `/reference/`. The image includes a read-only copy of the
legacy website at that prefix. Source files remain unchanged; the image's generated
HTML API meta value and API resolver are fixed to the validated public build
setting. Query/storage overrides cannot send its shared JWT to another server.
Its relative assets/views still work.
React's production reference-account link passes the configured absolute API
base, avoiding the legacy HTML's old public API meta default. Same-origin local
storage shares the existing session key; no JWT is put in a URL.

**Option B:** host the same React `dist/` on an external static host with SPA
fallbacks. Build with an absolute HTTPS `VITE_API_BASE_URL`; Caddy's
`INGRESS_DOMAIN` is then the API hostname. Set `PUBLIC_APP_URL` and CORS to the
external frontend origin, and ALLOWED_HOSTS to the API hostname. Serve the unchanged
reference frontend under `/reference/` on the **frontend's origin**, or configure
an explicit HTTPS reference destination and accept a separate login there.
Cross-origin hosting does not share localStorage. The unused bundled React copy
on the API host is harmless; Caddy still serves API requests at `/api/v1`.

For an external static build, copy `frontend-react/.env.production.example` to
`frontend-react/.env.production`, set its public HTTPS destinations, then run
`npm ci` and `npm run build` in that directory. Upload only `dist/`. Never copy
the backend master env into the frontend directory or its hosting provider.

Only documented public VITE settings enter the build. Production builds reject
HTTP/loopback URLs and unknown VITE variables (including keys). The runtime selects
configured/same-origin API values and ignores query/local-storage API overrides;
development retains those comparison conveniences. A VITE change requires rebuilding
the frontend image; changing backend env alone does not rewrite a static bundle.
Bundle inspection still finds React Router's internal `http://localhost` URL-parsing
sentinels. They are not API/network destinations; application build inputs and
runtime API selection do not depend on a development host or port.

| Remaining dependency | Initial production handling |
| --- | --- |
| Billing checkout/portal/cancellation and return parameters | Retain `/reference/` account flow. If enabling Stripe, configure success/cancel/portal URLs to that frontend, including `view=account`, existing `checkout=success` / `checkout=cancelled` handling and `api_base` for the configured API. Test exact return behavior before enabling paid plans. |
| Account deletion | React still opens the retained reference Account screen. Backend DELETE contract is unchanged. |
| Historical `verify_email_token` links | React does not consume them. The reference `js/account.js` still confirms them through the legacy token API. Caddy redirects root/index/chat aliases carrying that parameter into `/reference/`, preserving the query. Separate frontend hosts need the equivalent redirect or users can request a fresh PIN. Do not log tokens. No new token links are issued. |
| Password reset links | React handles root and historical `/index.html`/`chat.html` reset query aliases. Point new mail at PUBLIC_APP_URL. |
| CSS/fonts/images | The build still consumes existing reference CSS/assets; Vite packages the needed assets. Legacy source remains in the repository. |
| Admin/webmail UI | Optional reference pages, not part of the primary React feature set. Leave integrations disabled unless their separate access policy is reviewed. |

A React-only artifact without any reference hosting still lacks billing and
deletion. This phase supplies hosting/configuration compatibility, not new React
features. API query/storage overrides remain available only in the original
development/reference source; the generated production reference copy locks its
destination. Give users generated trusted destinations and plan eventual removal
with full feature parity, not a deployment cleanup.

## 10. Headers, logging and limits

Backend API headers remain no-store, nosniff, DENY framing, same-origin referrer
and existing permissions/CORP policy. Caddy adds safe static-page headers:
nosniff, no-referrer, DENY framing and disabled camera/microphone/geolocation.
There is no aggressive CSP. Evaluate a report-only policy against Google fonts,
Turnstile frames/scripts, API connect sources and the legacy bridge before
enforcement. After HTTPS is proven, add HSTS with a short initial max-age; do not
enable includeSubDomains/preload until every affected hostname is ready.

Uvicorn access logging is disabled and Caddy access logging is not enabled. Do not
turn on URL/query/body/header logging for auth links, bearer tokens or private
Chat/Journal data. OpenAI failures use class/status only, and background analysis
already uses safe metadata. SMTP errors return the existing generic delivery
error. SQLAlchemy hides parameters; production PostgreSQL keeps errors visible
but suppresses SQL statements/parameters and failing-row DETAIL. Never enable
SDK/provider/SQL debug logs with live data. Logs remain private operational data.

```bash
docker compose --env-file .env.production -f compose.production.yml logs --tail=200 backend postgres caddy
```

Review logs privately before sharing; the CI scan is a targeted regression check,
not a guarantee about arbitrary future secret formats or operator debug changes.

Existing rate policies are retained: HTTP/API300/min/IP, auth30/min/IP,
registration20/hour/IP, login8/15minutes/identifier, resend3/hour/address,
activation confirmation10/15minutes/address plus persisted PIN attempt maximum5,
recovery request3/hour/address, reset confirmation auth limit, Chat30/min/user
and existing daily limits. CAPTCHA shares registration/auth limits; its verification
timeout is5seconds. Actual configured values are in the inventory/Settings.
Limits are in-process and reset with a process restart; one worker/container is
intentional. Multiple replicas need a later concurrency/rate-limit review. Existing
long transactions and JSON/quota update races are known, deferred application
concerns; no Redis/Celery/scaling redesign is introduced here.

## 11. Smoke test and first launch

Follow [PRODUCTION_SMOKE_TEST.md](PRODUCTION_SMOKE_TEST.md) with a dedicated
operator-controlled mailbox/account. Do not disable CAPTCHA or send destructive
requests against existing accounts. Record the tested revision, health, mail
origins, feature outcomes and retained IDs before/after restart. Real provider
availability and browser interaction cannot be established by mock CI.

## 12. Backups: a volume is not a backup

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

## 13. Restore and periodic recovery rehearsal

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

Compare current/heads and inspect the ten application tables/counts and known
records before new writes. Restore prompt edits if needed with UID/GID10001
ownership, then start the restored backend, run readiness and the smoke checklist
on an isolated route. Record archive date, duration and verification results; test
at least monthly and after material DB changes. Dispose of rehearsal resources
only after verifying its unique project identity. Never copy a `down -v` command
from CI into the active production procedure.

## 14. Updates and rollback

Record current commit/image identifiers and retain the previous images/secrets.
Review migration scripts and take the appropriate DB/prompt backups first.
Pause writes during migration/cutover when compatibility is uncertain; this
single-host procedure makes no zero-downtime claim.

```bash
git fetch origin
git checkout <tested-release-sha>
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m scripts.production_config prepare --env-file .env.production --replace
.venv/bin/python -m scripts.production_config check --env-file .env.production
docker compose --env-file .env.production -f compose.production.yml build --pull backend caddy
# Complete and verify the backup procedure before replacing the running backend.
docker compose --env-file .env.production -f compose.production.yml stop backend
docker compose --env-file .env.production -f compose.production.yml up -d postgres
# Startup owns upgrade head; failure leaves the backend unready rather than serving old schema.
docker compose --env-file .env.production -f compose.production.yml up -d --force-recreate backend caddy
docker compose --env-file .env.production -f compose.production.yml exec -T backend python -m deployment.healthcheck
```

Then run public health/browser smoke checks. Do not change PostgreSQL major version
as part of an ordinary app update; plan its separate upgrade and restore path.
Bounded dependency ranges/image tags are not a full immutable release lock: retain
the tested image IDs/digests and adopt a reviewed pin/update policy before operational
releases that require exact rebuilds.

For application-only regression, restore the previous tested images/revision **only
if compatible with the current schema and exact Alembic head**. Old code refuses
an unknown newer revision; never bypass that guard with stamping. Do not assume `alembic downgrade` is safe.
For incompatible migration/data damage, stop writes, restore the pre-update archive
into a fresh DB with its matching release/secrets, verify it, then change the runtime
DB URL and recreate the backend. Preserve the failed DB for private investigation.
DB restore can lose writes since the backup; agree the recovery point before cutover.

## 15. Troubleshooting and CI boundaries

- Missing config/placeholder: fix the named master setting and regenerate the
  filtered env. Do not disable production checks to get the server started.
- DB authentication failure after changing env: existing-volume roles/passwords
  were not rotated. Correct/rotate them explicitly; do not reset the volume.
- DDL permission error: verify app ownership/schema/sequence rights, not superuser.
- Host400: configure the actual ingress hostname and first allowed readiness Host.
- All users share one rate bucket: verify direct ingress and trusted proxy IPs;
  do not enable arbitrary forwarded-header trust.
- Bad gateway/stream stalls: verify backend readiness, Caddy upstream and
  flush_interval; inspect safe provider status/class, model access and retry limits.
- Activation/reset delivery: verify TLS/auth/sender and PUBLIC_APP_URL. Never paste
  PINs/reset URLs/provider exceptions into issue logs.
- Broken billing/deletion: verify `/reference/` files/relative assets, configured
  absolute api_base and same-origin session storage. Do not remove the reference tree.

The Docker integration workflow retains the full Mailpit/mock HTTP lifecycle and
adds a separate production job: synthetic config/missing-secret guards, normalized
Compose assertions, actual backend/React/Caddy builds, Caddy config validation,
fresh non-superuser PostgreSQL initialization/Alembic/query/sequence/write probes,
readiness, safe logs and always-cleanup. It does not start a public production
Caddy listener, request certificates, send real email or call paid LLMs. The
development machine still has no Docker daemon; runner results are the runtime
evidence. Server access, DNS/TLS issuance, real provider permissions and final
browser smoke remain external launch gates.

Official references: [Compose extends](https://docs.docker.com/compose/how-tos/multiple-compose-files/extends/),
[Compose replacements](https://docs.docker.com/reference/compose-file/merge/),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy),
[Uvicorn proxy settings](https://www.uvicorn.org/settings/#http).
