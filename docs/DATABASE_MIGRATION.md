# PostgreSQL portability and migration foundation

For the subsequent backend/PostgreSQL/Mailpit Compose stack and recovery rehearsal,
see [local deployment](DEPLOYMENT_LOCAL.md). The DB-only setup below remains available.

SQLite remains the default. This phase adds an opt-in synchronous PostgreSQL
path, Alembic schema ownership, isolated database tests and an operator migration
tool. It does not switch the deployed application or copy/delete the existing
`feely.db`. Both frontends and HTTP route/schema definitions remain unchanged.

Read the [pre-implementation portability audit](archive/DATABASE_PORTABILITY_AUDIT.md)
for every column, index, constraint, database caller and transaction workflow.

## Current model and PostgreSQL target

The ten domain tables remain `users`, `user_profiles`, `chat_sessions`,
`daily_llm_usage`, `journal_entries`, `billing_subscriptions`,
`processed_stripe_events`, `feedback`, `terms_acceptances`, `mail_messages`.
Alembic adds its own `alembic_version` bookkeeping table.

Integer primary keys, existing unique/FK constraints, status strings, nullability,
ORM cascades and Python defaults are retained. PostgreSQL enforces declared FK
and VARCHAR limits which SQLite does not currently enforce. Orphans, overlength
text, invalid booleans, malformed JSON/dates and duplicate keys must be resolved
in an audited source backup before migration; the copier never repairs silently.

JSON remains JSON, not JSONB. User capabilities are primarily derived from user,
subscription and environment configuration, not a new capabilities table. The
copier compares all user/subscription/profile columns and nested JSON. Copy the
deployment's unchanged capability settings along with the database configuration.
UUID-like IDs remain strings, including Map entry/topic IDs, chat_id and mail keys.
Journal entry_date is still a YYYY-MM-DD calendar string; usage_date is a UTC day.

SQL timestamps remain DateTime(timezone=True) with Python UTC defaults/onupdate;
PostgreSQL stores timestamptz, and engine connections select UTC. SQLite persisted
timestamps have no offset. `backend/db/types.py:LegacyDateTime` returns PostgreSQL
timestamps as naive UTC, matching SQLite reads and preserving existing HTTP
strings. Existing Terms/billing/expiry code still explicitly applies UTC when
needed. This is a result adapter, not a schema type change. JSON timestamps are
copied verbatim. An operator must explicitly acknowledge naive-source UTC via
`--assume-naive-utc`; historic manual non-UTC writes cannot be inferred safely.

## Driver and configuration

Install the existing requirements plus psycopg 3's binary distribution and Alembic:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Supported DATABASE_URL examples (place real credentials in local environment or
your secret manager, never commit them):

```text
sqlite:///./feely.db
postgresql+psycopg://USER:URL_ENCODED_PASSWORD@127.0.0.1:55432/feely_dev
postgresql://USER:URL_ENCODED_PASSWORD@HOST:5432/feely
```

Bare postgresql:// and postgres:// select psycopg 3; explicit drivers stay explicit.
URL-encode password characters. Alembic reads Settings/DATABASE_URL directly,
without interpolating credentials into alembic.ini. URL connection options are
retained and UTC is enforced. Sessions stay synchronous, autoflush/autocommit
remain disabled, and existing request/service transaction ownership is unchanged.
SQLAlchemy parameter dumps are suppressed to avoid disclosing copied row data.

## Database-only local PostgreSQL

The Compose file runs only PostgreSQL 17, binds localhost, has a health check and
uses a named development volume. A local password must be explicitly configured.

