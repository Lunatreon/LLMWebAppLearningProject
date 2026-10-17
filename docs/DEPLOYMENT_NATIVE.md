# Native PostgreSQL deployment

Docker is optional. Use PostgreSQL 17, Python 3.13 and Node 24 locally.
The active website is frontend-react/. The old website/ consumer application
has been removed. Admin, mail, legal documents and assets live in
frontend-react/public/. No separate reference server is needed.

## Database and configuration

Install PostgreSQL 17 directly. Windows offers an installer and ZIP binaries;
macOS can use `brew install postgresql@17` and `brew services start postgresql@17`.
On Linux use your distribution's PostgreSQL packages, selecting major 17.
Create a non-superuser application login and a database owned by that login.
Set the login password interactively using psql's `\password` command.

Native startup reads the root `.env`, not `.env.docker`. Back up an existing
.env; copy .env.example only on a fresh checkout. Preserve SECRET_KEY.

```dotenv
ENVIRONMENT="local"
DATABASE_URL="postgresql+psycopg://feely_app:URL_ENCODED_PASSWORD@127.0.0.1:5432/feely"
PUBLIC_APP_URL="http://127.0.0.1:8000"
PROMPT_DIRECTORY="prompts"
LLM_PROVIDER="openai"
CHAT_LLM_PROVIDER="openai"
TOPIC_LLM_PROVIDER="openai"
JOURNAL_LLM_PROVIDER="openai"
OPENAI_API_KEY="your-private-api-key"
OPENAI_MODEL="gpt-5.4-mini"
OLLAMA_PREWARM=false
```

Use the actual native PostgreSQL port and a URL-encoded password. Do not reuse
Docker's postgres/mailpit hostnames or /app/prompts path. Editing a URL does not
create a database or transfer existing records.

For local work without SMTP, disable EMAIL_VERIFICATION_ENABLED,
EMAIL_VERIFICATION_REQUIRED and PASSWORD_RESET_ENABLED. Keep CAPTCHA_ENABLED=false
and WEBMAIL_ENABLED=false unless configured. PREMIUM_FEATURES_ENABLED=false
enables the free test phase. These are development settings only.

## Windows

Use the existing .venv, or create one once on a fresh checkout. Start PostgreSQL
first. From the repository root, with application servers stopped:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
npm ci --prefix frontend-react
.\.venv\Scripts\python.exe scripts/setup_secret.py
.\.venv\Scripts\python.exe -m alembic upgrade head
.\start-feely.bat
```

The launcher builds React and opens http://127.0.0.1:8000. It starts no public
tunnel unless --tunnel is supplied. It does not start PostgreSQL. Ctrl+C stops
the backend. No port 5500 is required.

## MacBook

Create the machine's own environment once; do not copy Windows .venv/node_modules:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm ci --prefix frontend-react
```

Configure .env as above, then:

```bash
.venv/bin/python scripts/setup_secret.py
.venv/bin/python -m alembic upgrade head
npm run build --prefix frontend-react
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. For frontend development run `npm run dev --prefix
frontend-react` in a second terminal and open port 5173. Both modes include
/admin.html, /webmail.html and /legal/.

## Hetzner without Docker

Install PostgreSQL 17, Python, Node 24 for building, and Caddy. Checkout a tested
revision in an operator-owned directory such as /srv/feely. Build the same React
code. Use production runtime settings, not local development switches.

The validations in app/core/production.py still apply: real SMTP, Turnstile,
public HTTPS links/origins, published Terms, explicit OpenAI providers, secure
signing credentials and a non-bootstrap PostgreSQL login. Configure native paths
and loopback DB/proxy addresses. The current production-config helper and
compose.production.yml describe Docker-specific networking and files.

Manage Uvicorn with systemd: set WorkingDirectory=/srv/feely, load a private
environment file and execute the venv Python with `-m uvicorn app.main:app --host
127.0.0.1 --port 8000 --workers 1 --proxy-headers --forwarded-allow-ips 127.0.0.1
--no-server-header`. Run migrations explicitly before starting the service.

Caddy can proxy the complete app and API to loopback port 8000:

```caddyfile
app.example.com {
    reverse_proxy 127.0.0.1:8000 {
        flush_interval -1
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up X-Real-IP {remote_host}
    }
}
```

Configure the actual domain, production ALLOWED_HOSTS/CORS/PUBLIC_APP_URL and DNS.
Keep PostgreSQL and Uvicorn private. This is an installation outline, not evidence
of a live server deployment.

## Data transfer

Use PostgreSQL pg_dump/pg_restore into a fresh target database, assigning ownership
to its production application login. Pause source writes for final cutover.
Restore before starting the target backend; verify Alembic revision, row counts,
login, chats, journals and maps. Keep the source backup. Transfer edited prompts
and matching legal documents separately. Retain the signing secret if existing
sessions and outstanding authentication tokens must remain valid.

Database archives transfer across Windows, Apple Silicon and Linux. Do not copy
raw PostgreSQL data directories or Docker volumes between platforms.
