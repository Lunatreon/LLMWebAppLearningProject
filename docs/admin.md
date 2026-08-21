# FeelY administration

The static administration page is available at `/admin.html`. It has its own username, password,
login endpoint, bearer token, and browser storage key. It does not use or correspond to a FeelY
user account. A normal user JWT is rejected by every protected admin endpoint.

```env
ADMIN_USERNAME=""
ADMIN_PASSWORD_HASH=""
ADMIN_ACCESS_TOKEN_EXPIRE_MINUTES=120
PROMPT_DIRECTORY="prompts"
```

Create or change the administrator credentials interactively:

```powershell
.\.venv\Scripts\python.exe scripts\set_admin_password.py --username admin
```

The command requests the password twice without echoing it and saves only a PBKDF2 hash. Restart
FastAPI afterward, then open `/admin.html`. Do not add a plaintext admin password to `.env`.

The page can:

- Edit a user's email, username, display name, active state, and verification state.
- Set a new password without displaying the existing password or hash.
- Immediately cancel the locally associated Stripe subscription and save the canceled state,
  after the administrator types `REMOVE_SUBSCRIPTION`.
- Edit the Chat-LLM and Topic-LLM system prompts.

User password resets do not revoke already-issued user JWTs; those remain valid until their configured
expiration. Disabling the user invalidates their authenticated API access immediately because
each request reloads the user and checks `is_active`.

The editable prompt sources are:

- `prompts/chat_system.txt`
- `prompts/topic_system.txt`

The admin page saves through `PUT /api/v1/admin/prompts/{kind}`. The API restricts writes to these
two fixed filenames and uses a temporary file plus atomic replacement. The application reads the
appropriate UTF-8 file for every model request, so a saved edit is active on the next request
without restarting FastAPI or Ollama.

These files are the only source of truth for the model instructions. Prompt text is not duplicated
in `app/services/llm.py`. If a file is missing or empty, model requests fail with a prompt
configuration error; the admin editor shows an empty field so an administrator can restore and
save the prompt.
