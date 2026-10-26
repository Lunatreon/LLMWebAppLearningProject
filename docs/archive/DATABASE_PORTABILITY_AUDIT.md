# Database portability audit — Backend Phase 2A

This audit records the working-tree baseline before Phase 2 implementation. The
application uses synchronous SQLAlchemy 2 sessions and ten tables. No model,
route, authentication, LLM or email redesign is proposed.

## Database interaction inventory

`backend/db/session.py` constructs a global engine and a synchronous sessionmaker
(`autocommit=False`, `autoflush=False`, default expire-on-commit). The request
dependency in `backend/api/dependencies.py` opens and closes one session; SQLAlchemy
autobegins on database access. Close rolls back any uncommitted work. Authentication,
Terms and capability reads share the dependency session with route writes.

Database callers are `backend/api/dependencies.py`, routes `admin.py`, `auth.py`,
`billing.py`, `feedback.py`, `journal.py`, `llm.py`, `terms.py`, `users.py`,
`webmail.py`, and services `billing.py`, `chat_usage.py`, `terms.py`, `webmail.py`.
LLM tasks/providers and the Map domain service do not own database connections;
Map/Reflection data is persisted by routes through `UserProfile.data`.

All application `Session.execute`/`scalar`/`scalars` calls use SQLAlchemy select
or update expressions. There are no application direct sqlite3 APIs, sqlite_master
queries, PRAGMAs, rowid references, INSERT OR statements, dialect-specific UPSERTs,
LIKE/ILIKE/collation predicates, or connection.execute calls. The sole raw SQL is
`backend/db/init_db.py`: guarded SQLite ALTER TABLE ADD COLUMN and two CREATE UNIQUE
INDEX IF NOT EXISTS statements. Introspection currently calls the SQLite dialect's
get_columns. `main.py` calls init_db at startup, which currently calls create_all
for every dialect. Tests and disposable frontend fixtures create SQLite engines;
the legacy role-column migration test intentionally exercises SQLite SQL.

## Portability classification

| Concern | Classification | Decision |
| --- | --- | --- |
| Synchronous ORM queries, joins, updates, rowcount, sessions | PORTABLE AS-IS | Keep implementation and transaction ownership. |
| DATABASE_URL default and sqlite check_same_thread | REQUIRES SMALL CHANGE | Parse URL; keep thread argument SQLite-only; select psycopg 3 for bare PostgreSQL URLs. |
| SQLite introspection / ALTER TABLE compatibility patch | PORTABLE AS-IS | Retain dialect guard and local behavior; never run on PostgreSQL. |
| Unconditional startup create_all | REQUIRES SMALL CHANGE | PostgreSQL and nonlocal startup require Alembic head; local SQLite remains compatible. |
| Integer primary keys | REQUIRES MIGRATION DESIGN | Preserve explicit IDs; reset PostgreSQL sequences after copying. SQLite IDs can reuse highest deleted IDs; PostgreSQL sequences do not. |
| Boolean 0/1 representation | REQUIRES MIGRATION DESIGN | SQLAlchemy Boolean maps correctly; reject source values other than 0/1/null before conversion. |
| DateTime(timezone=True), SQLite naive reads | REQUIRES MIGRATION DESIGN | SQLite strips offsets; existing Python defaults use UTC. Interpret naive SQL timestamps as UTC on copy, retain timestamptz and force PostgreSQL connection timezone UTC. No model type changes. |
| HTTP timestamp strings | REQUIRES SMALL CHANGE | Baseline probe later confirmed SQLite emits no offset while PostgreSQL adds Z; the implemented result adapter preserves the SQLite response format without changing SQL types. |
| Journal entry_date / usage_date | PORTABLE AS-IS | Keep String(10) and exact YYYY-MM-DD; Journal is a user calendar date, quota day is UTC. |
| JSON columns | PORTABLE AS-IS | Keep SQLAlchemy JSON (SQLite encoded text / PostgreSQL JSON), not JSONB. No SQL JSON operators are used. Preserve null and nested data. |
| UUIDs | PORTABLE AS-IS | Map/suggestion UUID hex values are nested JSON strings; chat_id and mail delivery keys remain strings. No native UUID conversion. |
| String lengths / NUL / JSON numeric values | REQUIRES MIGRATION DESIGN | SQLite permits overlength strings; PostgreSQL rejects lengths and NUL in text. Validate rather than truncate or alter data. Preserve JSON object/array contents. |
| Foreign keys | REQUIRES MIGRATION DESIGN | SQLite foreign-key enforcement is not enabled; PostgreSQL enforces existing metadata. Reject orphan rows before copying. Do not change SQLite PRAGMA behavior. |
| Unique nullable columns | PORTABLE AS-IS | Both allow multiple NULLs; preserve case-sensitive unique keys and application normalization. |
| Case matching | REQUIRES MIGRATION DESIGN | Email stored lowercase; username lookups use func.lower; topic matching uses Python casefold. PostgreSQL/SQLite Unicode lower and locale can differ. Flag Unicode identity collisions; do not add CITEXT/functional indexes in this phase. |
| Constraints/defaults/cascades | PORTABLE AS-IS | Freeze existing metadata in initial revision; no new enums, checks or server defaults. |
| Concurrent JSON replacement / quota read-modify-write | REQUIRES MIGRATION DESIGN | Existing races, not solved by switching databases. Load/concurrency hardening deferred and documented. |