```powershell
$env:FEELY_POSTGRES_PASSWORD = 'choose-a-local-development-password'
docker compose -f compose.db.yml up -d
docker compose -f compose.db.yml ps
$env:DATABASE_URL = 'postgresql+psycopg://feely_dev:URL_ENCODED_PASSWORD@127.0.0.1:55432/feely_dev'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Use the existing SECRET_KEY/security configuration. `docker compose -f
compose.db.yml stop` preserves the volume. Do not use `down -v` for a database you
need to retain. The application itself is not containerized.

Docker was unavailable on the validation workstation. Actual PostgreSQL testing
used the [official Windows binary distribution](https://www.postgresql.org/download/windows/)
in a temporary directory, with a fresh loopback-only test cluster on port 55433.
It used PostgreSQL 17.11, not an emulator. Compose is an equivalent documented
development path; the Compose container itself has not been run on this machine.

## Schema migrations and startup

`migrations/env.py` uses registered Base.metadata and the application's engine
factory. `0001_initial_ten_table_schema.py` is a frozen explicit schema revision
generated from and checked against those models; it does not call create_all or
import mutable model definitions. Python defaults are intentionally not turned
into server defaults; users.role and users.email_verification_attempts retain
their existing server defaults.

```powershell
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m 'Describe the next schema change'
```

Review generated revisions before applying them. PostgreSQL and nonlocal SQLite
startup require the current Alembic head and fail with an actionable error if it
is absent/behind. Startup never upgrades/stamps/creates production tables. Local
SQLite retains its existing create_all and idempotent legacy users-column patch.
Tests normally retain disposable SQLite initialization; PostgreSQL test schemas
are built using Alembic, not create_all.

For a **fresh** SQLite database, Alembic upgrade head also works. For an existing
SQLite database created before Alembic, upgrade head would conflict with existing
tables. Do not blindly stamp: first back up, confirm the actual schema against
the audit/metadata, reconcile legacy differences on the backup, and only then
stamp 0001 if that schema truly matches. The two extra token-hash indexes installed
by the historic local SQLite patch may produce schema-check differences; preserve
the original database and audit that redundancy rather than guessing.

The initial revision's downgrade drops domain tables. It is for disposable schema
tests, not a data-preserving production rollback.

## One-time data migration

1. Rehearse against a backed-up SQLite snapshot and a fresh PostgreSQL database.
   Pause all source writes, in-flight Chat/analysis tasks and mail polling for the
   final cutover. Use SQLite's backup facility, or copy only after all writers are
   stopped and any WAL is checkpointed. Copying just the main file while WAL is
   active can lose committed data. Keep the original and backup unchanged.
2. Create a fresh destination and apply Alembic head. Use the intended non-superuser
   application role for integration checks. Carry forward SECRET_KEY, Terms
   version/URL/hash, subscription/capability switches and existing provider settings.
   Changing SECRET_KEY would invalidate existing JWT/reset/verification behavior.
3. Audit the source before inserting. The script opens the source using SQLite
   URI **mode=ro**, starts one explicit read snapshot, validates all ten tables and
   exact columns, all primary/unique/FK values, types, timestamps and Map structure.
   Extra/missing tables or columns block migration; upgrade an audited backup,
   never mutate the original through the copier.
4. Copy into an empty target. Tables are locked against concurrent writes; rows
   are inserted in dependency order, explicitly preserving IDs and SQL NULLs.
   Only SQL booleans and SQL naive timestamps need representation conversion.
   JSON null remains JSON null, JSON structures/strings and raw mail bytes remain
   intact. Every serial sequence is advanced past its preserved maximum ID.
5. Compare all destination IDs/columns and row counts **before commit**. Any mismatch
   rolls back every inserted row. A second independent read verifies committed
   data; run the standalone verifier again before opening the application.

```powershell
$env:DATABASE_URL = 'postgresql+psycopg://USER:URL_ENCODED_PASSWORD@HOST:5432/FRESH_TARGET'
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.database_migration check-source --source 'C:\backups\feely-snapshot.db' --assume-naive-utc
.\.venv\Scripts\python.exe -m scripts.database_migration copy --source 'C:\backups\feely-snapshot.db' --assume-naive-utc
.\.venv\Scripts\python.exe -m scripts.database_migration verify --source 'C:\backups\feely-snapshot.db' --assume-naive-utc
```

Use `--target-url-env NAME` to read another environment variable; credentials are
not passed on the command line or printed. Reports contain per-table source and
destination counts, not private row contents. check-source changes neither DB.
copy refuses nonempty targets; repeating the procedure requires another fresh
target. verify never writes. PostgreSQL sequence setval is not transactional;
failed copies may advance empty-target sequences, and a retry resets them again.

The verifier compares complete nested JSON, so missing capabilities, Map entities,
relationships, practice reflections, Journal suggestions or Chat messages fail.
It also validates parent/related-topic references, duplicate topic/entry IDs and
hierarchy cycles. Provenance references to deleted chats, merged topics or old
Journal entries are intentionally not promoted into new FKs. Terms URL/version/
hash/client, all SQL timestamps/nulls/identifiers and raw mail bytes are compared.
Capability derivation also depends on unchanged environment settings; byte-for-byte
database equality alone cannot prove the deployment used the right configuration.

## Rollback and remaining deployment decisions

Keep the source SQLite snapshot and its original configuration. Before PostgreSQL
accepts new writes, rollback means stop the PostgreSQL application, restore the
SQLite DATABASE_URL and start the original-compatible backend. Leave PostgreSQL
intact for diagnosis. After new PostgreSQL writes, reverting blindly would lose
those writes: stop writers, reconcile/export changed data, validate a deliberate
reverse migration, and decide how queued email/Stripe events are replayed. There
is no automatic reverse converter in this phase.

Remaining cutover gates are an actual source-data audit, production backup/restore
and role/permission rehearsal, TLS/connection configuration, credential rotation
policy, sizing, and a final paused-write rehearsal. Unicode LOWER/collation may
differ by locale; public registration already limits usernames to ASCII, but
imported/admin identities deserve review. SQLite quota orphans must be addressed
explicitly before PostgreSQL FK enforcement. No production database was switched.

Existing Chat generation/analysis, Journal analysis, billing and SMTP workflows
can keep transactions/connections open during external waits. Quota reservation
and JSON replacement have existing read-modify-write races. READ COMMITTED does
not fix them. No transaction relocation, row locking, retries, async database
conversion or repository framework was introduced. These risks require separate
concurrency/load work before calling the application production-ready on PostgreSQL.
The migration snapshot currently holds all rows in memory; benchmark large backups
before a real cutover and extend to chunked verification if required.

## Testing and contract checks

Default full suite uses disposable SQLite; PostgreSQL mode requires an explicitly
named database ending in `_test`. Every selected database fixture uses a random
private schema, applies Alembic head and drops only that schema after the test.
The dedicated legacy SQLite ALTER TABLE test remains SQLite even during a PG run.

```powershell
Remove-Item Env:FEELY_TEST_POSTGRES_URL -ErrorAction SilentlyContinue
.\.venv\Scripts\python.exe -m pytest -q
```

Create a separate `feely_test` DB in the local instance (not feely_dev/production),
grant its test owner schema creation rights, then:

```powershell
$env:FEELY_TEST_POSTGRES_URL = 'postgresql+psycopg://TEST_USER:URL_ENCODED_PASSWORD@127.0.0.1:55432/feely_test'
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m black --check backend tests migrations scripts/database_migration.py scripts/run_postgres_contract.py
.\.venv\Scripts\python.exe -m compileall -q app tests migrations scripts/database_migration.py scripts/run_postgres_contract.py
node --test --test-concurrency=1 tests/*.test.cjs
```

The deterministic HTTP comparison executes activation, registration/login/reset,
Terms, account, Map, Reflection, Chat NDJSON/history, fake Stripe webhook
deduplication and durable webmail against SQLite and the selected database. Only
JWT contents and scheduler-dependent stream status heartbeats are excluded from
transcript equality; timestamps, data and stream results are compared exactly.
The existing detailed tests still check errors, loading/persistence/gating and
mail acknowledgement ordering. Migration tests also inject invalid SQLite data,
lost rows/content, failed verification, nonempty destinations and test sequences.

The existing React contract fixture is unchanged. To test its Chat workflow on PG:

```powershell
# Terminal 1, repository root; Ctrl+C closes server and drops only its test schema.
.\.venv\Scripts\python.exe -m scripts.run_postgres_contract --chat
# Terminal 2, frontend-react:
node scripts/validate-chat-contract.mjs
```

The wrapper substitutes only fixture engine creation/create_all with an isolated
PostgreSQL schema/Alembic. Other existing modes include --activation, --recovery,
--password-change, --map and --reflection with their existing ports.
Run the wrapper without a mode and with --verified in two terminals for the
registration contract's two fixtures. Use --login-fixture for the existing
isolated-auth-server.py and validate-login-contract.mjs on port 18006.
Without the wrapper the same fixture remains disposable SQLite. No real Stripe,
SMTP or paid LLM providers are used by these contract checks.

## Validation results — 2026-10-13

| Check | Result |
| --- | --- |
| Complete default SQLite suite | 208 passed, 5 skipped: four new PG-only migration tests and the existing opt-in live test. All 182 original non-live tests pass. |
| Complete PostgreSQL suite | 212 passed, 1 existing opt-in live test skipped; also repeated successfully using a non-superuser database owner. |
| Real HTTP live-server test | 1 passed separately on SQLite and 1 on PostgreSQL. |
| Actual FastAPI startup | Passed on disposable SQLite and migrated PostgreSQL; lifespan startup/shutdown also passed under the non-superuser PG owner. |
| Empty database Alembic upgrade | Passed on two fresh PostgreSQL databases (bootstrap role and non-superuser owner); metadata comparison / alembic check clean. Initial revision also tested on fresh SQLite. |
| PostgreSQL offline initial DDL | Ten domain CREATE TABLE statements plus Alembic version table. |
| Critical HTTP transcript equality | Passed for SQLite vs PostgreSQL, including exact legacy timestamp strings and saved stream results. |
| Existing React/backend contracts | All nine scripts passed against PG: registration (both verification modes), login, activation, recovery, password change, Journal, Map, Reflection and Chat. Includes Account, Feedback, Terms and persistence/gating. |
| Legacy JS suite | 49 passed. |
| Migration safety tests | Invalid source data and changed/lost rows/content detected; two fresh-target copies verified all ten tables, 11 synthetic rows, IDs, nulls, timestamps, binary mail and sequences; verification failure rolls back inserts; JSON null preserved; nonempty copy refused. |
| Operator CLI rehearsal | check-source, copy and standalone verify all passed for an 11-row synthetic snapshot into the fresh non-superuser-owned PG database; source file hash remained unchanged. |
| Black / compile / imports | Black check: 101 files; compile checks passed; all 76 app Python modules including the root package import. |
| Contracts/schema/reference preservation | Full OpenAPI equal to saved baseline; all 70 API registrations / 61 paths retained; ten-table column/index/constraint/default signatures match. feely.db, both frontend trees and prompts have identical baseline hashes. |

No production data was migrated. Compose was provided but not executed because
Docker is absent here. Actual DB validation used PostgreSQL 17.11 and psycopg 3.3.6,
with SQLAlchemy 2.0.50 and Alembic 1.20.0. The only remaining test warning is the
pre-existing Starlette/httpx deprecation. New parity-test clocks explicitly account
for SQLAlchemy's cached default callables to avoid test-order-dependent snapshots.
