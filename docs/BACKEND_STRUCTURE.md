# Backend structure

`backend/main.py` creates the FastAPI application and owns its startup/shutdown.
Run it as `backend.main:app`. The root `main.py` and `backend/website.py` retain
compatibility entry points. See [the code guide](CODE_GUIDE.md) for request flow
and [database migrations](DATABASE_MIGRATION.md) for schema changes.

## Where code belongs

```text
backend/
  api/
    dependencies.py, router.py
    routes/              HTTP handlers, including the separate public website router
  schemas/               Pydantic request/response models
  services/              billing, usage, Map domain, Terms, email workflows, webmail
  llm/
    providers/           factory, OpenAI, Anthropic, Ollama, deterministic local provider
    tasks/               summaries, pattern/suggestion/topic helpers
    context.py, prompts.py, streaming.py, json_response.py, responses.py, types.py
  integrations/email.py  authenticated SMTP transport
  db/                    engine/session, datetime compatibility, local SQLite init, schema checks
  models/                existing SQLAlchemy declarations
  core/                  settings, security, middleware, CAPTCHA, rate limits
  main.py                API app/lifespan entry point
  website.py             public website app/middleware entry point
```

Routes depend on schemas and named services/tasks. Providers depend on shared LLM
infrastructure; model-facing tasks may use domain Map helpers. The Map service
does not call providers. Email workflows own token rules/composition and use the
SMTP integration; webmail retains durable delivery/acknowledgement ordering.
Use clear absolute imports, not a generic utils or repository framework.

`self_authorship.py` deliberately remains a service: it owns Map CRUD, accepted
profile fields and merge protection. Moving it wholesale into LLM infrastructure
would confuse authoritative user data with model suggestions. Database operations
stay in their existing routes/services; transaction boundaries are not relocated.
