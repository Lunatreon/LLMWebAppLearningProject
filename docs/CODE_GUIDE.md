# FeelY Backend Code Guide

This document explains how the backend is organized, how a request moves through
the code, and how to expand the project with new API functions.

## Big Picture

The backend is a FastAPI application. It exposes HTTP endpoints for a website or
mobile app, stores users and profiles in a database, and sends authenticated
user messages to an LLM together with that user's saved profile.

The main flow is:

1. A user registers or logs in.
2. The app receives a JWT access token.
3. The app sends the token with requests that need authentication.
4. The backend loads the current user from the token.
5. For LLM requests, the backend loads the user's profile.
6. The backend sends the new user message and profile to the configured LLM.
7. The LLM returns an assistant message and an updated profile.
8. The backend saves the updated profile and returns the response.

## Project Structure

```text
app/
  main.py                  FastAPI app creation and startup
  api/
    router.py              Collects all API route modules
    dependencies.py        Shared FastAPI dependencies like DB and current user
    routes/
      auth.py              Register and login endpoints
      billing.py           Stripe Checkout, Portal, subscription, and webhook endpoints
      users.py             Current user and profile endpoints
      llm.py               Authenticated LLM message endpoint
      health.py            Health check endpoint
  core/
    config.py              Environment-based settings
    security.py            Password hashing and JWT helpers
  db/
    base.py                SQLAlchemy declarative base
    session.py             Database engine and session factory
    init_db.py             Creates database tables
  models/
    billing.py             Local Stripe subscription and processed-event models
    user.py                SQLAlchemy User and UserProfile database models
  schemas/
    auth.py                Request/response schemas for auth
    user.py                Request/response schemas for users
    profile.py             Request/response schemas for profiles
    llm.py                 Request/response schemas for LLM messages
    billing.py             Billing request/response schemas
  services/
    billing.py             Stripe calls and normalized subscription policy
    conversation_summary.py Pure extractive summaries and chat metadata updates
    chat_usage.py          Persistent daily message quotas
    map_suggestions.py     Suggestion deduplication and cooldown policy
    topic_matching.py      Conservative reuse of existing topics
    prompts.py             Editable system-prompt loading and saving
    llm/
      types.py             Provider contracts and result types
      context.py           Bounded chat, topic, and journal request payloads
      responses.py         Structured response schemas and validation
      streaming.py         Partial JSON assistant-text decoding
      json_response.py     Complete JSON decoding and upstream errors
      providers/
        factory.py         Provider selection and credential checks
        openai.py          OpenAI SDK integration
        anthropic.py       Anthropic SDK integration
        ollama.py          Ollama HTTP calls, scheduling, and retries
        local.py           Deterministic development responses
      tasks/
        journal.py         Journal analysis orchestration
tests/
  conftest.py              Test app and temporary test database setup
  test_auth_and_llm.py     Basic register, login, and LLM flow test
```

## App Startup

The entry point is `app/main.py`.

`create_app()` builds the FastAPI app, adds CORS middleware, and mounts all API
routes under the API prefix from settings. By default the prefix is:

```text
/api/v1
```

The global `app` variable at the bottom of `app/main.py` is what Uvicorn loads:

```bash
uvicorn app.main:app --reload
```

During app startup, `init_db()` creates database tables if they do not already
exist. This is convenient for early development. For production projects, add a
migration tool such as Alembic before making database changes in deployed
systems.

## Configuration

Configuration lives in `app/core/config.py`.

Settings are loaded from environment variables and `.env`:

```env
APP_NAME="FeelY Backend"
SECRET_KEY="change-this-secret-before-deploying"
DATABASE_URL="sqlite:///./feely.db"
LLM_PROVIDER="mock"
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5.4-mini"
ANTHROPIC_API_KEY=""
ANTHROPIC_MODEL="claude-sonnet-4-6"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3.5:4b"
```

Use `.env.example` as the template for local setup.

Important settings:

