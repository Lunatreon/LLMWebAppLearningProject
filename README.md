# FeelY Backend

Python API backend for a website or app with user management, JWT authentication,
per-user LLM requests, and persistent user profiles.

## Features

- FastAPI application with modular route files under `app/api/routes`
- User registration and login
- JWT bearer authentication
- SQLite by default, configurable through `DATABASE_URL`
- Per-user profile storage
- LLM endpoint that sends both the latest user message and the saved profile to the LLM
- Swappable LLM service with a local mock provider for development and an OpenAI provider hook

## Documentation

See [docs/CODE_GUIDE.md](docs/CODE_GUIDE.md) for a walkthrough of how the code
works and how to expand the backend with new endpoints, database models, LLM
providers, profile fields, and tests.

## Setup

### Windows PowerShell

Use a normal Python installation from python.org, then run these commands from
the repository root:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --reload
```

If PowerShell says that `Activate.ps1` cannot be loaded, enable scripts for the
current terminal session and activate the environment again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

If the existing `.venv` was created from a Windows Store Python and fails with
an `Access is denied` error, delete and recreate it after installing Python:

```powershell
Remove-Item -Recurse -Force .venv
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

The API will be available at `http://127.0.0.1:8000`.

Interactive docs are available at `http://127.0.0.1:8000/docs`.

## Configuration

Local development works without an external LLM by keeping:

```env
LLM_PROVIDER="mock"
```

To use OpenAI, set:

```env
LLM_PROVIDER="openai"
OPENAI_API_KEY="your-api-key"
OPENAI_MODEL="gpt-4.1-mini"
```

Change `SECRET_KEY` before deploying.

## Main Endpoints

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/users/me`
- `GET /api/v1/users/me/profile`
- `PUT /api/v1/users/me/profile`
- `POST /api/v1/llm/message`

## LLM Flow

When an authenticated user calls `POST /api/v1/llm/message`, the backend:

1. Loads the user's saved profile.
2. Sends the user input and profile to the configured LLM client.
3. Receives an assistant message and updated complete profile.
4. Saves the updated profile to the database.
5. Returns the assistant message and profile to the app or website.

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

```bash
pytest
```

The normal tests start the FastAPI app inside pytest and do not need a running
server. To test a server that is already running, start the API first:

```powershell
python -m uvicorn app.main:app --reload
```

Then run the live-server test in another terminal:

```powershell
python -m pytest tests/test_running_server.py
```

By default it calls `http://127.0.0.1:8000`. To use another server URL:

```powershell
$env:FEELY_TEST_SERVER_URL = "http://127.0.0.1:8001"
python -m pytest tests/test_running_server.py
```
