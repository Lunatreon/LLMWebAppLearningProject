# FeelY email and test feedback

For the selected local webmail setup (read and reply as `info@feel-y.com` on the
backend machine), use [WEBMAIL_SETUP.md](WEBMAIL_SETUP.md). Its Cloudflare Worker
routing replaces the external-inbox forwarding option described below.

## Current setup

Cloudflare is the selected email provider. Authentication PINs and password-reset
links use `noreply@feel-y.com`, configured by `SMTP_FROM_EMAIL` in `.env`.
Website feedback is saved in the database and also emailed to `info@feel-y.com`
when `FEEDBACK_EMAIL_TO` is set. Notifications use the same noreply sender, with
Reply-To set to the submitting user's email address.

The 2026-10-03 live SMTP test authenticated successfully and Cloudflare accepted
outgoing test messages. The private R2 spool, mail Worker, incoming DNS, and
`info@feel-y.com` routing rule are deployed. See WEBMAIL_SETUP.md for verification
and recovery steps. Account email feature flags are configured separately.

Cloudflare manages sending and incoming forwarding, not a hosted mailbox UI.
The selected setup routes `info@feel-y.com` to the local webmail Worker. A separate
incoming rule for `noreply` is not required to send authentication messages.

## Hosting SMTP on the backend server

The backend already supports a local SMTP server; no application rewrite is
needed. The intended route is `backend -> local SMTP service -> recipient mail
server`, sending as `noreply@feel-y.com`. A mailbox UI is not required to send
password resets. Receiving replies and delivery failures needs a separate
mailbox or forwarding setup.

The Windows workspace inspection found no SMTP listener on ports 25, 465, or
587 and no Docker command on PATH. A usable WSL Linux installation was not
confirmed. No mail service has been installed or enabled by this guide.

Before choosing and installing a service, confirm these deployment requirements:

1. Identify the permanent backend machine and its operating system.
2. For direct delivery, use a stable public sending IP and confirm that the
   internet/server provider permits outbound TCP port 25 to recipient mail
   servers. Cloudflare Tunnel does not supply this outbound connection.
3. Ask the IP provider to set reverse DNS (PTR) to `mail.feel-y.com`, and create
   a matching DNS-only A record for `mail.feel-y.com` in Cloudflare. Ordinary
   Cloudflare web proxying does not carry SMTP. Keep the existing web/API routes.
4. Configure the mail server's hostname, durable outgoing queue, automatic
   startup, TLS, DKIM signing, and relay restrictions. Only the backend should
   be allowed to submit outgoing mail; never allow anonymous public relaying.
5. Publish SPF authorizing the actual sending IP, the server-generated DKIM
   public key, and DMARC. Merge with any existing SPF record instead of adding
   a second one. Do not invent a DKIM key or use the Cloudflare web proxy IP.
6. Arrange receipt of replies and bounces. If receiving locally, point the
   domain's MX to the DNS-only mail hostname and allow inbound port 25 through
   the router/firewall. If receiving elsewhere, retain that provider's MX.