- `SECRET_KEY`: used to sign JWT access tokens. Change this before deployment.
- `DATABASE_URL`: database connection string. SQLite is used by default.
- `CORS_ORIGINS`: websites/apps allowed to call the API from browsers.
- `LLM_PROVIDER`: `mock`, `openai`, `anthropic`, or `ollama`.
- `CHAT_LLM_PROVIDER` and `TOPIC_LLM_PROVIDER`: optional role-specific overrides.
- `OPENAI_API_KEY`: required when `LLM_PROVIDER` is `openai`.
- `ANTHROPIC_API_KEY`: required when a role uses the `anthropic` provider.
- `OLLAMA_BASE_URL`: local Ollama service URL; no API key is required.
- `OLLAMA_MODEL`: fallback model for both Ollama roles.

## Database Layer

The database connection is configured in `app/db/session.py`.

```python
engine = create_engine(settings.database_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
```

Every request that needs database access receives a SQLAlchemy session through
the `get_db()` dependency in `app/api/dependencies.py`.

Database models live in `app/models/`.

Current models:

- `User`: login identity, password hash, status, timestamps.
- `UserProfile`: one JSON profile per user.
- `ChatSession`: persisted conversations and their analysis state.
- `BillingSubscription`: the local Stripe subscription snapshot used for access decisions.
- `ProcessedStripeEvent`: webhook IDs already applied, used to make delivery idempotent.

The `UserProfile.data` column is JSON so the LLM can evolve the profile shape
over time without requiring a database migration for every new profile field.

## Authentication

Authentication code is split into route logic and security helpers.

`app/api/routes/auth.py` owns the HTTP endpoints:

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`

`app/core/security.py` owns:

- password hashing
- password verification
- JWT creation
- JWT decoding

Protected endpoints use:

```python
current_user: User = Depends(get_current_user)
```

`get_current_user()` reads the bearer token, validates it, extracts the user ID,
loads the user from the database, and rejects inactive or missing users.

The app or website must send authenticated requests with this header:

```http
Authorization: Bearer <access_token>
```

## Billing Flow

Billing routes live in `app/api/routes/billing.py`; Stripe-specific behavior lives
in `app/services/billing.py`. The frontend never receives a Stripe secret key.

- Checkout and Customer Portal sessions are created by authenticated POST requests.
- Portal return URLs are restricted to configured/trusted frontend origins.
- Signed Stripe webhooks update the local subscription snapshot.
- Premium access is decided by `has_premium_access()` using that local snapshot.
- A scheduled end-of-period cancellation can be reversed with
  `POST /api/v1/billing/subscription/resume`.

See `docs/stripe-setup.md` for configuration and testing details.

## LLM Flow

The LLM endpoint lives in `app/api/routes/llm.py`.

Endpoint:

```text
POST /api/v1/llm/message
```

Request body:

```json
{
  "message": "I had a stressful day but finished my project."
}
```

What the endpoint does:

1. Requires a logged-in user.
2. Loads or creates that user's profile.
3. Calls `get_chat_llm_client().respond(...)`.
4. Passes both `user_input` and the current `profile`.
5. Receives an assistant message and the complete updated profile.
6. Saves the updated profile to the database.
7. Returns both values to the client.

Response body:

```json
{
  "assistant_message": "Assistant response here",
  "profile": {
    "message_count": 1,
    "last_user_message": "I had a stressful day but finished my project."
  }
}
```

## LLM Service Design

The LLM package lives in `app/llm/`. Provider implementations depend on
shared contracts, context builders, and response validators. Those shared modules
do not import providers or HTTP routes. Provider implementations and selection
live in `providers/`; operations such as journal analysis live in `tasks/`. Editable prompt files are handled by `app/llm/prompts.py`.
See `app/llm/README.md` for where to put a change.

FastAPI, Pydantic, SQLAlchemy, and the official provider SDKs remain the framework
boundaries. Adding a feature does not require a new framework or a provider rewrite.

The important interfaces are:

```python
class ChatLLMClient(Protocol):
    async def respond(
        self,
        user_input: str,
        profile: dict[str, Any],
        chat_info: dict[str, Any],
        chat_id: str,
        *,
        on_text_chunk: TextChunkCallback | None = None,
    ) -> ChatLLMResult:
        ...


