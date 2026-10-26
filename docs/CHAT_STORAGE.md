# Conversation storage and pagination

Each conversation is one `chat_sessions` row. Title, title source, exchange count,
analysis status, analysis count/error, summary and summary count are real columns,
alongside the existing owner, public chat ID and creation/update timestamps.
The `info` JSON column now holds only structured suggestion metadata; it does
not contain message history or copies of those scalar columns.

Each exchange is one `chat_turns` row:

| Column | Purpose |
| --- | --- |
| id | Internal exchange ID, also used for reactions |
| chat_session_id | Foreign key to the owning conversation |
| position | Unique, increasing position within that conversation |
| user_input | User's text |
| llm_response | Assistant's text; nullable until completed |
| status | pending, completed, failed, or legacy |
| created_at / responded_at | UTC timestamps |
| reaction | like, dislike, or null |
| user_timestamp / response_timestamp | Preserve original API timestamp spelling |
| user_metadata / response_metadata | Small optional per-message fields |

User inputs are committed before the model call, without holding a write
transaction open during generation. A failed or canceled request becomes a failed
turn with no response, and its reserved daily quota is released. Such turns are
retained in the database but excluded from the completed conversation shown in
the chat UI. A process crash can leave a pending turn; it is not represented as a
completed response. A retry creates a separate exchange, never an automatic replay.

New replies are retained without the former 80-message storage limit. Model input
and background analysis still use bounded recent context and a summary. Increasing
stored history does not cause the entire conversation to be sent to the model.

## API and frontend

- `GET /api/v1/llm/chats?paginated=true&limit=30&cursor=...` returns conversation
  metadata, `items` and `next_cursor`, without loading message bodies. The original
  list response is retained when paginated is omitted, but is also bounded.
- `GET /api/v1/llm/chats/{chat_id}` returns the latest 25 exchanges. Its
  `next_before_position` cursor fetches earlier history with `before_position`.
  `limit` is measured in exchanges and is capped at 100.
- The sidebar offers Load more conversations; the chat offers Load older messages
  while preserving reading position. All queries verify conversation ownership.
- Messages include turn_id and position; reaction requests can address turn_id,
  retaining the original timestamp-based API for older clients.

The database indexes support owner/update ordering and conversation/position
lookup. Adding a reply inserts/updates one exchange rather than rewriting history.

## Upgrade an existing installation

Stop the backend before the migration. Retain a verified backup. No live local or
production database is modified merely by installing these code changes.

For PostgreSQL, or SQLite already managed by Alembic:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

For a native SQLite database created by the old create_all startup path:

```powershell
.\.venv\Scripts\python.exe -m scripts.migrate_chat_storage
```

On macOS/Linux use `.venv/bin/python`. The legacy SQLite helper now upgrades chat and map storage together. Configure
the content-encryption key ring before running it. It reads DATABASE_URL from
the root .env, creates a private SQLite backup next to the source file and reserves
an exclusive writer lock for conversion. It preserves an unversioned database's
status instead of guessing/stamping an initial Alembic revision. If the database
is already versioned it runs its normal Alembic upgrade after backing it up.

Revision 0002 extracts existing metadata and pairs adjacent user/assistant messages.
It preserves unmatched legacy messages and extra fields, verifies converted
message contents, and only then clears history from the session JSON. Migration
errors stop the upgrade. Automatic downgrade is deliberately refused because it
could discard unlimited history or unfinished inputs; use a matching backup for
rollback. Messages already discarded by the old 80-message limit are not recoverable.

The cross-database copy tool expects this current schema. Upgrade and verify an
isolated SQLite copy first, then use the existing PostgreSQL transfer procedure.
