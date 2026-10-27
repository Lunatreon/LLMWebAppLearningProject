# Database design review

Reviewed against the application metadata and persistence code on 2026-10-26.
The complete [diagram/column reference](DATABASE_SCHEMA.md) covers 18 application
tables; Alembic adds its version table. Findings below distinguish changes in this
implementation from follow-up work. This is a schema/code review, not a claim of
capacity testing or complete data-protection compliance.

## Changes implemented

- The authoritative map moved from one profile JSON document to relational rows.
  Core content, categories, progress, hierarchy and relationships have explicit
  columns and foreign keys. Unknown legacy attributes are preserved separately.
- Categories use a backend catalog with stable keys, editable descriptions and
  enabled/LLM flags. Foreign keys prevent undeclared category keys.
- Completion is a bounded nullable integer. It is exposed in API/editor workflows.
- Map text is authenticated and encrypted per field, with keys outside PostgreSQL.
- Composite owner references prevent cross-user topic/entry associations. Nullable
  live-source owner/chat pairs preserve history when a source chat is deleted.
- Map revisions reject stale writes; parent cycles are checked before persistence.
- SQLite now enables foreign-key enforcement, which previously differed from PG.
- Generic profile updates preserve the map. Conversation and map memory cannot
  accidentally replace one another through that endpoint.
- Transfer/check tools understand composite primary keys and the seeded catalog.
  The schema generator registers all model modules so mail/terms are included.

## Remaining findings

| Priority | Area | Finding and practical next step |
| --- | --- | --- |
| High | Daily usage | `daily_llm_usage` has no unique constraint on `(user_id,usage_date)`. Add a duplicate audit, that constraint and an atomic reservation/upsert; a schema constraint alone does not resolve concurrent quota updates. |
| High | Sensitive content outside the map | Chat inputs/replies/summaries, ordinary profile memory, feedback, mailbox content and legacy journals remain plaintext in their current columns. Extend encryption deliberately to those surfaces and their backups/logging paths; the map feature does not provide whole-app encryption. |
| Medium | Conversation metadata | `chat_sessions.info` still holds bounded suggestions, review markers and other structured metadata. Messages themselves already use `chat_turns`. Normalize pending suggestions into typed rows if they need independent querying, lifecycle/expiry, ownership or audit history. |
| Medium | JSON shape | Older JSON columns do not enforce an object shape at the database level; legacy JSON null/scalars can reach code that expects dictionaries. Audit those values before adding shape checks or normalizing them. |
| Medium | Profile memory | `user_profiles.data` still contains flexible model memory and recent-message copies. Keep truly flexible preferences there, but inventory duplicated personal text and extract fields that require independent querying or retention rules. |
| Medium | Map read/write cost | Compatibility reconstruction currently loads a user's map and reconciles rows per changed map. The schema has useful indexes, but bounded context queries and targeted row writes would scale better for large maps. Measure before optimizing. |
| Medium | Direct SQL hierarchy writes | The DB rejects missing/self/foreign-owner parents, but a multi-topic cycle is prevented by service validation, not a recursive database constraint. Restrict SQL write access or introduce a tested transaction-safe trigger if direct writers become supported. |
| Medium | Authorization boundary | The app enforces user ownership; no PostgreSQL row-level security policy is configured. The app DB role can access all users' rows. RLS could provide defense in depth, but needs explicit request/session handling and worker tests. |
| Medium | Retention | `mail_messages` stores raw MIME/attachments plus extracted body and trash state without automated retention; feedback and `processed_stripe_events` also need explicit retention decisions. Preserve webhook idempotency for the full replay window. |
| Medium | Legacy journal | `journal_entries` remains for historic data/transfer compatibility although the feature is retired. Define export/retention and a separately reviewed removal migration instead of deleting records during a structural cleanup. |
| Low | Timestamp boundary | Existing `LegacyDateTime` adapters return naive UTC for API compatibility although PostgreSQL uses `timestamptz`. A future API version should consistently emit timezone-aware timestamps; avoid mixing local times. |
| Low | Domain checks | Several older status/role/category/date fields are validated mainly in application code. Consider database checks and native DATE types after auditing legacy values. New map category/progress constraints are already enforced in the DB. |
| Low | Redundant indexes | Some older integer primary keys also have explicit single-column indexes. Review query plans and remove redundant indexes in a separate migration; uniqueness already creates an index. |

## Encryption and recovery boundary

A database-only copy lacks the map keys. A host/application compromise can expose
both keys and decrypted memory. External LLM calls may receive selected plaintext.
Metadata such as topic relationships, categories and completion can also be
sensitive. Keep encrypted off-host backups, separate key recovery, HTTPS and
application authorization. Old plaintext dumps or WAL are not retroactively
protected by changing live map storage.

These findings do not automatically justify more tables for every JSON field.
Use typed rows for authoritative entities and queryable lifecycle state; retain
bounded structured metadata where it makes the application simpler.

## Regenerate the reference

`python -m scripts.database_schema` generates the Markdown ER diagram, column/key
inventory and PostgreSQL DDL reference without opening a database connection.
For a Docker-only host, run the command in the backend image with the repository
mounted at `/workspace`, as shown for other tools in the deployment guide.
The generated SQL is a reference; actual upgrades always use Alembic.