class TopicLLMClient(Protocol):
    async def create_topic(
        self,
        chat_info: dict[str, Any],
        matched_patterns: list[str],
        topic_hint: str | None = None,
        available_topics: list[dict[str, Any]] | None = None,
    ) -> TopicLLMResult:
        ...
```

Chat providers return a direct response, updated ordinary profile memory, and
an optional user-confirmed map suggestion. Topic providers return a topic and
description.

```python
ChatLLMResult(
    assistant_message="Text for the user",
    profile={"complete": "updated profile"},
    map_suggestion=None,
)

TopicLLMResult(topic="Specific topic", description="Concise description")
```

Each role currently has four provider implementations:

- `LocalChatLLMClient` and `LocalTopicLLMClient`
- `OpenAIChatLLMClient` and `OpenAITopicLLMClient`
- `AnthropicChatLLMClient` and `AnthropicTopicLLMClient`
- `OllamaChatLLMClient` and `OllamaTopicLLMClient`

The local mock is useful because developers can build and test app flows without
paying for or configuring a real LLM. Ollama provides generated responses from
a model running on the developer's own computer. OpenAI API-key settings and
per-role model overrides remain supported; local development does not need a key.

## Changing Chat Summaries

The existing summary is a compact memory for future model requests, not a
separate user-facing summary feature. Its implementation is now isolated in
`app/llm/tasks/conversation_summary.py`:

1. `summarize_conversation(messages)` produces bounded, verbatim excerpts from
   older user messages. It excludes assistant interpretations and the most recent
   two user turns, and returns `None` when there is nothing to summarize.
2. `update_conversation_summary(chat_info)` returns updated metadata without
   modifying the input or removing full message history.
3. `process_llm_message()` in the chat route calls the updater after saving an
   exchange to memory and before committing the chat to the database.
4. `llm/context.py` includes the saved summary when building model requests.

To change summary selection or wording, edit the pure summarizer and run
`tests/test_conversation_summary.py`. Provider credentials, streaming, prompts,
and database code do not need to change. If you add an asynchronous model-based
summary, put that orchestration in its own service and await it explicitly from
the request flow or a background task; do not hide network calls in the pure
summarizer. Keep user ownership checks in any new API endpoint that exposes it.

For other features, keep HTTP parsing and authentication in `app/api/routes`,
business rules in `app/services`, and request/response models in `app/schemas`.
Import helpers from their owning modules so dependencies remain visible.

## How To Add A New API Function

Use this pattern for new endpoints.

### 1. Create A Route File

Create a file in `app/api/routes/`, for example:

```text
app/api/routes/notes.py
```

Example route:

```python
from fastapi import APIRouter, Depends

from app.api.dependencies import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/")
def list_notes(current_user: User = Depends(get_current_user)):
    return {
        "user_id": current_user.id,
        "notes": [],
    }
```

This route is protected because it depends on `get_current_user`.

### 2. Register The Router

Open `app/api/router.py` and import the route module:

```python
from app.api.routes import auth, health, llm, notes, users
```

Then include it:

```python
api_router.include_router(notes.router, prefix="/notes", tags=["notes"])
```

The endpoint will now be available at:

```text
GET /api/v1/notes/
```

### 3. Add Schemas For Request And Response Bodies

For structured request and response data, add schemas in `app/schemas/`.

Example:

```python
from pydantic import BaseModel, Field


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(default="", max_length=5000)


class NoteRead(BaseModel):
    id: int
    title: str
    body: str
```

Then use them in the route:

```python
@router.post("/", response_model=NoteRead)
def create_note(payload: NoteCreate):
    ...
