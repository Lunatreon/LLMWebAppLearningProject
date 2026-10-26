# FeelY administration

The static administration page is available at `/admin.html`. Sign in with the configured
administrator credentials below, or with the username/email and password of a FeelY account
whose role is Admin. Admin login issues a separate bearer token and uses separate browser
storage. A normal user JWT is rejected by every protected admin endpoint, even for an Admin.

```env
ADMIN_USERNAME=""
ADMIN_PASSWORD_HASH=""
ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES=120
PROMPT_DIRECTORY="prompts"
```

Create or change administrator credentials with the backend image. From
repository-root PowerShell after building the Docker app:

```powershell
docker run --rm -it --entrypoint python --mount "type=bind,source=$($PWD.Path),target=/workspace" --workdir /workspace feely-local-backend scripts/set_admin_password.py --env-file .env.docker --username admin
docker compose --env-file .env.docker up -d backend
```

The command requests the password twice without echoing it and stores only a
PBKDF2 hash. Then open `/admin.html`. For a public server, use the matching image,
`.env.production` and preparation/recreation steps in
[server deployment](DEPLOYMENT_PRODUCTION.md). Linux bind mounts should use your
host UID/GID as shown there. Do not store a plaintext administrator password.

The page can:

- Edit a user's email, username, display name, active state, and verification state.
- Create accounts and assign Member, Test, or Admin roles.
- Change an existing account's role using the Account role selector.
- Set a new password without displaying the existing password or hash.
- Immediately cancel the locally associated Stripe subscription and save the canceled state,
  after the administrator types `REMOVE_SUBSCRIPTION`.
- Edit the Chat-LLM and Topic-LLM system prompts.

User password resets do not revoke already-issued user JWTs; those remain valid until their configured
expiration. Disabling the user invalidates their authenticated API access immediately because
each request reloads the user and checks `is_active`.

Member and Test accounts cannot use administration. Admin accounts can manage
users and prompts. Changing roles does not change subscriptions.
Roles are only writable through admin endpoints. Revoking the Admin role or disabling the
account immediately invalidates that account's admin access, including existing admin tokens.
The configured administrator login remains independent and can restore access.

Restart the backend after installing the role feature. Existing SQLite databases receive a
`users.role` column automatically; all existing users default to Member. For a separately
managed non-SQLite database, add a non-null `VARCHAR(16)` role column with default `member`
through your normal schema migration before starting the updated backend.

The editable prompt sources are:

- `prompts/chat_system.txt`
- `prompts/topic_system.txt`

The admin page saves through `PUT /api/v1/admin/prompts/{kind}`. The API restricts writes to these
three fixed filenames and uses a temporary file plus atomic replacement. The application reads the
appropriate UTF-8 file for every model request, so a saved edit is active on the next request
without restarting FastAPI or Ollama.

These files are the only source of truth for the model instructions. Prompt text is not duplicated
in Python code. Loading and saving live in `backend/llm/prompts.py`.
If a file is missing or empty, model requests fail with a prompt
configuration error; the admin editor shows an empty field so an administrator can restore and
save the prompt.

## Map category catalog

Use **Map categories** on `/admin.html` to add topic/entry kinds, change labels and
descriptions, enable completion tracking or control LLM availability. Keys remain
stable; disable categories instead of deleting ones used by saved records. Changes
apply to the next map load/model request. See [map storage](MAP_DATABASE_SCHEMA.md).
