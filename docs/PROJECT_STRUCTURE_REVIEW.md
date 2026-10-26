# Project structure review

Reviewed 2026-10-26 against the current working tree, including the existing
uncommitted `app/` to `backend/` rename. That work was preserved.

## Findings and changes

The main overhead was competing entry points in the documentation. The root
README mixed installation, provider configuration, endpoint listings and feature
design. The local Docker guide mixed current commands with long phase reports,
retired Journal references and an old claim that this machine lacked Docker.
The local stack also required a separate host frontend process.

- The root README now shows startup and the folder map first. Detailed settings
  and API flows live in `docs/FEATURES.md`.
- `STARTUP.md` is the everyday startup reference, with separate Docker, live reload
  and native paths. `docs/README.md` indexes the deeper guides.
- The optional `app` Compose profile builds React with the existing frontend
  Dockerfile and serves it through the existing Caddy proxy. The base three-service
  stack remains available for host Vite and the integration harness.
- `feely.bat` provides start, stop, status, logs and check actions. It uses the
  existing environment generator and preserves volumes on stop.
- Email setup guides moved from the root into `docs/`. Earlier inventories and
  Docker/frontend migration validation evidence moved to `docs/archive/`; Markdown
  links were updated, including references to removed website source paths.
- The code guide now follows the actual package layout and Alembic startup.
  The script index distinguishes setup, operator tools and validation tools.

## What is used

| Area | Evidence / decision |
| --- | --- |
| `backend/` modules | AST scan found a direct Python importer for every non-initializer backend module across runtime code, scripts, migrations and tests. This establishes references, not production execution coverage. No module was classified as safe to delete merely from naming. |
| `frontend-react/src/` | Active React application and tests. Feature folders separate chat, map, auth, terms, account, feedback and reflection. |
| `frontend-react/public/` | Active admin/webmail tools, shared styles, legal snapshots and images copied by the build. Both favicon paths are referenced by different HTML entry points. |
| `prompts/` | Loaded by prompt helpers; administrator editing is supported. Docker keeps edits in a named volume. |
| `docs/pattern_recognition.txt` | Runtime analyser input, explicitly copied by Docker. Its `.txt` extension and location do not make it disposable documentation. |
| `migrations/` | Alembic startup and data conversion require these files, including old revisions. |
| `deployment/` | Docker entrypoint, health checks, frontend proxy/build and integration probes. |
| `tests/`, frontend tests and validation scripts | Development/CI safety checks, excluded from the backend runtime image. |
| Root `main.py`, `backend/website.py` | Compatibility entry points; use `backend.main:app` for new API commands. Kept to avoid breaking external commands. |
| Python `__init__.py` files | Package boundaries and selected model exports; their small size is not evidence of redundancy. |

## Optional, with a clear purpose

| Area | Needed when |
| --- | --- |
| `cloudflare/webmail/`, `webmail.init.toml`, webmail scripts | Receiving mail through the optional Cloudflare integration |
| Cloudflared scripts and configuration | Opening a deliberately configured public tunnel |
| `compose.production.yml`, production config/CI tools | Preparing and rehearsing a real deployment |
| `compose.db.yml` | Running only PostgreSQL for a native backend; uses a separate database/volume |
| `start-feely.bat`, `scripts/start_feely.py` | Running without Docker |
| Isolated frontend servers and contract scripts | Browser/API contract verification |

These are not duplicate app implementations. Removing them would remove a supported
workflow. Their purpose is now indexed so a reader need not inspect them to start.

## Generated files and local data

`.venv/`, `node_modules/`, `dist/`, Python bytecode and test caches are reproducible
outputs covered by ignore rules. Logs are local diagnostic output. None is needed
in a source review; deleting dependencies simply means reinstalling them later.
No bulk filesystem deletion was performed.

`.env`, `.env.docker`, SQLite files and Docker volumes contain settings or data.
They were preserved. Switching startup methods does not migrate accounts or chats.
Historical audits are retained away from the onboarding path rather than destroyed.

## Remaining complexity

`backend/api/routes/llm.py` is about 1,120 lines; map rules in
`backend/services/self_authorship.py` and billing rules in
`backend/services/billing.py` are about 680 lines each. These are candidates for
focused future refactoring with behavior tests, rather than unused-file removal.
This pass changes startup/navigation and leaves domain algorithms intact.

Static references cannot prove that every branch or optional workflow is still
valuable. Removing supported features should be a separate product decision.

## Validation of this pass

- 72 targeted deployment, Docker harness, production configuration and frontend
  serving tests passed.
- The React production build passed, including TypeScript checks.
- Compose configuration validated with and without the `app` profile; the base
  mode resolves three services and the full app resolves four.
- VS Code tasks JSON parsed successfully. The Windows batch launcher avoids the
  machine's restrictive PowerShell script execution policy.
- All five batch launcher actions passed with a temporary mock Docker executable;
  the stop command was verified to preserve volumes. This checks command dispatch,
  not real container startup.
- The Markdown link scan found no broken local file links.
- Docker Desktop was launched, but its log reported `Virtual Machine Platform not
  enabled` and `No virtualization available`. A real container build/start and
  browser verification of this new local frontend profile could not be completed
  on this machine. No Windows feature or firmware settings were changed.
