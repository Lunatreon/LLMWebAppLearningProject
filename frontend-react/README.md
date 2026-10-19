# FeelY frontend

This is the only consumer website. Login, registration, activation, recovery,
Account, billing, deletion, Feedback, Terms, Chat, My Map and Reflection
use the backend directly. There is no reference website server.

## Development

Install Node 24. Run npm ci here once, start the backend on port 8000, then:

```bash
npm run dev
```

Open http://127.0.0.1:5173. PostgreSQL/native setup is in
[DEPLOYMENT_NATIVE.md](../docs/DEPLOYMENT_NATIVE.md).

## Build and validation

```bash
npm test
npm run typecheck
npm run build
npm run format:check
```

The build produces dist/. Native app.main serves it on port 8000 alongside the
API; production Caddy serves the same build. Vite preview is only for local build
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

See ARCHITECTURE.md for feature boundaries. Historical migration audits describe
the earlier reference-site phase; that site has now been removed.
