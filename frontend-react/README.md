# FeelY frontend

This is the only consumer website. Login, registration, activation, recovery,
Account, billing, deletion, Feedback, Terms, Chat, My Map and Reflection
use the backend directly. There is no reference website server.

## Run the app

Use [Docker startup](../deployment/README.md). Compose builds and serves this
website together with the API and database; no host Node installation is needed.

## Frontend development

For live reload only, install Node 24 on the development machine. Generate the
Docker environment using the startup guide, then start the API services and Vite:

```sh
docker compose --env-file .env.docker stop frontend
docker compose --env-file .env.docker up -d --build --wait backend postgres mailpit
npm ci
npm run dev
```

Run the Compose commands from the repository root and npm commands from this
folder. Open http://127.0.0.1:5173. This optional editor workflow uses the same
Docker backend and database as the complete stack.

## Build and validation

```bash
npm test
npm run typecheck
npm run build
npm run format:check
```

The build produces dist/. The frontend Docker image serves it through Caddy. Vite preview is only for local build
review. VITE_API_BASE_URL is the only public build setting, defaulting to /api/v1
in production. Production ignores development query/storage API overrides.
Never put backend secrets in VITE settings.

## Files

- src/: React features, session state, API clients and tests.
- public/styles.css and public/assets/: shared styles and images.
- public/admin.* and public/webmail.*: standalone tools served by the same frontend.
  Production builds configure their public API base.
- public/legal/: draft and immutable terms snapshots. After publishing with
  scripts/publish_terms.py, rebuild/redeploy the frontend.

Account deletion requires explicit confirmation and the password when present.
Stripe checkout, portal and resume actions use authenticated backend endpoints.
Real provider operations require server-side configuration.

See ARCHITECTURE.md for feature boundaries.