## Timestamp and identifier details

Every SQL timestamp column is DateTime(timezone=True). Python supplies aware UTC
defaults (including mail's lambda); updated_at has Python onupdate, not SQL triggers.
Only users.role and users.email_verification_attempts have server defaults.
Verification/reset expiration already treats naive datetimes as UTC; billing and
Terms have similar normalization. Journal analysis, Map/Reflection and Chat message
timestamps inside JSON are ISO strings and must be copied verbatim. There is no SQL
DATE column, native UUID, SQL ENUM, JSONB or database-generated timestamp.

## Transaction ownership and external waits

| Workflow | Ownership / commits / rollback | Atomicity and external waits |
| --- | --- | --- |
| Registration | Request session; user/profile and optional Terms commit once; IntegrityError rollback | Account aggregate atomic; activation email after commit/refresh can leave a read transaction open. |
| Login | Request session commits last_login_at | Password verification happens after lookup; no external DB call. |
| Activation request | Token/PIN fields changed, email sent, then commit | SMTP while read transaction open; send failure closes/rolls back. Preserve ordering. |
| Activation confirm | PIN attempt conditional UPDATE + commit; verification conditional UPDATE + commit | Failure count durable; verification remains single-use; explicit rollback on unsuccessful update. |
| Reset request | Token fields changed, SMTP sent, then commit | SMTP inside open transaction; close rollback on send failure. |
| Reset confirm | Conditional UPDATE consumes hash and changes password, commit; rollback on zero rowcount | Password and token consumption atomic. |
| Terms | Request session; insert commit; unique-conflict rollback and reread | Idempotent by user/version; existing immutable URL/hash check retained. |
| Account/admin | Route commits account/password edits or ORM aggregate delete; conflicts rollback | ORM cascades delete profile/chats/billing/Journal/feedback/Terms; daily usage relies on ondelete CASCADE (SQLite currently not enforced). |
| Journal save | Route commit then refresh | One row atomic. Analysis waits on LLM inside read transaction, then commits analysis. |
| Journal suggestion | Route replaces analysis and profile JSON, commit | Accepted Journal suggestion and Map write atomic. No new transaction layer. |
| Map/Reflection | Route replaces profile JSON, commit/refresh | Each mutation atomic; concurrent writes may replace stale JSON. |
| Chat quota/generation | Quota service commits reservation before generation; route flushes new profile/chat, awaits LLM, refreshes current data, commits exchange/profile together | Generation transaction can hold connection/locks across LLM wait. Error rollback then separate quota release commit. Streaming releases authentication transaction but its generation session is still long-lived. |
| Chat background analysis | Own sessionmaker bound to request DB; multiple staged commits; rollback/error-status commit; finally close | Provider awaits with open read transactions; refresh/merge protects concurrent Map edits, not every possible concurrent write. |
| Billing | Service owns commits; webhook updates subscription and unique event in one commit; rollback/reread for duplicate events | Stripe retrieve/update/cancel can occur inside open transaction, sometimes after flush. No real Stripe calls in DB validation. |
| Incoming mail | Poller own session; insert commit; duplicate rollback/reread | Cloudflare acknowledgement only after durable commit and session close. |
| Outgoing mail | Route persists pending copy commit, SMTP, sent/uncertain commit | Durable staged state; reading expired ORM fields may autobegin during SMTP. Preserve uncertain-delivery behavior. |
| Feedback | Route commit then optional background notification | Notification outside write transaction; read may autobegin after commit. |

Long-lived read/write transactions and races are operational risks under PostgreSQL
READ COMMITTED. Do not relocate commits or introduce locks/repositories here.
Production connection capacity and statement/idle-in-transaction timeouts must be
chosen with provider durations in mind; a short idle timeout can kill generation.

## Internally consistent implementation target

Keep backend/api, services and models in place. Add a small database URL/engine factory
to backend/db/session.py, explicit migration verification to init_db.py, and Alembic
environment/revision under migrations/. Add a DB-only compose.db.yml. PostgreSQL
tests use disposable isolated schemas, Alembic upgrade and the unchanged route
assertions. A separate operator script copies a read-only SQLite snapshot into an
empty, migrated PostgreSQL target in one transaction and verifies complete typed
rows, constraints, nested JSON and sequences. No application repositories or
automatic data conversion at startup.

The exact baseline table/column/index/constraint inventory follows. `nullable`
describes all fields, defaults are Python unless labelled server, and all primary
keys are integer id. ORM cascades are listed above; DB ondelete is recorded per FK.

## mail_messages

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| delivery_key | VARCHAR(100) | False | - | - |
| folder | VARCHAR(20) | False | - | - |
| sender | TEXT | False | - | - |
| recipient | TEXT | False | - | - |
| subject | TEXT | False | - | - |
| body | TEXT | False | - | - |
| raw | BLOB | False | - | - |
| is_read | BOOLEAN | False | - | False |
| created_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_mail_messages_folder (folder), unique=False.

Constraints: UniqueConstraint (unnamed) (delivery_key); PrimaryKeyConstraint (unnamed) (id).

## processed_stripe_events

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| stripe_event_id | VARCHAR(255) | False | - | - |
| event_type | VARCHAR(120) | False | - | - |
| processed_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_processed_stripe_events_id (id), unique=False; ix_processed_stripe_events_stripe_event_id (stripe_event_id), unique=True.

Constraints: PrimaryKeyConstraint (unnamed) (id).

## users

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| email | VARCHAR(320) | False | - | - |
| username | VARCHAR(80) | False | - | - |
| hashed_password | VARCHAR(255) | False | - | - |
| display_name | VARCHAR(120) | True | - | - |
| bio | VARCHAR(500) | True | - | - |
| avatar_url | VARCHAR(500) | True | - | - |
| auth_provider | VARCHAR(40) | False | - | password |
| is_email_verified | BOOLEAN | False | - | False |
| email_verified_at | DATETIME | True | - | - |
| email_verification_token_hash | VARCHAR(128) | True | - | - |
| email_verification_sent_at | DATETIME | True | - | - |
| email_verification_attempts | INTEGER | False | - | 0; server: 0 |
| password_reset_token_hash | VARCHAR(128) | True | - | - |
| password_reset_sent_at | DATETIME | True | - | - |
| last_login_at | DATETIME | True | - | - |
| is_active | BOOLEAN | False | - | True |
| role | VARCHAR(16) | False | - | member; server: member |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_users_email (email), unique=True; ix_users_id (id), unique=False; ix_users_username (username), unique=True.

Constraints: UniqueConstraint (unnamed) (email_verification_token_hash); UniqueConstraint (unnamed) (password_reset_token_hash); PrimaryKeyConstraint (unnamed) (id).

## billing_subscriptions

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:CASCADE | - |
| stripe_customer_id | VARCHAR(255) | True | - | - |
| stripe_subscription_id | VARCHAR(255) | True | - | - |
| stripe_price_id | VARCHAR(255) | True | - | - |
| status | VARCHAR(40) | False | - | none |
| cancel_at_period_end | BOOLEAN | False | - | False |
| current_period_end | DATETIME | True | - | - |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_billing_subscriptions_id (id), unique=False; ix_billing_subscriptions_stripe_customer_id (stripe_customer_id), unique=True; ix_billing_subscriptions_stripe_subscription_id (stripe_subscription_id), unique=True; ix_billing_subscriptions_user_id (user_id), unique=True.

Constraints: PrimaryKeyConstraint (unnamed) (id); ForeignKeyConstraint (unnamed) (user_id).

## chat_sessions

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:None | - |
| chat_id | VARCHAR(120) | False | - | - |
| info | JSON | False | - | Python dict() |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_chat_sessions_chat_id (chat_id), unique=False; ix_chat_sessions_id (id), unique=False.

Constraints: ForeignKeyConstraint (unnamed) (user_id); UniqueConstraint uq_chat_sessions_user_chat (user_id, chat_id); PrimaryKeyConstraint (unnamed) (id).

## daily_llm_usage

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:CASCADE | - |
| usage_date | VARCHAR(10) | False | - | - |
| message_count | INTEGER | False | - | 0 |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_daily_llm_usage_id (id), unique=False; ix_daily_llm_usage_usage_date (usage_date), unique=False; ix_daily_llm_usage_user_id (user_id), unique=False.

Constraints: PrimaryKeyConstraint (unnamed) (id); ForeignKeyConstraint (unnamed) (user_id); UniqueConstraint uq_daily_llm_usage_user_date (user_id, usage_date).

## feedback

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:CASCADE | - |
| category | VARCHAR(24) | False | - | - |
| message | TEXT | False | - | - |
| created_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_feedback_user_id (user_id), unique=False.

Constraints: ForeignKeyConstraint (unnamed) (user_id); PrimaryKeyConstraint (unnamed) (id).

## journal_entries

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:CASCADE | - |
| entry_date | VARCHAR(10) | False | - | - |
| content | TEXT | False | - | - |
| analysis | JSON | False | - | Python dict() |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_journal_entries_entry_date (entry_date), unique=False; ix_journal_entries_id (id), unique=False; ix_journal_entries_user_id (user_id), unique=False.

Constraints: UniqueConstraint uq_journal_entries_user_date (user_id, entry_date); PrimaryKeyConstraint (unnamed) (id); ForeignKeyConstraint (unnamed) (user_id).

## terms_acceptances

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:CASCADE | - |
| version | VARCHAR(80) | False | - | - |
| document_url | VARCHAR(2048) | False | - | - |
| document_sha256 | VARCHAR(64) | False | - | - |
| accepted_at | DATETIME | False | - | Python UTC datetime |
| client | VARCHAR(16) | False | - | - |

Indexes: ix_terms_acceptances_user_id (user_id), unique=False.

Constraints: UniqueConstraint uq_terms_user_version (user_id, version); ForeignKeyConstraint (unnamed) (user_id); PrimaryKeyConstraint (unnamed) (id).

## user_profiles

| Column | Type | Nullable | PK / FK | Default |
| --- | --- | --- | --- | --- |
| id | INTEGER | False | PK | - |
| user_id | INTEGER | False | users.id:None | - |
| data | JSON | False | - | Python dict() |
| created_at | DATETIME | False | - | Python UTC datetime |
| updated_at | DATETIME | False | - | Python UTC datetime |

Indexes: ix_user_profiles_id (id), unique=False.

Constraints: ForeignKeyConstraint (unnamed) (user_id); UniqueConstraint (unnamed) (user_id); PrimaryKeyConstraint (unnamed) (id).
