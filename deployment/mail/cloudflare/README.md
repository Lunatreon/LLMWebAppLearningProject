# Optional Cloudflare inbound bridge

Standard IMAP mailboxes do not need a Worker, R2, Wrangler or bridge secret.
Existing deployed URLs, secrets, buckets and database mail remain usable after
this folder move. Old env files without `WEBMAIL_PROVIDER` still select Cloudflare
when `WEBMAIL_WORKER_URL` is set. Set the provider explicitly for new setups.

1. Configure SMTP with [mail setup](../../../docs/EMAIL_SETUP.md).
2. In your backend environment set `WEBMAIL_ENABLED=true`,
   `WEBMAIL_PROVIDER=cloudflare` and `WEBMAIL_ADDRESS` to your mailbox.
3. Generate a random `WEBMAIL_BRIDGE_SECRET` of at least 32 characters, e.g.
   `python -c "import secrets; print(secrets.token_urlsafe(48))"`.
   Store it only in the private environment file.
4. Set `MAILBOX_ADDRESS` in `wrangler.toml` to match. Configure `account_id` if
   needed. Existing installations should keep their deployed Worker and bucket
   names. Enable R2 in the intended account and review its billing there.
5. Install Node/npm and authenticate with `npx --yes wrangler@4 login`.
6. From the repository root run:

   ```sh
   python deployment/mail/cloudflare/deploy.py --env-file .env.production
   ```

   The helper creates the bucket if absent, deploys the Worker and installs the
   secret through stdin. It does not configure DNS or routing.
7. Set `WEBMAIL_WORKER_URL` to the deployed HTTPS origin in the same env file.
   Route your mailbox to the Worker in Cloudflare Email Routing.
8. Regenerate the production backend environment if applicable and recreate the
   backend. Check sync status, incoming mail and reply delivery.

The Worker spools raw mail privately in R2. FeelY removes an object only after
committing its local copy. Mail waits there while FeelY is offline. Back up the
application database; the spool is not a backup. Disabling webmail does not stop
mail accumulating in R2; change routing separately when retiring this option.

Run checks with `node --test deployment/mail/cloudflare/worker.test.mjs`.
