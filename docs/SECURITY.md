# Server protections

Use [Docker startup](../deployment/README.md) locally and the
[production stack](DEPLOYMENT_PRODUCTION.md) on public servers.

- Local ports bind to loopback. Production exposes only Caddy on 80/443; API and
  PostgreSQL ports remain private.
- The backend runs as an unprivileged container user with a read-only root,
  dropped capabilities and bounded request sizes. Prompt edits use a named volume.
- Startup validates signing keys, database permissions, production origins and
  enabled integrations. Local setup generates random secrets. Preserve signing
  keys across updates; rotating them invalidates outstanding sessions/auth tokens.
- Production Uvicorn trusts forwarded headers only from the configured Caddy IP.
  Do not replace that bounded trust with a wildcard.
- Private endpoints authenticate accounts and enforce ownership. Public API docs
  are disabled by default. Rate limits cover HTTP, auth and model operations.
- The frontend image contains built public files, not repository configuration,
  databases or backend credentials. Never put secrets into public assets or VITE settings.
- CAPTCHA, SMTP delivery and model providers need valid production credentials.
  Optional Stripe and webmail integrations are disabled until configured.

Rate limits are in-process and reset on restart; they are not shared between
replicas. Keep dependencies updated and configure any external edge protections
for your own deployment. A Cloudflare tunnel or WAF is not required by this stack.
Back up the database, prompt edits and recovery configuration separately; see the
production guide. Keep private environment files and backups out of source control.
