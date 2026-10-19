# Production smoke checklist

Run after configuring a real deployment, not as an unattended CI call to paid
providers. Use a dedicated operator-controlled mailbox and new smoke account.
Record the release/commit, time, frontend/API origins, outcomes and created record
identifiers privately. Do not record passwords, JWTs, CAPTCHA tokens, PINs, reset
tokens, full mail bodies or private Chat contents in shared logs.

Keep real production CAPTCHA, email verification and rate limits enabled. A smoke
creates disposable account-owned data but never deletes existing users/data or
resets volumes. Do not use account-deletion/billing-purchase actions in this check.

1. **Health:** check public `https://<ingress-domain>/api/v1/health` returns 200 and
   `{"status":"ok"}`. Confirm all required services are healthy and internal
   `python -m deployment.healthcheck` succeeds. Check HTTP redirects to HTTPS and
   the certificate matches the real domain.
2. **Registration:** open the real React `/register`, complete Turnstile on the
   real hostname, review the configured Terms and register the smoke mailbox.
   Confirm the account awaits activation and no unverified JWT is granted.
3. **Activation email:** receive mail through the real SMTP provider, confirm the
   sender, PIN instructions and expiration. No loopback/dev-port URLs may appear.
   Do not copy the PIN into a ticket or shared terminal transcript.
4. **Activation:** enter the code in React `/activate`; verify success, separate
   login behavior and single-use rejection if manually retried. If the code did
   not arrive, use the existing resend flow without repeatedly hitting its limits.
5. **Login:** log in with the smoke account. Verify its own Account details and
   that protected pages reject a separate unsigned-in browser session.
6. **Terms:** verify the intended document/version and acceptance state. Confirm
   Terms review works without a frontend reload or direct document/key leakage.
7. **Chat:** create a conversation and one harmless synthetic message. Confirm
   status/text/result NDJSON delivery and saved history after reload. OpenAI's
   current adapter delivers completed assistant text, not token-by-token upstream
   streaming. Cancel a separate synthetic generation and confirm ownership/draft
   handling; provider billing may already have begun even if a client cancels.
8. **Map:** create a topic and a Practice, then reload and verify both.
9. **Reflection:** complete that Practice with a short reflection; verify the
    completion/reflection remains attached to the same entry after reload.
10. **Recovery email:** log out and request a password reset for the smoke
    mailbox. Verify real delivery, sender and that the link origin exactly matches
    `PUBLIC_APP_URL`, with no localhost, 127.0.0.1, :5500 or :5173.
11. **Reset:** open the link in React, confirm token scrubbing and reset with a
    new password. Check success without exposing the token in screenshots/logs.
12. **Logout/login:** verify the new password works, Account identity is the same
    and logout clears private session state. Verify the old password/reset token
    are rejected without repeatedly consuming auth limits.
13. **Restart persistence:** during an approved operational window, restart only
    the backend normally (`docker compose ... restart backend`), wait for bounded
    readiness, log in again and reread the recorded Chat, Map/Reflection
    records. Do not run `down -v`, reset a database or delete records for this test.

Also inspect browser console/network for missing assets, CORS/mixed-content errors,
SPA refresh failures on `/login`, `/activate`, `/reset-password` and
`/map`, and unknown-host handling. Confirm reference Account navigation loads at
`/reference/?view=account&api_base=...` without putting a JWT in the URL. Test
historical verification links via the retained reference frontend if any remain
in use; request a new PIN if their original expiration has passed.

Afterward review container logs privately for errors and accidental secret/private
content exposure. Record only outcomes and resource IDs. Billing return/deletion
parity and browser layout checks remain separate targeted checks before enabling
those delegated production actions. Consult [the deployment guide](DEPLOYMENT_PRODUCTION.md)
for backup/restore/update/rollback procedures.
