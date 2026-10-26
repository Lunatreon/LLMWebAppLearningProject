# Script index

Run commands from the repository root. Everyday Docker startup is
`.\feely.bat start`; [startup](../STARTUP.md) explains all lifecycle commands.
Most files below are occasional operator or validation tools, not services that
need to run alongside FeelY. Use `--help` for Python tools with command-line options.

## Local setup

| File | Purpose |
| --- | --- |
| `setup_docker_env.py` | Generate `.env.docker` without overwriting an existing file; used by the Docker launcher |
| `start_feely.py` | Native React build + Uvicorn launcher; called by `start-feely.bat`; optional `--tunnel` |
| `setup_secret.py` | Set up the native signing secret; preserve existing installation secrets |
| `set_admin_password.py` | Configure an administrator hash; defaults to native `.env`, accepts `--env-file` |

## Data, production and publishing

| File | Purpose / guide |
| --- | --- |
| `database_migration.py` | Check, copy and verify SQLite-to-PostgreSQL data; [data migration](../docs/DATABASE_MIGRATION.md) |
| `migrate_chat_storage.py` | Upgrade legacy SQLite chat storage with backup; [chat storage](../docs/CHAT_STORAGE.md) |
| `production_config.py` | Validate production settings and prepare the filtered backend env; [production](../docs/DEPLOYMENT_PRODUCTION.md) |
| `publish_terms.py` | Publish immutable legal snapshots; [Terms publishing](../docs/AGB_SETUP.md) |
| `init_webmail.py`, `deploy_webmail.py` | Optional webmail configuration/deployment; [webmail](../docs/WEBMAIL_SETUP.md) |
| `install_cloudflared.ps1`, `setup_tunnel_template.ps1`, `cloudflared-public.yml` | Optional public tunnel; [tunnel guide](CLOUDFLARED_README.md) |

## Validation only

| File | Purpose |
| --- | --- |
| `docker_integration.py` | Disposable base-stack rehearsal: config/build/runtime/mail/persistence/log/cleanup checks; actions `prepare`, `config`, `build`, `run`, `diagnostics`, `cleanup` |
| `validate-local-stack.mjs` | Exercise real backend flows through frontend API clients; used by Docker integration |
| `production_ci.py` | Disposable production-stack rehearsal; [production guide](../docs/DEPLOYMENT_PRODUCTION.md) |
| `run_postgres_contract.py` | Run the isolated frontend contract server in a disposable PostgreSQL schema; requires `FEELY_TEST_POSTGRES_URL` naming a dedicated `_test` database |
| `create_deployment_snapshot.py` | Generate synthetic migration test data; does not back up a real installation |

Integration rehearsal tools create and remove their own resources. Read their
guide and `--help` before running them; they are not the everyday launcher.
Earlier Docker rehearsal procedures are preserved in
[validation history](../docs/archive/DOCKER_VALIDATION_HISTORY.md).

`frontend-react/scripts/` contains isolated auth servers and browser contract
validation tools. Those support frontend verification and are not runtime dependencies.