```

Schemas protect your API from invalid input and make `/docs` more useful.

### 4. Add Tests

Add or update tests under `tests/`.

For authenticated endpoints, follow the existing pattern in
`tests/test_auth_and_llm.py`:

1. Register a user.
2. Log in.
3. Read the `access_token`.
4. Send `Authorization: Bearer <token>`.
5. Assert the expected response.

Run tests:

```bash
pytest
```

Or on Windows with the local virtual environment:

```powershell
.\.venv\Scripts\python -m pytest
```

## How To Add A New Database Model

Use this when the new feature needs persistent data.

### 1. Create The Model

Example:

```text
app/models/note.py
```

```python
from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(String(5000), default="", nullable=False)
```

### 2. Import The Model

Import it in `app/models/__init__.py`:

```python
from app.models.note import Note
```

Also make sure `app/db/init_db.py` imports the model package or module so
SQLAlchemy knows the table exists before `create_all()` runs.

### 3. Use The DB Session In Routes

```python
from fastapi import Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_db


def create_note(payload: NoteCreate, db: Session = Depends(get_db)):
    note = Note(...)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note
```

## How To Add A New LLM Provider

Add a provider module under `app/llm/providers/`. Reuse the contracts in `types.py`,
payload builders in `context.py`, and validators in `responses.py`.

Implement either the chat protocol, topic protocol, or both. A chat provider
must implement:

```python
async def respond(
    self,
    user_input: str,
    profile: dict[str, Any],
    chat_info: dict[str, Any],
    chat_id: str,
    *,
    on_text_chunk: TextChunkCallback | None = None,
) -> ChatLLMResult:
    ...
```

Example:

```python
from app.llm.types import ChatLLMResult


class MyLLMClient:
    async def respond(self, user_input, profile, chat_info, chat_id, *, on_text_chunk=None):
        assistant_message = "Generated message"
        updated_profile = {
            **profile,
            "last_user_message": user_input,
        }
        if on_text_chunk is not None:
            await on_text_chunk(assistant_message)
        return ChatLLMResult(
            assistant_message=assistant_message,
            profile=updated_profile,
            map_suggestion=None,
        )
```

Then update the matching factory in `app/llm/providers/factory.py`:

```python
def get_chat_llm_client() -> ChatLLMClient:
    provider = (settings.chat_llm_provider or settings.llm_provider).lower()
    if provider == "my_provider":
        return MyLLMClient()
    ...
```

Add any needed settings to `app/core/config.py` and `.env.example`.

## How To Change The User Profile

The user profile is stored as JSON in `UserProfile.data`.

Good profile fields are durable facts or useful context, for example:

- preferences
- goals
- important life context
- communication style
- recurring topics
- app-specific settings
- summary of past experiences

Avoid saving temporary text that is only useful for one conversation unless it
helps future personalization. For example, `recent_messages` is useful during
development, but a production profile might use summaries instead of raw message
history.

If you want stricter profile structure, create a Pydantic schema such as:

```python
class UserProfileData(BaseModel):
    goals: list[str] = []
    preferences: dict[str, str] = {}
    summary: str = ""
```

Then validate LLM profile output before saving it.

## Common Expansion Patterns

Public endpoint:

```python
@router.get("/public")
def public_endpoint():
    return {"status": "public"}
```

Authenticated endpoint:

```python
@router.get("/private")
def private_endpoint(current_user: User = Depends(get_current_user)):
    return {"user_id": current_user.id}
```

Endpoint with database access:

```python
@router.get("/items")
def list_items(db: Session = Depends(get_db)):
    ...
```

Authenticated endpoint with database access:

```python
@router.post("/items")
def create_item(
    payload: ItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ...
```

## Development Commands

Create and activate a virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\activate
```

Install dependencies:

```powershell
pip install -r requirements.txt
```

Run the API:

```powershell
uvicorn app.main:app --reload
```

Run tests:

```powershell
pytest
```

Open API docs:

```text
http://127.0.0.1:8000/docs
```

## Production Notes

Before deploying:

- Set a strong `SECRET_KEY`.
- Use a production database instead of local SQLite.
- Add database migrations, for example Alembic.
- Restrict `CORS_ORIGINS` to your real website and app origins.
- Use HTTPS.
- Store secrets in your deployment platform, not in git.
- Review what profile data is saved and document your privacy policy.
- Add rate limiting for auth and LLM endpoints.
- Add logging and monitoring.

