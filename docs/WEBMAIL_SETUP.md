# Administrator webmail

Configure SMTP and IMAP with [mail setup](EMAIL_SETUP.md). Open `/webmail.html`
on your FeelY website and sign in with the administrator account. All
administrators share this mailbox. Refreshing signs you out.

The page provides inbox/sent messages, plain-text compose/reply, read state,
trash, original-message export and incoming attachment downloads. Incoming HTML
is converted to text; scripts and remote images are not rendered. Outgoing
attachments and rich-text composing are not supported.

Mail is checked every 60 seconds while the backend runs. Run one active poller
per mailbox. IMAP imports the configured folder, including existing messages on
first sync. Imports are deduplicated by server, account, folder, UIDVALIDITY and
UID. Changing these settings or a provider UID reset can import messages again.

IMAP import is read-only. Read/trash actions apply only to FeelY's database copy;
sent copies also live only in FeelY. Other mail clients do not see these local
changes. Messages larger than 25 MiB stop synchronization with a visible error;
move such messages out of the imported folder at the provider before retrying.

SMTP acceptance does not guarantee delivery. Pending/uncertain messages remain
local; check provider delivery records before resending. There is no automatic
outgoing retry.

Back up the application database: `mail_messages` contains mail and raw attachments.
Protect credentials and recovery configuration separately. Provider originals do
not back up local sent messages or read/trash state. There is no permanent-delete
or automatic retention scheduler. Mail copies are independent of app account deletion.

Set `WEBMAIL_ENABLED=false` and restart/recreate the backend to stop polling and
disable the API. Local mail is preserved; provider routing is unchanged. Existing
Cloudflare users can retain the [optional bridge](../deployment/mail/cloudflare/README.md).
