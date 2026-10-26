# Mail setup

Configure mail in your installation's environment file: `.env.docker` for local
Docker or `.env.production` on a server. There is no
separate mail configuration file or initialization command.

| Use | Setup |
| --- | --- |
| Local testing | Mailpit is included; open http://127.0.0.1:8025 |
| Account emails | Configure SMTP below |
| Read and reply inside FeelY | Configure SMTP and IMAP; open `/webmail.html` |
| Existing Cloudflare bridge | Use the [optional bridge](../deployment/mail/cloudflare/README.md) |

## Hetzner or another hosted mailbox

Create a mailbox with your provider. A Hetzner Cloud VM alone does not include
managed mail. These settings follow [Hetzner's account setup guide](https://docs.hetzner.com/managed/email/set-up-email-account/setting-up-an-email-account/).
For other providers, use their hostnames and credentials.

```env
SMTP_HOST=mail.your-server.de
SMTP_PORT=587
SMTP_USERNAME=info@example.com
SMTP_PASSWORD="your-mailbox-password"
SMTP_FROM_EMAIL=info@example.com
SMTP_USE_TLS=true
SMTP_USE_SSL=false
PUBLIC_APP_URL=https://app.example.com

# Optional shared administrator inbox:
WEBMAIL_ENABLED=true
WEBMAIL_PROVIDER=imap
WEBMAIL_ADDRESS=info@example.com
WEBMAIL_IMAP_HOST=mail.your-server.de
WEBMAIL_IMAP_PORT=993
WEBMAIL_IMAP_USERNAME=info@example.com
WEBMAIL_IMAP_PASSWORD="your-mailbox-password"
WEBMAIL_IMAP_FOLDER=INBOX
WEBMAIL_IMAP_USE_SSL=true
```

Replace the example address and password. Use addresses the SMTP account is
allowed to send as. Account emails use `SMTP_FROM_EMAIL`; webmail replies use
`WEBMAIL_ADDRESS`. A separate authorized noreply sender is optional.

## Local testing or your own mail server

The default Docker stack sends activation/reset messages to Mailpit. It captures
messages without delivering them to the internet; no provider account is needed.
The FeelY admin webmail page is a separate, optional shared inbox.

Your own mail server uses the same SMTP/IMAP settings with its reachable hostname
and credentials. FeelY is a mail client; it does not install a mail server or
configure its DNS. IMAP uses validated TLS: implicit TLS normally uses port 993;
for STARTTLS use `WEBMAIL_IMAP_USE_SSL=false` and the server's STARTTLS port
(normally 143). SMTP can also use implicit TLS on port 465 by setting
`SMTP_USE_SSL=true` and `SMTP_USE_TLS=false`.

In containers, `127.0.0.1` refers to the container itself. Use a hostname reachable
from the backend. Production requires encrypted SMTP and rejects loopback and
Mailpit delivery targets.

## Enable and verify

Once SMTP is configured, enable account email features:

```env
EMAIL_VERIFICATION_ENABLED=true
EMAIL_VERIFICATION_REQUIRED=true
PASSWORD_RESET_ENABLED=true
# Optional feedback notifications:
FEEDBACK_EMAIL_TO=info@example.com
```

Restart/recreate the backend after changing its environment. For production,
regenerate the filtered environment inside Docker using the preparation command
in [server deployment](DEPLOYMENT_PRODUCTION.md), then run its Compose startup
command again.

Register a test account, retrieve its activation PIN, and test password recovery.
Verify that the reset link opens your `PUBLIC_APP_URL`. For webmail, configure an
[administrator login](admin.md), open `/webmail.html`, check sync status and test
receiving an external message and replying. Check delivery at the recipient inbox.

Saved feedback remains in the admin inbox even if its notification email fails.
Sending is not automatically retried. See [webmail behavior](WEBMAIL_SETUP.md)
for mailbox limitations and backups.
