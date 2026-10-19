# Android clients and AGB acceptance

The website and a native FeelY Android app can use the same backend at
`https://api.feel-y.com/api/v1`. They share accounts, chats, quotas,
subscriptions, and terms history. A separate product needing isolated users or
data should use a separate backend deployment/database; this backend has no
application/tenant isolation. Client package names are metadata, not authorization.

## Android configuration

Set `ANDROID_APP_ENABLED=true` and optionally `ANDROID_PACKAGE_NAME` in the backend
`.env`, then restart. `GET /api/v1/auth/android/config` returns public configuration
and endpoint paths. Disabling this discovery flag hides advertised login methods;
it does not block native callers from the shared API. No secrets are returned.

Email/password login already works with JSON:

```http
POST /api/v1/auth/login
Content-Type: application/json

{"email_or_username":"person@example.com","password":"user-entered-password"}
```

Use the returned access token as `Authorization: Bearer <access_token>` on user
requests. Tokens expire after the configured lifetime; there is currently no
refresh-token endpoint. Protect tokens using Android secure storage backed by
Keystore, and clear them on sign-out. Never embed server secrets or SMTP tokens
in the APK. Use HTTPS. Native HTTP clients do not require a browser CORS origin.

Registration uses the existing `/auth/register` endpoint with `email`, `username`,
and `password`. If CAPTCHA is enabled, it still requires a valid `captcha_token`;
when terms are published, registration also requires `terms_accepted: true`,
`terms_version` and `terms_document_sha256` from `/terms/config`, after explicit user consent;
native clients do not bypass it. Integrate the existing hosted registration flow
or an appropriate browser-based Turnstile flow before shipping Android signup.
Email verification uses the same six-digit PIN endpoints. Password reset links
currently open `PUBLIC_APP_URL` in the website; Android app links are not configured.

## AGB acceptance

Edit and publish the document using [AGB_SETUP.md](AGB_SETUP.md). The website now
requires explicit acceptance after sign-in once a document is configured. The
backend also enforces acceptance for app features. Existing users are never marked
as having accepted automatically. Privacy and marketing consent remain separate.

After publishing an immutable document, configure:

```env
TERMS_VERSION="2026-10-04-v1"
TERMS_DOCUMENT_URL="https://your-domain.example/legal/agb/2026-10-04-v1.pdf"
TERMS_DOCUMENT_SHA256="<64 lowercase hexadecimal characters>"
```

The hash must be computed from the exact document bytes, e.g. using
`Get-FileHash -Algorithm SHA256` and converting the result to lowercase.
Keep each published version accessible. Always assign a new version for changed
content. The backend stores your configured hash; it does not download or
independently validate the document at the URL.

Client flow after sign-in (and email verification, if required):

1. `GET /api/v1/terms/config` returns the current version, URL and hash, or
   `configured=false` while publication is pending. `enforced=true` when a
   document is configured. Native clients must handle HTTP 423 by showing terms.
2. `GET /api/v1/terms/me` with the user's bearer token returns their acceptance
   history and `accepted_current`.
3. Display the document and an unchecked acceptance control. Only after explicit
   user action, `POST /api/v1/terms/accept` with their bearer token:

   ```json
   {"accepted": true, "version": "2026-10-04-v1", "client": "android"}
   ```

`client` may be `web`, `android`, or `api`; it is self-reported metadata. The
authenticated user ID, document URL/hash, and UTC acceptance timestamp come from
the server. Users cannot record acceptance for another account or set timestamps.
Repeating an acceptance preserves the first timestamp. A new version creates a
new historical record; stale versions return 409. False acceptance is rejected,
and requests before document setup return 503.

The `terms_acceptances` table is created on backend startup for both new and
existing databases. No existing user rows need alteration. Records are removed
when the user's account is deleted. Preserve/adjust this behavior if a future
retention requirement calls for a different policy. These records do not by
themselves establish legal sufficiency.
