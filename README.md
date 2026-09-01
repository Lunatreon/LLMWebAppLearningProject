# FeelY Backend

Python API backend for a website or app with user management, JWT authentication,
per-user LLM requests, and persistent user profiles.

## Features

- FastAPI application with modular route files under `app/api/routes`
- User registration and login
- JWT bearer authentication
- Basic bot and abuse protection for auth, API, and LLM endpoints
- Request-size limits, security headers, and production config checks
- SQLite by default, configurable through `DATABASE_URL`
- Per-user profile storage
- Chat-LLM endpoint that sends chat context, chat history, and the saved profile to the LLM
- Background analyser that scores chats with backend pattern rules
- Topic-LLM flow that creates a topic and description after enough patterns match
- User-confirmed topic spaces that can reuse chats, nest under broader topics,
  connect related topics, and collect observations and practices
- A self-authorship map for inherited scripts, personal perceptions, values, body signals, evidence, and repeatable choices
- Premium daily journal with automatic saving, entry history, and optional AI map suggestions
- One-time password-reset links delivered through a configurable SMTP email provider
- Static website in `website/` with public content pages, login, registration, chat list, chat view, and topic confirmation
- Swappable LLM service with mock, OpenAI, Anthropic, and local Ollama providers

## Documentation

- [Stripe subscription setup](docs/stripe-setup.md)
- [Administration and editable prompts](docs/admin.md)

See [docs/CODE_GUIDE.md](docs/CODE_GUIDE.md) for a walkthrough of how the code
works and how to expand the backend with new endpoints, database models, LLM
providers, profile fields, and tests.

See [docs/SELF_AUTHORSHIP.md](docs/SELF_AUTHORSHIP.md) for the Topic Space,
My Map, suggestion-confirmation, and practice lifecycle architecture.

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

Then open `http://127.0.0.1:5500`; the root page redirects directly to
`http://127.0.0.1:5500/chat.html`.

The API runs at `http://127.0.0.1:8000`.
Interactive API docs are at `http://127.0.0.1:8000/docs`.

### Administrator login

The administration page uses its own credentials and is not connected to a
FeelY user account. After creating `.env`, configure or change the administrator
password from the repository root:

```powershell
.\.venv\Scripts\python.exe scripts\set_admin_password.py --username admin
```

Enter the new password twice when prompted. PowerShell does not display the
characters while you type; this is expected. The password must contain at least
12 characters. The script updates `ADMIN_USERNAME` and writes only a PBKDF2
password hash to `ADMIN_PASSWORD_HASH` in `.env`—do not paste the original
password or invent a hash manually.

Restart Uvicorn after running the command. Then open
`http://127.0.0.1:5500/admin.html` locally, or
`https://app.feel-y.com/admin.html` in production, and sign in using the chosen
username and the original password (not the hash).

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

The HTML points `feely-api-base` to `https://api.feel-y.com/api/v1`. Pages
served from localhost or opened directly from disk automatically use
`http://127.0.0.1:8000/api/v1`; the `api_base` query parameter can explicitly
override either behavior. Include every public frontend origin in
`CORS_ORIGINS`.

For Cloudflare-deployed usage with your current tunnel, set the API base to:

```javascript
localStorage.setItem("feely_api_base", "https://api.feel-y.com/api/v1")
```

Then refresh the website.

In `.env`, add or keep:

```env
PUBLIC_APP_URL="https://app.feel-y.com"
CORS_ORIGINS='["https://app.feel-y.com", "http://localhost:3000", "http://localhost:5173", "http://localhost:5500", "http://127.0.0.1:5500", "http://localhost:8080", "http://127.0.0.1:8080", "http://0.0.0.0:8080", "null"]'
```

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
OLLAMA_KEEP_ALIVE=-1
OLLAMA_PREWARM=true
```

No API key is needed. The pattern analyser decides when topic analysis is useful;
the 2B Topic-LLM then creates the topic and description. `OLLAMA_CHAT_NUM_GPU=0`
forces the 4B chat model onto CPU, while the topic and journal GPU settings let
Ollama offload every possible layer of the 2B model to GPU. `OLLAMA_KEEP_ALIVE=-1`
keeps the models resident until Ollama stops, and startup prewarm loads each
distinct configured model. Role-specific model settings fall back to
`OLLAMA_MODEL` when empty.
The website uses the streaming message endpoint to show connection and elapsed
status first, then renders the assistant message as Ollama generates it. The
profile and map fields in Ollama's structured response remain server-side.
`OLLAMA_KEEP_ALIVE` keeps the models in memory between messages to avoid repeated
cold starts. `OLLAMA_PREWARM` loads them in the background when FastAPI starts, so
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

Google account sign-in is optional. Create a Google OAuth Web Client ID for the
website origin, then enable it:

```env
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID="your-google-web-client-id"
GOOGLE_ALLOWED_HOSTED_DOMAIN=""
```

The frontend loads Google Identity Services only when enabled. It sends the
Google ID token to `POST /api/v1/auth/google`; the backend verifies the token,
checks the configured client ID, and links the account through Google's stable
subject ID.

Verification email is also possible, but it needs an email delivery provider.
Use SMTP credentials from a service such as your domain host, Postmark,
SendGrid, Mailgun, AWS SES, or another transactional email provider. You also
need a public frontend URL so the email link can point back to the app:

```env
EMAIL_VERIFICATION_ENABLED=true
EMAIL_VERIFICATION_REQUIRED=false
EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS=24
PUBLIC_APP_URL="https://your-site.example"
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_USERNAME="smtp-user"
SMTP_PASSWORD="smtp-password"
SMTP_FROM_EMAIL="hello@your-site.example"
SMTP_USE_TLS=true
```

When enabled, registration creates an unverified account and emails a one-time
verification link. Users can also request another email from Account settings.
Set `EMAIL_VERIFICATION_REQUIRED=true` only after SMTP delivery is working,
because unverified password users cannot log in when it is required.

### Password reset email

Password reset uses the same SMTP connection. FeelY sends the messages, but it
does not host a mailbox or automatically create an account with an email
provider. Add the SMTP credentials supplied by your chosen provider above,
verify that its sender/domain is allowed, and then enable reset links:

```env
PASSWORD_RESET_ENABLED=true
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES=60
RATE_LIMIT_PASSWORD_RESET_IDENTIFIER_PER_HOUR=3
PUBLIC_APP_URL="https://app.feel-y.com"
```

Restart FastAPI after editing `.env`. The login page's **Forgot password?**
action always gives the same response whether an address exists or not. For a
matching active account, it emails a one-time link back to `chat.html`; the link
expires after the configured number of minutes. Keep
`PASSWORD_RESET_ENABLED=false` until SMTP delivery has been tested.

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
- `GET /api/v1/auth/google/config`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/google`
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

The frontend lives in `website/` and calls the API at
`http://127.0.0.1:8000/api/v1` by default.

Login, registration, account management, billing, conversations, and My Map live
in `website/chat.html`. The standalone marketing pages were moved out of this
backend repository; embed or copy this app page from the repository that owns the
public website.

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
