# Script index

Run commands from the repository root. Everyday Docker startup is
`docker compose --env-file .env.docker up -d --build --wait`;
[Docker startup](../deployment/README.md) explains setup and lifecycle commands.
Most files below are occasional operator or validation tools, not services that
need to run alongside FeelY. Use `--help` for Python tools with command-line options.

## Administration

| File | Purpose |
| --- | --- |
| `set_admin_password.py` | Configure an administrator hash; writes the selected env file with `--env-file`; run inside the backend image |

## Data, production and publishing

| File | Purpose / guide |
| --- | --- |
| `database_migration.py` | Check, copy and verify SQLite-to-PostgreSQL data; [data migration](../docs/DATABASE_MIGRATION.md) |
| `migrate_chat_storage.py` | Upgrade legacy SQLite chat/map storage with backup; [chat storage](../docs/CHAT_STORAGE.md) |
| `publish_terms.py` | Publish immutable legal snapshots; [Terms publishing](../docs/AGB_SETUP.md) |
| `../deployment/mail/cloudflare/deploy.py` | Optional Cloudflare bridge only; configure ordinary mail in your env file; [mail setup](../docs/EMAIL_SETUP.md) |

| `database_schema.py` | Generate the complete Markdown/SQL schema reference from metadata; [schema review](../docs/DATABASE_REVIEW.md) |

## Validation only

| File | Purpose |
| --- | --- |
| `docker_integration.py` | Disposable full-stack rehearsal: config/build/runtime/mail/persistence/log/cleanup checks; actions `prepare`, `config`, `build`, `run`, `diagnostics`, `cleanup` |
| `validate-local-stack.mjs` | Exercise real backend flows through frontend API clients; used by Docker integration |
| `production_ci.py` | Disposable production-stack rehearsal; [production guide](../docs/DEPLOYMENT_PRODUCTION.md) |
| `run_postgres_contract.py` | Run the isolated frontend contract server in a disposable PostgreSQL schema; requires `FEELY_TEST_POSTGRES_URL` naming a dedicated `_test` database |
| `create_deployment_snapshot.py` | Generate synthetic migration test data; does not back up a real installation |

Integration rehearsal tools create and remove their own resources. Read their
guide and `--help` before running them; they are not the everyday launcher.

`frontend-react/scripts/` contains isolated auth servers and browser contract
validation tools. Those support frontend verification and are not runtime dependencies.