See [Cloudflare mail DNS](https://developers.cloudflare.com/dns/manage-dns-records/how-to/email-records/)
and [Gmail sender requirements](https://support.google.com/mail/answer/81126?hl=en).
Authentication and reverse DNS are necessary delivery prerequisites, but do
not guarantee inbox placement.

After a local service has been configured to accept mail **only on loopback**,
this is a compatible backend configuration (port 2525 is an example listener
to configure on the service, not a service already running):

```env
SMTP_HOST="127.0.0.1"
SMTP_PORT=2525
SMTP_USERNAME=""
SMTP_PASSWORD=""
SMTP_FROM_EMAIL="noreply@feel-y.com"
SMTP_USE_TLS=false
SMTP_USE_SSL=false
PUBLIC_APP_URL="https://app.feel-y.com"
```

This unauthenticated, unencrypted example is restricted to the same machine's
loopback interface. For a connection across machines, configure authenticated
SMTP with validated TLS instead. If running SMTP in a VM/container, verify
the actual network boundary and restrict the published listener accordingly.

If the connection cannot meet the direct-delivery requirements, a local SMTP
service can instead queue mail and forward it through an authenticated external
SMTP relay on port 465/587. That keeps a service on this machine, but final
delivery is handled by the relay. The existing backend can also use that relay
directly, as described below.

Keep account email features disabled until a real test message has arrived at
an inbox you control and its SPF/DKIM/DMARC results have been checked. Then
follow **Enable and check delivery**. Never substitute a development mail
catcher for real delivery: it captures reset messages instead of sending them.

## Cloudflare setup for feel-y.com

The local `.env` is prepared for Cloudflare SMTP on `smtp.mx.cloudflare.net:465`,
with `SMTP_USERNAME="api_token"`, `SMTP_USE_SSL=true`, and `SMTP_USE_TLS=false`.
An API token is stored locally and passed the last authentication test.
Complete domain onboarding before attempting production delivery.

For incoming mail, open **Compute > Email Service > Email Routing**, onboard
`feel-y.com`, and add your existing inbox under **Destination Addresses**.
Verify it using Cloudflare's email. Create a routing rule for `info@feel-y.com`
with **Send to an email** and that verified destination. This forwards messages
to your existing inbox; it does not provide a separate hosted inbox.
See [Cloudflare's routing guide](https://developers.cloudflare.com/email-service/get-started/route-emails/).

For activation and password-reset emails, onboard `feel-y.com` under
**Compute > Email Service > Email Sending**. Sending to arbitrary users requires
the **Workers Paid** plan; review the cost in your account before subscribing.
See [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

Create a Cloudflare API token with **Email Sending: Edit** for the relevant
account and store it as `SMTP_PASSWORD` in the backend `.env`. Do not paste it
into chat. The SMTP username stays the literal `api_token`. Once configured,
follow **Enable and check delivery** below. See
[Cloudflare's SMTP documentation](https://developers.cloudflare.com/email-service/api/send-emails/smtp/).

## Alternative mail provider

1. In the mail provider that handles `feel-y.com`, authorize `noreply@feel-y.com`,
   or use an existing mailbox/alias with permission to send as this address.
   Buying a domain or hosting the website does not itself configure this mailbox.
2. Complete the provider's domain verification and apply its supplied mail DNS
   records. Use the provider's exact values; do not guess them or replace existing
   mail records without checking the current mail setup.
3. Obtain the provider's SMTP host, port, username, and SMTP/app password.
   Enter them only in the backend's `.env` or deployment secret settings.
   Do not place credentials in the frontend or commit them.

```env
SMTP_HOST="your-provider-smtp-host"
SMTP_PORT=587
SMTP_USERNAME="your-provider-smtp-username"
SMTP_PASSWORD="your-provider-smtp-password"
SMTP_FROM_EMAIL="noreply@feel-y.com"
SMTP_USE_TLS=true
SMTP_USE_SSL=false
PUBLIC_APP_URL="https://app.feel-y.com"
```

For a provider using implicit TLS on port 465, use `SMTP_PORT=465`,
`SMTP_USE_SSL=true`, and `SMTP_USE_TLS=false`. Certificate validation is enabled.

## Enable and check delivery

After connecting the provider, set:

```env
EMAIL_VERIFICATION_ENABLED=true
EMAIL_VERIFICATION_REQUIRED=true
EMAIL_VERIFICATION_PIN_EXPIRE_MINUTES=15
EMAIL_VERIFICATION_MAX_ATTEMPTS=5
PASSWORD_RESET_ENABLED=true
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES=60
```

Restart the backend and refresh the website. Use a test email address you own:

1. Register and check that the email arrives from `noreply@feel-y.com` with a
   six-digit PIN. Enter it in **Activate your account** and then log in.
2. Sign out, select **Forgot your password?**, and open the emailed reset link.
   Confirm that it opens `https://app.feel-y.com`, set a new password, and log in.
3. Check delivery to the inbox/spam folder and verify that the PIN and reset
   link cannot be used a second time.

If sending an activation email fails, the account stays pending. Reopen
**Activate account / enter email PIN** and choose **Send a new PIN** once mail
delivery is repaired. A resend replaces the previous code. Three resend
requests per email per hour are allowed. Incorrect PIN attempts persist in
the database; restarting the server does not clear the five-attempt limit.

Already-verified accounts remain usable. Enabling verification also protects
authenticated API requests from unverified accounts. Google sign-in accepts
an email that Google has verified without requiring a second PIN.

The backend creates the feedback table and adds the PIN attempt column
automatically for existing SQLite databases on restart. If using another
database engine, apply an equivalent migration for
`users.email_verification_attempts` (integer, non-null, default 0) before startup.

## Read feedback and turn it off

`FEEDBACK_ENABLED=true` shows **Share test feedback** in the signed-in sidebar.
Open `/admin.html`, sign in as an administrator, and use **Feedback inbox**.
Messages are stored in the application's database, including the sender's email
through their account, category, and submission time. With
`FEEDBACK_EMAIL_TO="info@feel-y.com"`, the backend also attempts an email
notification after saving. No chat text is attached. Delivery is best effort:
there is no durable email queue or automatic retry, and a restart can interrupt
pending notifications. Failures are logged without user content or credentials;
read the admin inbox for the complete record. Clear `FEEDBACK_EMAIL_TO` to
stop notifications while keeping the feedback form available. Database feedback is removed when its author deletes their account. Emailed
copies remain in the recipient mailbox and must be managed there separately.

Set `FEEDBACK_ENABLED=false` and restart the backend to close submissions.
Refresh the website to hide the button. Existing feedback stays in the admin
inbox. Back up the application database if you need to retain test feedback.
