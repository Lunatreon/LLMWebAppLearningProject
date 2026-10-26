# Mail

Start with [mail setup](../../docs/EMAIL_SETUP.md). Local tests use the Mailpit
service in `compose.yml`. Hetzner, other hosted mailboxes and your own mail server
use the backend's SMTP/IMAP client without extra configuration files.

`cloudflare/` contains the optional inbound Worker/R2 bridge, deployment helper
and tests. Use it only when choosing Cloudflare instead of IMAP.
