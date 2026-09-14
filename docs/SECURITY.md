# Public server protections

The September 2026 scan probed environment files, credentials, file traversal,
command execution, and cloud metadata. Its only successful response in the
provided excerpt was API documentation. A separate configuration review found
the example JWT signing key still in use. That key has been replaced locally;
this is not evidence that a forged token was used.

Restart the backend, website, and tunnel using STARTUP.md to activate changes.
Every user and administrator must sign in again after the signing-key rotation.
Do not continue exposing an old backend process with the example key in memory.

## Controls

- Startup rejects the example signing key and keys shorter than 32 characters,
  even in local mode. First-time installs run `scripts/setup_secret.py`.
- All HTTP paths, including missing paths and preflights, are limited per client
  IP (300/minute per process by default). API, login, account, and LLM limits
  still apply. Changing User-Agent does not give a new allowance. Limiter state
  expires and has a bounded number of tracked identities.
- Uvicorn trusts forwarded headers only from the loopback tunnel proxy in the
  supplied startup commands. The application ignores raw forwarded headers;
  the legacy TRUST_PROXY_HEADERS setting no longer changes this behavior.
  Keep both listeners bound to 127.0.0.1 and never use a wildcard proxy trust.
- Request bodies are limited by actual received bytes, including chunked
  requests. The default limit is 128,000 bytes. Responses can still stream.
- Private API routes require authenticated accounts and enforce ownership.
  Responses use Cache-Control: no-store. Public API docs are disabled by default;
  disabling documentation is not a substitute for authorization.
- The website runs `app.website:app`, not Python's development file server.
  Only the explicit PUBLIC_FILES set can be served, with resolved-path checks.
  No directory listings, environment files, databases, logs, or arbitrary new
  files are exposed. Add intended new website assets to that set deliberately.
- The tunnel's development hostname returns 404 rather than reaching port 5501.

## Cloudflare edge protection

Account-side WAF settings were not changed by the repository patch. Review
Security rules for feel-y.com and verify the applicable managed ruleset is
enabled. Cloudflare documents a Free Managed Ruleset for all plans:
https://developers.cloudflare.com/waf/managed-rules/

Keep API and app traffic proxied through the tunnel. Avoid interactive browser
challenges on all API requests: they can disrupt API clients and Stripe-signed
webhooks. Use Cloudflare Access for a development hostname before exposing a
development server again.

## Limits of this change

In-process limits reset on restart and are not shared across workers or machines.
They do not stop a distributed flood before traffic reaches this PC. Edge rules
and maintained dependencies remain necessary. Public registration is still open
and CAPTCHA remains disabled in this installation; enabling it needs real
Turnstile credentials. Application authentication protects private records;
these controls do not make the entire PC or application immune to attack.

Local evidence and tests do not establish whether there was historical account
access. Preserve logs if an unfamiliar account action is discovered. Keep .env,
database files, backups, and tunnel credentials out of website/ and source control.
