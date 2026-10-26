# FeelY webmail on the backend machine

## Deployment status (2026-10-03)

The private `feely-mail-spool` bucket and `feely-mail-bridge` Worker are deployed.
Email Routing is enabled for `feel-y.com`; the exact `info@feel-y.com` rule sends
to that Worker. The live bridge URL is recorded in `webmail.init.toml`.
SMTP accepted setup messages to the local mailbox and the owner's test inbox.
The backend has been restarted and reports successful incoming synchronization.
SMTP acceptance alone does not prove final delivery; use the checks below.

Open `https://app.feel-y.com/webmail.html` and use your existing FeelY
administrator login. There is no new mailbox password. All FeelY administrators
can access this shared mailbox. Authentication tokens stay in browser memory;
refreshing or closing the page signs you out.

The backend serves an inbox, sent messages, plain-text compose/reply, read state,
trash, original-message export, and incoming attachment downloads. It sends as
`info@feel-y.com`. Account activation and password resets retain
`noreply@feel-y.com`. Outgoing attachments and rich-text composing are not included.
Incoming HTML is converted to text; scripts and remote tracking images are not
rendered. Sender headers are untrusted claims, not proof of identity.

## Architecture

```text
Incoming sender -> Cloudflare Email Routing -> Email Worker -> private R2 spool
                                                           |
                  Backend polls over HTTPS every 60 seconds <+
                  -> local database commit -> delete R2 copy

Browser -> existing FeelY website/API tunnel -> local mailbox
Local mailbox -> Cloudflare SMTP -> recipient
```

The inbox and sent copies live in the application's database on this machine.
R2 retains incoming messages while the machine is offline, with no automatic
expiry. It is temporary cloud storage, not a second mailbox provider. Enable R2
in the same Cloudflare account; storage, operations, and Worker usage may incur
charges under that account's pricing. Review Cloudflare's billing before enabling
R2. Do not make the bucket public or add an automatic deletion lifecycle rule.

The Worker awaits an R2 write before completing incoming processing. The backend
only acknowledges an object after committing it locally. Repeated pulls of the
same object are deduplicated. Separate upstream deliveries can still produce
duplicate messages. Cloudflare availability, filtering, and message size limits
still apply; this is not a guarantee against every delivery failure.

No fixed IP, inbound SMTP port, Gmail account, or Hetzner server is needed.
Webmail uses the existing `app.feel-y.com` and `api.feel-y.com` routes. A separate
`mail.feel-y.com` hostname is optional and is not provisioned by this setup.

## Initialize this machine

Prerequisites: the existing FeelY backend environment, SMTP configuration, and
administrator login. Install Python dependencies using the main README first.

Edit the non-secret [webmail.init.toml](../webmail.init.toml), then run from the repo:

```powershell
.\.venv\Scripts\python.exe scripts\init_webmail.py
```

The initializer enables webmail, configures the mailbox and sender addresses,
and generates `WEBMAIL_BRIDGE_SECRET` in `.env` if missing. It preserves that
secret on subsequent runs, along with your SMTP token and administrator password.
An empty `worker_url` leaves incoming sync unconfigured and visibly reported in
webmail. The initializer does not purchase services, modify DNS, send messages,
enable authentication emails, or create an operating-system startup service.
The mail poller starts and stops with the existing backend process.

## Deploy the Cloudflare bridge

1. Complete Email Sending onboarding for `feel-y.com`. Keep the working SMTP
   token in `.env`; this token alone does not grant Worker/R2 deployment access.
2. Enable R2 in your Cloudflare account. Install Node.js with npm on this machine.
3. Authenticate Wrangler interactively:

   ```powershell
   npx.cmd --yes wrangler@4 login
   ```

4. Review `cloudflare/webmail/wrangler.toml`. For a different mailbox, update
   `MAILBOX_ADDRESS` there as well as `webmail.init.toml`. If you have multiple
   Cloudflare accounts, set the intended `account_id` at the top of wrangler.toml.
   For a new account, first register a unique workers.dev subdomain under
   Workers & Pages. The current account uses `feely-services-3dfac94f.workers.dev`.
5. Run the deployment helper:

   ```powershell
   .\.venv\Scripts\python.exe scripts\deploy_webmail.py
   ```

   It lists your buckets, creates `feely-mail-spool` only if absent, deploys the
   Worker, and uploads the bridge secret from `.env` through stdin. Never paste
   the secret or SMTP token into chat. The endpoint refuses requests until the
   bridge secret is installed. Re-running deployment preserves stored mail.
6. Copy the deployed `https://feely-mail-bridge.<your-subdomain>.workers.dev`
   URL into `worker_url` in `webmail.init.toml`, then rerun the initializer.
7. Under **Compute > Email Service > Email Routing**, onboard `feel-y.com` and
   apply Cloudflare's mail DNS records. Create a rule for **info@feel-y.com** with
   action **Send to a Worker**, choosing **feely-mail-bridge**. Replace any old
   forwarding rule for that address. Do not route `noreply` or a catch-all here.
8. Restart FeelY using your usual launcher. Webmail needs no separate process.

Linux equivalents use `.venv/bin/python` and `npx` rather than Windows paths.

## Validate before relying on the inbox

1. Sign in at `/webmail.html`. Confirm the incoming-sync status shows a recent
   successful check instead of a configuration error.
2. Send a message from an external address to `info@feel-y.com`, including a
   small attachment. Within roughly a minute it should appear in Inbox.
3. Open it, download the attachment, and reply. Verify the reply arrives from
   `info@feel-y.com` and appears in Sent. Check inbox/spam and authentication
   results at the receiving provider.
4. Stop the backend, send another test, and check it waits in the private R2
   bucket. Start the backend; verify local arrival and removal of the cloud copy.
5. Submit website feedback and check its notification arrives. Reply should use
   the submitting user's Reply-To address.

Sent means the SMTP server accepted a message, not guaranteed inbox delivery.
Unconfirmed means sending raised an error; Pending may mean a process stopped
during sending. Both retain the original message. Check Cloudflare delivery logs
before manually resending to avoid duplicates. Outgoing messages are not retried
automatically. Existing feedback notifications also remain best effort.

## Move to another machine and back up

Stop the old backend before moving; run one active mail poller for this mailbox.
Copy the repository, your application database, and `.env` securely to the new
machine. Recreate the Python environment and run the initializer with the same
config. Keep the same Worker URL and bridge secret, so no redeployment is needed.
Configure the existing Cloudflare tunnel credentials/path for the new machine
according to `scripts/CLOUDFLARED_README.md`. Start the backend normally.

Back up the database while the backend is stopped, or use a consistent database
backup tool. Incoming mail and attachments are stored as raw MIME in
`mail_messages`; R2 copies are deleted after local commit and are not backups.
Protect the disk, `.env`, and backups using OS access controls and encryption.
Trash is retained locally; there is no permanent-delete or retention scheduler.
Mail copies, including feedback notifications, are independent of app account
deletion. Manage their retention as team correspondence.

To disable the page and polling, set `WEBMAIL_ENABLED=false` and restart. Mail
will still accumulate in R2 until you change the Cloudflare routing rule.

References: [Email Workers](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/),
[R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
[R2 pricing](https://developers.cloudflare.com/r2/pricing/).
