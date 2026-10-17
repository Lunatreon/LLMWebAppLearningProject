# FeelY Backend

FeelY helps people reflect on their experiences and understand themselves over
time. My Map connects the observations, values, relationships, and changes they
choose to save into an evolving map of themselves and their journey. Reflection
is valuable in its own right; practices and next steps are optional.

Python API backend for a website or app with user management, JWT authentication,
per-user LLM requests, and persistent user profiles.

## Features

- FastAPI application with modular route files under `app/api/routes`
- User registration and login
- JWT bearer authentication
- Basic bot and abuse protection for auth, API, and LLM endpoints
- Request-size limits, security headers, and production config checks
- SQLite by default, configurable through `DATABASE_URL`
- Optional synchronous PostgreSQL with psycopg 3 and explicit Alembic migrations
- Per-user profile storage
- Chat-LLM endpoint that sends chat context, chat history, and the saved profile to the LLM
- Background analyser that scores chats with backend pattern rules
- Topic-LLM flow that creates a topic and description after enough patterns match
- User-confirmed topic spaces that can reuse chats, nest under broader topics,
  connect related topics, and collect observations and practices
- A self-authorship map for inherited scripts, personal perceptions, values, body signals, evidence, and repeatable choices
- Premium daily journal with automatic saving, entry history, and optional AI map suggestions
- One-time password-reset links delivered through a configurable SMTP email provider
- React website in `frontend-react/` with authentication, chat, journal, My Map, account settings and billing
- Swappable LLM service with mock, OpenAI, Anthropic, and local Ollama providers

## Documentation

- [Backend structure, boundaries and validation](docs/BACKEND_STRUCTURE.md)
- [Pre-cleanup backend audit and import inventory](docs/BACKEND_STRUCTURE_AUDIT.md)
- [Database portability audit](docs/DATABASE_PORTABILITY_AUDIT.md)
- [PostgreSQL setup, migrations, data verification and rollback](docs/DATABASE_MIGRATION.md)
- [Local Docker backend, PostgreSQL and Mailpit](docs/DEPLOYMENT_LOCAL.md)
- [Production configuration, Caddy ingress, backups and release procedure](docs/DEPLOYMENT_PRODUCTION.md)
- [Complete production configuration inventory](docs/PRODUCTION_CONFIG_AUDIT.md)
- [Post-deployment production smoke checklist](docs/PRODUCTION_SMOKE_TEST.md)
- [Stripe subscription setup](docs/stripe-setup.md)
- [Administration and editable prompts](docs/admin.md)
- [Local webmail and reusable setup](WEBMAIL_SETUP.md)
- [Android login and versioned AGB acceptance](docs/ANDROID_AND_TERMS.md)
- [Edit and publish AGB / mandatory acceptance](docs/AGB_SETUP.md)
- [Bright-theme design guide](docs/BRIGHT_DESIGN.md)

See [docs/CODE_GUIDE.md](docs/CODE_GUIDE.md) for a walkthrough of how the code
works and how to expand the backend with new endpoints, database models, LLM
providers, profile fields, and tests.

See [docs/SELF_AUTHORSHIP.md](docs/SELF_AUTHORSHIP.md) for the Topic Space,
My Map, suggestion-confirmation, and practice lifecycle architecture.

## Setup

