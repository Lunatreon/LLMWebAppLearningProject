# FeelY Backend

Python API backend for a website or app with user management, JWT authentication,
per-user LLM requests, and persistent user profiles.

## Features

- FastAPI application with modular route files under `app/api/routes`
- User registration and login
- JWT bearer authentication
- SQLite by default, configurable through `DATABASE_URL`
- Per-user profile storage
- Chat-LLM endpoint that sends chat context, chat history, and the saved profile to the LLM
- Background analyser that scores chats with backend pattern rules
- Topic-LLM flow that creates a topic and description after enough patterns match
- Static website in `website/` with public content pages, login, registration, chat list, chat view, and topic confirmation
- Swappable LLM service with a local mock provider for development and an OpenAI provider hook

## Documentation

See [docs/CODE_GUIDE.md](docs/CODE_GUIDE.md) for a walkthrough of how the code
works and how to expand the backend with new endpoints, database models, LLM
providers, profile fields, and tests.

## Setup

### Windows PowerShell

Use these commands from the repository root. Do not activate the virtual
environment; the commands call the venv Python directly.

First-time setup:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
```

Daily start, terminal 1:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Daily start, terminal 2:

```powershell
.\.venv\Scripts\python.exe -m http.server 5500 --directory website
```

Then open `http://127.0.0.1:5500` for the public FeelY site, or
`http://127.0.0.1:5500/chat.html` to open the private chat directly.

The API runs at `http://127.0.0.1:8000`.
Interactive API docs are at `http://127.0.0.1:8000/docs`.

### Important

- Do not run `python -m venv .venv` after setup is complete.
- Do not run `pip install` while the backend or website server is running.
- Stop running servers with `Ctrl+C` before reinstalling packages.
- Do not paste Markdown backticks into PowerShell.
- If the prompt starts with `(.venv)`, you can still use the commands above.

If port `8000` is already busy, start the backend on another port:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001
```

If you use port `8001`, update the website API URL in the browser console:

```javascript
localStorage.setItem("feely_api_base", "http://127.0.0.1:8001/api/v1")
```

Then refresh the website.

### Reset The Environment

Only use this if the venv is broken. First close every terminal running the
backend or website. Then open a fresh PowerShell in the repository root and run:

```powershell
Remove-Item -Recurse -Force .venv
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

If Windows says files inside `.venv` are in use, a Python process is still
running. Close the backend and website terminals, or restart PowerShell and try
again.

## Configuration

Local development works without an external LLM by keeping:

```env
LLM_PROVIDER="mock"
```

To use OpenAI, set:

```env
LLM_PROVIDER="openai"
CHAT_LLM_PROVIDER="openai"
TOPIC_LLM_PROVIDER="openai"
OPENAI_API_KEY="your-api-key"
OPENAI_MODEL="gpt-5.4-mini"
OPENAI_CHAT_MODEL="gpt-5.4-mini"
OPENAI_TOPIC_MODEL="gpt-5.4-mini"
```

`OPENAI_CHAT_MODEL` and `OPENAI_TOPIC_MODEL` can be changed independently.
When either is empty, the backend falls back to `OPENAI_MODEL`. The Chat-LLM
prompt follows a consistent conversational pattern: reflect the main concern,
separate feelings from actions when useful, offer one manageable next step, and
ask at most one open question.

With `LLM_PROVIDER="mock"`, no OpenAI model is called. The backend uses local,
deterministic development responses instead. Set `LLM_PROVIDER="openai"` and a
valid API key to receive generated responses from the configured mini model.
`CHAT_LLM_PROVIDER` and `TOPIC_LLM_PROVIDER` can independently override
`LLM_PROVIDER`, which is useful while testing the two LLM roles separately.

Change `SECRET_KEY` before deploying.

## Main Endpoints

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`
- `GET /api/v1/users/me/profile`
- `PUT /api/v1/users/me/profile`
- `GET /api/v1/llm/chats`
- `POST /api/v1/llm/chats`
- `GET /api/v1/llm/chats/{chat_id}`
- `GET /api/v1/llm/chats/{chat_id}/topic-suggestion`
- `POST /api/v1/llm/message`
- `POST /api/v1/llm/topics/confirm`

## LLM Flow

When an authenticated user calls `POST /api/v1/llm/message`, the backend:

1. Loads the user's saved profile and chat info for `chat_id`.
2. Sends profile data, chat info, and the new `context` to the Chat-LLM.
3. Saves the Chat-LLM response, updated profile, and updated chat info.
4. Returns the chat response to the app or website immediately.
5. Starts a backend background task that sends the full chat info to the hard-coded analyser.
6. If enough patterns from `docs/pattern_recognition.txt` match, sends the full chat to the Topic-LLM.
7. Saves the Topic-LLM topic and description as a pending topic suggestion.
8. Lets the frontend poll `GET /api/v1/llm/chats/{chat_id}/topic-suggestion`.
9. Writes an accepted topic into the user profile through `POST /api/v1/llm/topics/confirm`.

Patterns are an analysis trigger, not a fixed topic taxonomy. The Topic-LLM can
create its own free-form topic from the user's full conversation. Longer chats
that do not match a predefined category can also enter open-topic analysis.

The current request shape is:

```json
{
  "chat_id": "main-chat",
  "context": "I had a stressful day but finished my project."
}
```

Older clients can still send `message` instead of `context`; if `chat_id` is not
provided, the backend creates a new chat.

## Website

The frontend lives in `website/` and calls the API at
`http://127.0.0.1:8000/api/v1` by default.

The public pages include Home, Courses, Dream Builder, Videos, Toolkit,
Community, and About. Login, registration, and conversations live at
`website/chat.html`.

## Adding New API Functions

Create a new route module in `app/api/routes`, define an `APIRouter`, and include
it in `app/api/router.py`.

Example:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/example")
def example():
    return {"message": "Hello from a new API function"}
```

Then add it to `app/api/router.py`:

```python
from app.api.routes import example

api_router.include_router(example.router, prefix="/example", tags=["example"])
```

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

The normal tests start the FastAPI app inside pytest and do not need a running
server. To test a server that is already running, start the API first:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Then run the live-server test in another terminal:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_running_server.py
```

By default it calls `http://127.0.0.1:8000`. To use another server URL:

```powershell
$env:FEELY_TEST_SERVER_URL = "http://127.0.0.1:8001"
.\.venv\Scripts\python.exe -m pytest tests/test_running_server.py
```
