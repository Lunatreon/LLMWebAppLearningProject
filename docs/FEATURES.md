# Feature configuration and API flows

Start with [the project README](../README.md) for setup and navigation.

## Configuration

Conversation storage now uses columns and a separate ordered exchange table.
See [chat storage and migration](CHAT_STORAGE.md) before starting an existing
SQLite installation with the updated code.

Local development works without an external LLM by keeping:

```env
LLM_PROVIDER="mock"
TOPIC_LLM_PROVIDER="local"
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

To use Claude through Anthropic, set:

```env
LLM_PROVIDER="anthropic"
CHAT_LLM_PROVIDER="anthropic"
TOPIC_LLM_PROVIDER="anthropic"
ANTHROPIC_API_KEY="your-api-key"
ANTHROPIC_MODEL="claude-sonnet-4-6"
ANTHROPIC_CHAT_MODEL="claude-sonnet-4-6"
ANTHROPIC_TOPIC_MODEL="claude-sonnet-4-6"
ANTHROPIC_MAX_TOKENS=4096
```

The role-specific Anthropic models fall back to `ANTHROPIC_MODEL` when empty.
Chat and topic analysis can also use different providers.
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
OLLAMA_BASE_URL="http://127.0.0.1:11434"
OLLAMA_MODEL="qwen3.5:4b"
OLLAMA_CHAT_MODEL="qwen3.5:4b"
OLLAMA_TOPIC_MODEL="qwen3.5:2b"
OLLAMA_TIMEOUT_SECONDS=180
OLLAMA_CONTEXT_WINDOW=2048
OLLAMA_CHAT_MAX_TOKENS=160
OLLAMA_TOPIC_MAX_TOKENS=256
OLLAMA_CHAT_NUM_GPU=0
OLLAMA_TOPIC_NUM_GPU=999
OLLAMA_KEEP_ALIVE=300
OLLAMA_PREWARM=false
```

No API key is needed. The pattern analyser decides when topic analysis is useful;
the 2B Topic-LLM then creates the topic and description. `OLLAMA_CHAT_NUM_GPU=0`
forces the 4B chat model onto CPU, while the topic GPU setting let
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
`CHAT_LLM_PROVIDER` and `TOPIC_LLM_PROVIDER` can independently override `LLM_PROVIDER`.

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

### Retired journal data

Journal routes, UI, model settings and prompts have been removed. The legacy
`journal_entries` database table remains for existing records and database
backup/transfer compatibility. This cleanup does not delete or migrate user data.

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

## LLM Flow

When an authenticated user calls `POST /api/v1/llm/message`, the backend:

1. Loads the user's saved profile and chat info for `chat_id`.
2. Sends compact profile data, extractive notes from older turns, the latest exchange,
   and the new `context` to the Chat-LLM.
3. Saves the Chat-LLM response, updated profile, and updated chat info.
4. Returns the chat response to the app or website immediately.
5. Starts a backend background task that checks the full stored chat with the hard-coded analyser.
6. If enough patterns from `backend/llm/pattern_recognition.txt` match, sends compact notes, recent
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
Chat and topic prompts favor simple 1-4 word names and brief descriptions grounded
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