The only consumer frontend is **frontend-react/**. The old website/ application
has been removed. Admin, webmail, legal files, styles and images are now owned by
frontend-react/public/. No reference server or port 5500 is needed.

See [native Windows, MacBook and Hetzner setup](docs/DEPLOYMENT_NATIVE.md) for
PostgreSQL and data transfer without Docker. Native startup reads the root .env;
.env.docker is only used by Compose.

### Native Windows

Install PostgreSQL 17 and Node 24, start PostgreSQL, and set DATABASE_URL in .env
to your PostgreSQL application login. Preserve SECRET_KEY. With servers stopped:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend-react
.\.venv\Scripts\python.exe scripts/setup_secret.py
.\.venv\Scripts\python.exe -m alembic upgrade head
.\start-feely.bat
```

The launcher builds React and opens http://127.0.0.1:8000. It does not start
PostgreSQL. Keep it open; Ctrl+C stops the backend. --check checks prerequisites.
Public Cloudflare access is opt-in with start-feely.bat --tunnel.

### Frontend development

Run these in separate terminals from the repository root:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
npm run dev --prefix frontend-react
```

Open http://127.0.0.1:5173. API docs remain opt-in with API_DOCS_ENABLED=true.

### Administrator login

```powershell
.\.venv\Scripts\python.exe scripts/set_admin_password.py --username admin
```

Enter a password of at least 12 characters; the script saves a hash. Restart the
backend and open /admin.html on the active frontend. Administrator tokens remain
separate from user tokens.

### Editing the frontend

Use frontend-react/src/ for features and frontend-react/public/ for tools,
images, legal snapshots and shared styles. See [the frontend guide](frontend-react/README.md).

## Configuration

Local development works without an external LLM by keeping:

```env
LLM_PROVIDER="mock"
TOPIC_LLM_PROVIDER="local"
JOURNAL_LLM_PROVIDER="local"
```

To use OpenAI, set:

```env
LLM_PROVIDER="openai"
CHAT_LLM_PROVIDER="openai"
TOPIC_LLM_PROVIDER="openai"
JOURNAL_LLM_PROVIDER="openai"
OPENAI_API_KEY="your-api-key"
OPENAI_MODEL="gpt-5.4-mini"
OPENAI_CHAT_MODEL="gpt-5.4-mini"
OPENAI_TOPIC_MODEL="gpt-5.4-mini"
OPENAI_JOURNAL_MODEL="gpt-5.4-mini"
```

`OPENAI_CHAT_MODEL`, `OPENAI_TOPIC_MODEL`, and `OPENAI_JOURNAL_MODEL` can be changed independently.
When either is empty, the backend falls back to `OPENAI_MODEL`. The Chat-LLM
prompt follows a consistent conversational pattern: reflect the main concern,
separate feelings from actions when useful, offer one manageable next step, and
ask at most one open question.

To use Claude through Anthropic, set:

```env
LLM_PROVIDER="anthropic"
CHAT_LLM_PROVIDER="anthropic"
TOPIC_LLM_PROVIDER="anthropic"
JOURNAL_LLM_PROVIDER="anthropic"
ANTHROPIC_API_KEY="your-api-key"
ANTHROPIC_MODEL="claude-sonnet-4-6"
ANTHROPIC_CHAT_MODEL="claude-sonnet-4-6"
ANTHROPIC_TOPIC_MODEL="claude-sonnet-4-6"
ANTHROPIC_JOURNAL_MODEL="claude-sonnet-4-6"
ANTHROPIC_MAX_TOKENS=4096
```

The role-specific Anthropic models fall back to `ANTHROPIC_MODEL` when empty.
Chat, topic, and journal analysis can also use different providers.
For example, set `CHAT_LLM_PROVIDER="anthropic"` and
`TOPIC_LLM_PROVIDER="openai"` while leaving `LLM_PROVIDER="mock"` as the
default for any role without an override.

### Local generation with Ollama

Install [Ollama](https://ollama.com/download), then download the default model:

```powershell
ollama pull qwen3.5:4b
ollama pull qwen3.5:2b
```

The Ollama desktop application normally starts its local service automatically.
When it does not, start it from another terminal:

```powershell
ollama serve
```

Configure FeelY to use the local model:

```env
LLM_PROVIDER="ollama"
CHAT_LLM_PROVIDER="ollama"
TOPIC_LLM_PROVIDER="ollama"
JOURNAL_LLM_PROVIDER="ollama"
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3.5:4b"
OLLAMA_CHAT_MODEL="qwen3.5:4b"
OLLAMA_TOPIC_MODEL="qwen3.5:2b"
OLLAMA_JOURNAL_MODEL="qwen3.5:2b"
OLLAMA_TIMEOUT_SECONDS=180
OLLAMA_CONTEXT_WINDOW=2048
OLLAMA_CHAT_MAX_TOKENS=160
OLLAMA_TOPIC_MAX_TOKENS=256
OLLAMA_JOURNAL_MAX_TOKENS=768
OLLAMA_CHAT_NUM_GPU=0
OLLAMA_TOPIC_NUM_GPU=999
OLLAMA_JOURNAL_NUM_GPU=999
OLLAMA_KEEP_ALIVE=300
OLLAMA_PREWARM=false
```

No API key is needed. The pattern analyser decides when topic analysis is useful;
the 2B Topic-LLM then creates the topic and description. `OLLAMA_CHAT_NUM_GPU=0`
forces the 4B chat model onto CPU, while the topic and journal GPU settings let
Ollama offload every possible layer of the 2B model to GPU. `OLLAMA_KEEP_ALIVE=300`
releases models after five idle minutes. `OLLAMA_PREWARM=false` avoids loading
models during server startup, reducing startup resource use. Role-specific model settings fall back to
`OLLAMA_MODEL` when empty.
The website uses the streaming message endpoint to show connection and elapsed
status first, then renders the assistant message as Ollama generates it. The
profile and map fields in Ollama's structured response remain server-side.
`OLLAMA_KEEP_ALIVE` keeps the models in memory between messages to avoid repeated
cold starts. Opting into `OLLAMA_PREWARM=true` loads them in the background when FastAPI starts, so
the first user is less likely to pay the model-load delay. Smaller context and
output limits can further reduce local latency.

With `LLM_PROVIDER="mock"`, no external model is called. The backend uses local,
deterministic development responses instead. Set `LLM_PROVIDER` to `openai`,
`anthropic`, or `ollama` to receive generated responses. OpenAI and Anthropic
require their matching API key; Ollama runs locally without one.
`CHAT_LLM_PROVIDER`, `TOPIC_LLM_PROVIDER`, and `JOURNAL_LLM_PROVIDER` can
independently override `LLM_PROVIDER`. Journal analysis falls back to the topic
provider when its own override is empty.

Change `SECRET_KEY` before deploying.

### Temporary Public Preview Protection

If you want the app reachable over the internet but not open to everyone yet, the easiest reversible option is HTTP basic auth.

Set these values in your environment:

```env
BASIC_AUTH_ENABLED=true
BASIC_AUTH_USERNAME="preview"
BASIC_AUTH_PASSWORD="choose-a-strong-password"
```

This is only intended for a private preview and is separate from FeelY user
accounts. Keep `BASIC_AUTH_ENABLED=false` for the public app so people can
register normally. When enabled, API clients must use conventional
`Authorization: Basic ...` credentials.

### Bot And Abuse Protection

The backend includes lightweight in-memory throttles for public account routes,
general API traffic, and per-user LLM burst traffic. Daily LLM usage is persisted
in the database, so restarting the API or deleting a chat does not reset the
allowance. The limits can be tuned in `.env`:

```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_API_PER_MINUTE=300
RATE_LIMIT_AUTH_IP_PER_MINUTE=30
RATE_LIMIT_REGISTER_IP_PER_HOUR=20
RATE_LIMIT_LOGIN_IDENTIFIER_ATTEMPTS=8
RATE_LIMIT_LOGIN_IDENTIFIER_WINDOW_SECONDS=900
RATE_LIMIT_LLM_USER_PER_MINUTE=30
RATE_LIMIT_LLM_FREE_USER_PER_DAY=10
RATE_LIMIT_LLM_USER_PER_DAY=400
MAX_REQUEST_BODY_BYTES=128000
```

Free accounts use the smaller daily chat allowance. Active or trialing Premium
accounts use the higher fair-use limit, can use saved map insights as chat
context, and can read or edit My Map. Topic suggestions and chat-title confirmation
are available to every account. These checks are
enforced by the API; the frontend's locked preview is not the security boundary.

The frontend registration form also sends an invisible honeypot field. Real
users leave it empty; simple form-fill bots often populate it and are rejected.

Registration can also require Cloudflare Turnstile CAPTCHA verification before
the backend creates a user. Create a Turnstile widget in Cloudflare, copy the
site key and secret key into `.env`, then enable it:

```env
CAPTCHA_ENABLED=true
CAPTCHA_PROVIDER="turnstile"
TURNSTILE_SITE_KEY="your-public-site-key"
TURNSTILE_SECRET_KEY="your-private-secret-key"
TURNSTILE_ACTION="register"
TURNSTILE_VERIFY_URL="https://challenges.cloudflare.com/turnstile/v0/siteverify"
TURNSTILE_TIMEOUT_SECONDS=5
```

The static website reads `GET /api/v1/auth/captcha/config`, renders the
Turnstile widget on the Register tab, and sends the returned token as
`captcha_token` to `POST /api/v1/auth/register`. The backend verifies that token
with Turnstile before any user row is created. Local development can keep the
CAPTCHA enabled with Cloudflare's documented test keys:

```env
CAPTCHA_ENABLED=true
TURNSTILE_SITE_KEY="1x00000000000000000000AA"
TURNSTILE_SECRET_KEY="1x0000000000000000000000000000000AA"
TURNSTILE_ACTION="register"
```

These development keys always pass and therefore do not protect a public site.
Non-local environments refuse to start unless CAPTCHA is enabled with real
keys; the backend also rejects Cloudflare test keys in production. Restrict the
production widget to the website's real hostname in the Cloudflare dashboard.

### Email activation and password reset

The email setup guide is [EMAIL_SETUP.md](EMAIL_SETUP.md). Configure a real
sending provider for `noreply@feel-y.com` and its SMTP credentials before
turning on account emails. The application does not provision a mailbox.

With `EMAIL_VERIFICATION_ENABLED=true`, new password accounts must enter a
six-digit email PIN before logging in. PINs expire after 15 minutes by default,
allow five attempts, and can only be used once. Resending replaces the old PIN.
Users can reopen **Activate account / enter email PIN** on the login page or
request a code through Account settings. Already-issued verification links
remain valid until their original expiry. Existing accounts already marked verified
remain verified.

`PASSWORD_RESET_ENABLED=true` enables **Forgot your password?** emails through
the same SMTP connection. Links point to `PUBLIC_APP_URL`, expire after 60
minutes by default, and can only be used once. Resetting a password does not
activate an unverified account. Existing sessions keep their original expiry.

### Test feedback

Set `FEEDBACK_ENABLED=true` and restart the backend to show **Share test
feedback** in the signed-in sidebar. Feedback is stored in the database's
`feedback` table and can be read in the **Feedback inbox** at `/admin.html`.
The inbox includes the sender's account email, category, message, and time;
chat content is never automatically attached. Set `FEEDBACK_EMAIL_TO` to
`info@feel-y.com` for best-effort SMTP notifications in addition to database
storage. Clear it to use feedback without an email provider. Notification
failures leave saved feedback available in admin; automatic retries are not
implemented. Emailed copies are not removed by account deletion.

Set `FEEDBACK_ENABLED=false` and restart to hide the form on refresh and reject
new submissions immediately, including from already-open tabs. Existing
feedback remains available to administrators. Feedback is deleted along with
its author's account. Submissions are limited to five per account per hour.

### Premium journal

Journal is the third workspace beside Chat and My Map. It opens today's page by
default, saves changes shortly after the user stops typing, and lists previous
entries by date. The backend enforces Premium access, so changing or bypassing
the browser interface cannot expose journal data to a free account.

**Find map insights** asks the Journal-LLM for optional topic, activity,
practice, observation, value, evidence, script, perception, or body-signal
suggestions. Nothing is added to My Map automatically: the user can edit each
suggestion, choose or create a topic, and explicitly save or dismiss it. Saving
under a topic connects that dated journal page to the topic. My Map displays the
number of connected journal pages and links back to each date. The AI
instructions live in `prompts/journal_system.txt` and can be edited from the
separate admin page; changes apply to the next analysis without a restart.

For production, also put a reverse proxy or hosting firewall in front of the
app. If the app runs behind a trusted proxy that sets `X-Forwarded-For`, set
`TRUST_PROXY_HEADERS=true`; otherwise leave it `false` so clients cannot spoof
their IP address. Non-local environments refuse to start with the default
`SECRET_KEY`, unsafe CORS origins such as `*` or `null`, or missing CAPTCHA
configuration.

## Main Endpoints

- `GET /api/v1/health`
- `GET /api/v1/auth/captcha/config`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/email-verification/request`
- `POST /api/v1/auth/email-verification/confirm`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/confirm`
- `GET /api/v1/users/me`
- `GET /api/v1/users/me/account`
- `PATCH /api/v1/users/me/account`
- `PATCH /api/v1/users/me/password`
- `DELETE /api/v1/users/me/account`
- `GET /api/v1/users/me/profile`
- `PUT /api/v1/users/me/profile`
- `GET /api/v1/users/me/map`
- `POST /api/v1/users/me/map/entries`
- `PATCH /api/v1/users/me/map/practices/{entry_id}`
- `GET /api/v1/llm/chats`
- `POST /api/v1/llm/chats`
- `GET /api/v1/llm/chats/{chat_id}`
- `GET /api/v1/llm/chats/{chat_id}/topic-suggestion`
- `POST /api/v1/llm/message`
- `POST /api/v1/llm/topics/confirm`
- `POST /api/v1/llm/map-suggestions/confirm`
- `GET /api/v1/journal/entries`
- `GET /api/v1/journal/entries/{entry_date}`
- `PUT /api/v1/journal/entries/{entry_date}`
- `POST /api/v1/journal/entries/{entry_date}/analyse`
- `POST /api/v1/journal/entries/{entry_date}/suggestions/{suggestion_id}`

## LLM Flow

When an authenticated user calls `POST /api/v1/llm/message`, the backend:

1. Loads the user's saved profile and chat info for `chat_id`.
2. Sends compact profile data, extractive notes from older turns, the latest exchange,
   and the new `context` to the Chat-LLM.
3. Saves the Chat-LLM response, updated profile, and updated chat info.
4. Returns the chat response to the app or website immediately.
5. Starts a backend background task that checks the full stored chat with the hard-coded analyser.
6. If enough patterns from `docs/pattern_recognition.txt` match, sends compact notes, recent
   user messages, and the user's existing topic list to the Topic-LLM.
7. Saves the Topic-LLM topic and description as a pending suggestion. The model
   can recommend connecting the chat to an existing topic or placing a new topic
   under a broader one; the user confirms the choice.
8. Returns an existing pending topic immediately and lets the frontend poll
   `GET /api/v1/llm/chats/{chat_id}/topic-suggestion` for newly generated topics.
9. Uses an accepted topic as the chat title through `POST /api/v1/llm/topics/confirm`.
10. For users with My Map access, creates or reuses a Topic Space and connects the current chat.
11. Optionally proposes one editable My Map entry from the newest user message.
12. Writes that entry only after explicit user confirmation.

Map topics have an editable type: Person, Trait, Experience, or Other. My Map uses
its existing floating topic bubbles and filters for these types, with short descriptions in the selected
topic's detail card. Existing topics without a type appear under Other until edited.
Chat and journal prompts favor simple 1-4 word names and brief descriptions grounded
in the user's account. Chat suggestions can propose connections to existing topics;
the user can review those connections before saving, or use Edit & connect later.

Patterns are an analysis trigger, not a fixed topic taxonomy. The Topic-LLM can
create its own free-form topic from the compact conversation memory. Longer chats
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

React is the only consumer frontend. Billing, subscriptions and account deletion
call the existing backend directly from /account. Historical /index.html,
/chat.html, /agb.html and email verification links are handled by React.

Build with npm run build --prefix frontend-react. Native app.main serves the
compiled frontend-react/dist/ alongside /api/v1 on port 8000. Production Caddy
serves the same build and proxies /api/. The optional app.website entry point
now serves compiled React, not the old website.

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
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.\.venv\Scripts\python.exe -m pytest
```

The normal tests start the FastAPI app inside pytest and do not need a running
server. To test a server that is already running, start the API first:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Then run the live-server test in another terminal:

```powershell
$env:FEELY_RUN_SERVER_TESTS = "1"
.\.venv\Scripts\python.exe -m pytest tests/test_running_server.py
```

By default it calls `http://127.0.0.1:8000`. To use another server URL:

```powershell
$env:FEELY_RUN_SERVER_TESTS = "1"
$env:FEELY_TEST_SERVER_URL = "http://127.0.0.1:8001"
.\.venv\Scripts\python.exe -m pytest tests/test_running_server.py
```


tunnel --config 'C:\Program Files\cloudflared\config.yml' run feely-backend
