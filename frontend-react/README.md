# FeelY React frontend

Production build/deployment configuration is documented in
[DEPLOYMENT_PRODUCTION.md](../docs/DEPLOYMENT_PRODUCTION.md). The public
`.env.production.example` defaults to same-origin `/api/v1` and `/reference/`.
Production rejects localhost/HTTP build destinations and ignores development
query/storage API overrides. Billing/deletion still require the retained reference
frontend; Caddy's production image includes it without changing legacy sources.

This is a separate React + TypeScript + Vite application. The working vanilla
frontend remains in `../website/`. All existing frontend and backend files are
unchanged. The React shell now includes the original sidebar structure, workspace
navigation, responsive drawer, appearance controls, original CSS and fonts.
The API/session foundation, sign-in, registration, activation/resend, recovery/reset,
Account password change, Feedback, Terms review/acceptance
and account/profile reading/editing, Journal, My Map, Practice Reflection and Chat are now real. Feature dialogs use shared controlled React dialog primitives. Billing and
deletion actions still use the unchanged reference frontend.

React restores the original `feely_token` JWT from its own origin, validates it
against the existing API, loads account/capability/terms/feedback configuration,
and provides authenticated Feedback submissions. Session failures have explicit
loading, unauthenticated or error states. No fake production session remains.
Sign in at `/login` using an existing account, or create an account at `/register`.
Activate email at `/activate`, or recover access at `/forgot-password`.
Change your password in React Account. Billing and deletion still use the unchanged
reference frontend through the same-origin bridge described below.

## Developer guide

Start with [ARCHITECTURE.md](ARCHITECTURE.md): route/provider composition, state
ownership, API/async conventions and instructions for adding a feature/backend
call. [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) records the pre-refactor findings;
[VALIDATION.md](VALIDATION.md) records final checks and unverified visual behavior.

From `frontend-react/`, with the existing backend environment available:

```powershell
npm ci                 # reproducible install from the committed lockfile
npm run dev            # React on 127.0.0.1:5173
npm test               # all 552 tests; targeted files can follow --
npm run typecheck
npm run build
npm run format
npm run format:check
```

Use `npm install` only when intentionally changing dependencies; inspect the
lockfile change. Node requirements, the temporary runtime and the independent
backend/reference commands are below. Real API behavior requires the backend;
starting Vite alone does not create a fake authenticated session.

Public environment settings are `VITE_API_BASE_URL`, `VITE_LEGACY_APP_URL` and
`VITE_LEGACY_SIGN_IN_URL`; see `.env.example` and the precedence rules below.
Never put backend secrets in Vite settings. Keep the reference on port 5500 for
delegated billing/deletion and comparisons. Production needs SPA fallback and a
configured reference bridge; `vite preview` is for local build review.

Phase 15 removes provider/view cycles, separates review/forms and NDJSON reading,
adds meaningful lazy route/dialog boundaries, improves modal/error accessibility
and isolates saved Chat history rendering. Feature providers remain persistent;
pathname-keyed page boundaries clear closed form credentials. All 532 baseline
tests remain, with 20 new checks. No dependency/backend/legacy changes were made.
The initial JS graph is now about 424.65kB versus 504.36kB; the largest chunk is
310.33kB and Vite no longer reports its chunk-size warning.

Visual desktop/tablet/mobile comparison remains pending because no browser was
available. Logical drawer checks at 1440/768/390 do not establish pixel parity.
Before native wrapping, review [Android readiness](ARCHITECTURE.md#android-readiness)
and [remaining legacy dependencies](ARCHITECTURE.md#remaining-legacy-dependencies).
Capacitor is not installed; legacy removal is still blocked by delegated actions
and source/deployment dependencies.

## Run both versions

Use separate PowerShell terminals from the repository root. The existing backend
setup is described in `../README.md` and `../STARTUP.md`. Do not recreate an
existing Python environment. Its packages must satisfy `../requirements.txt`.

Terminal 1 — existing backend, needed for both sites' real features:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Terminal 2 — unchanged reference website:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.website:app --host 127.0.0.1 --port 5500 --proxy-headers --forwarded-allow-ips 127.0.0.1 --no-server-header
```

Open <http://127.0.0.1:5500/>. The existing one-click launcher can also run the
reference stack; avoid starting a second copy of those servers on the same ports.

Terminal 3 — React preview (Node 22.12+ or Node 24+ and npm required):

```powershell
cd frontend-react
npm ci
npm run dev
```

Open <http://127.0.0.1:5173/>. React also starts without the backend: layout remains
runnable, while API/session/feature failures are reported. The
fixed port and `strictPort` avoid silently starting on another origin.
Keep the whole repository checkout: the preview imports `website/styles.css`.

Node/npm were not on PATH during initial validation. A portable Node 24 runtime
was downloaded under the system temporary directory, leaving system installations
unchanged. To use that runtime in this session's PowerShell, before `npm ci`:

```powershell
$taskNodeRoot = Join-Path $env:TEMP 'feely-react-node\node-v24.21.0-win-x64'
$env:Path = "$taskNodeRoot;$env:Path"
```

That temporary runtime may be removed by the OS; a normal Node installation is
the durable option. [Vite's setup guide](https://vite.dev/guide/) documents its
runtime requirements.

## Configuration and build

Optional: copy `frontend-react/.env.example` to `.env.local`. These are public
Vite settings, separate from the backend's existing root `.env`:

- `VITE_LEGACY_APP_URL`: reference server/proxy target (default `http://127.0.0.1:5500/`).
- `VITE_LEGACY_SIGN_IN_URL`: same-origin reference login URL (default `/reference/`).
- `VITE_API_BASE_URL`: public API setting replacing the reference meta value
  (default `https://api.feel-y.com/api/v1`). As in the actual reference code,
  local hosts use `http://127.0.0.1:8000/api/v1` before this setting or stored bases.

An `api_base` query parameter takes first priority, including locally. For a
backend on another port, open
`http://127.0.0.1:5173/feedback?api_base=http://127.0.0.1:8001/api/v1`.
Shell navigation and the reference sign-in link preserve that override.
On public hosts, a nonempty Vite API setting precedes `feely_api_base` storage;
if both are empty, the API base is the current origin plus `/api/v1`.
Restart Vite after environment changes. Only `VITE_` settings belong in the
browser configuration; the backend's secrets and `.env` remain untouched.

```powershell
npm run typecheck
npm test
npm run build
npm run preview
```

`build` checks TypeScript and writes only `frontend-react/dist/`. `preview` serves
that output at <http://127.0.0.1:4173/>. No scripts write into `website/`.
Future production hosting must support SPA fallback to this application's own
`index.html`; the existing allowlisted Python website server remains unchanged
and does not host React routes or builds.

## Formatting and readability

Prettier is installed locally as a pinned development dependency. Run these from
`frontend-react/`:

```powershell
npm run format
npm run format:check
```

`.prettierrc.json` uses a 100-column print width, two-space indentation, single
quotes in TypeScript/JavaScript, trailing commas and LF line endings. The commands
cover all supported frontend source, tests, CSS, JSON/configuration, validation
JavaScript, HTML and Markdown. Generated output/dependencies/build metadata, local
environment files and npm's generated lockfile are excluded by `.prettierignore`.
Python fixture scripts remain unchanged. Long literal copy, URLs, regular
expressions and test descriptions may exceed 100 columns without changing their
values to force wrapping.

The dedicated post-Phase-14 readability pass expanded compressed statements,
calls, JSX, types and tests. Small local variables and explicit branches replace
dense nested label/status/ownership expressions; no feature architecture, backend
contract, UI copy or intended behavior changed. No ESLint setup existed, so this
pass adds no unrelated lint rules. Phase 15 subsequently builds on this formatting baseline.
That pass validated typecheck/build, Prettier and the then-current 532 tests. See
[VALIDATION.md](VALIDATION.md) for scope and legacy integrity results.

## Sign in and use Feedback

1. Start the backend, reference website and React servers using the commands above.
2. Open <http://127.0.0.1:5173/login>, or open `/feedback` or `/account` and let
   the authenticated-route guard take you there.
3. Enter your existing account's email and password and choose **Login**.
   The original email-only UI and minimum eight-character password remain.
4. React POSTs `/auth/login` with `{email_or_username: email.trim(), password}`.
   It stores the response's unchanged `access_token` in localStorage `feely_token`
   on the **5173 origin**, then reloads the existing session controller. That
   controller loads `/users/me/account`, `/billing/subscription` and `/terms/me`.
   If Terms are required, review/accept them at `/terms` first. Otherwise you
   return to the requested protected page, or `/chat` by default. An authenticated
   visit to `/login` uses the same redirect policy. A legacy `view=map/journal/
account` hint is supported; arbitrary destinations and `/login` are rejected.
5. Submit Feedback if the existing backend's `FEEDBACK_ENABLED` setting permits it.

Only localStorage `feely_token` holds the JWT; there is no remember-me option,
sessionStorage token or additional session store. The form retains fields after
failed authentication, clears the password after successful authentication, and
prevents pending duplicates and attempts within the legacy 1200 ms cooldown.
Wrong/disabled/unknown accounts show the backend's 401 detail; unverified accounts
show its 403 detail and a React activation link. A temporary post-login session
failure retains the token, stays on login with **Retry session**, and loads through
the controller again rather than submitting credentials a second time.

**Register** opens React `/register`. When verification is enabled/required,
**Activate account / enter email PIN** opens `/activate` with the entered email.
**Forgot your password?** opens `/forgot-password` with email prefilled. Recovery
emails still use the unchanged backend's configured destination; compatible reset
links also work on the React origin. Old high-entropy verification-token links
remain handled by the reference site.

Signing in directly at **5500 does not sign in at 5173**: storage is separated by
origin and port. No token is copied across origins or placed in a URL. The bridge
is a local server convenience, not a new auth endpoint or token exchange.
Vite's local build preview also proxies `/reference/` at port 4173; it has its own
origin/session. [Vite documents proxy configuration here](https://vite.dev/config/server-options.html#server-proxy).

A production host must separately serve the unchanged reference site under the
same origin at `VITE_LEGACY_SIGN_IN_URL` to support the remaining reference flows.
React sign-in, registration, PIN activation and recovery/reset do not require that proxy. Static `dist/` output does not
deploy the Vite proxy. Pointing this URL to a different origin will not share its
localStorage session with React.

Requests use JSON and `Authorization: Bearer <feely_token>` for protected routes.
The client leaves `credentials` unset, matching the legacy fetch default
`same-origin`; it does not introduce cross-origin cookie sessions or CSRF tokens.
The inspected backend uses JWT bearer authentication, not a cookie session.
Existing backend CORS rules must permit the React origin; local development
already permits local HTTP origins through the existing local-origin rule.
No backend/CORS configuration was edited during migration.

Malformed/expired JWTs and current authenticated 401s clear the session. Temporary
failures retain the token and offer retry. Focus/visibility revalidate against
`/users/me`; the expiry timer also signs out without another request. GET network
failures retry once after 400ms; writes are never replayed. FastAPI `detail`, 429
`Retry-After`, stale-response protection and 423 terms requirements are preserved.

## New-user registration

Open <http://127.0.0.1:5173/register> or choose **Register** on Login.
The existing backend, original CSS/fonts/lake image, auth shell and responsive
layout are reused. Legacy `/?mode=register` also maps to this React route.
Authenticated visits redirect through the existing Login/Terms destination policy.

Enter **Email**, **Username**, **Password**. There is no password confirmation,
display-name or newsletter field in the reference; none was added. Native required/
email validation, username minimum three and password minimum eight remain.
Backend username pattern/uniqueness and maximum lengths remain authoritative;
there is no separate availability request. Passwords are sent without trimming.

Registration loads public `GET /auth/captcha/config` and `GET /terms/config`.
While configuration is unavailable, Create account stays disabled and exposes
retry. No production CAPTCHA bypass or client secret/environment override exists.

- Enabled CAPTCHA uses the original Cloudflare Turnstile public site key/action,
  official explicit SDK and flexible widget. A small script loader deduplicates
  pending SDK loads; the React component owns its ref/widget lifecycle, callbacks,
  reset and removal. Expired/error callbacks clear the token. Any failed submission
  clears it and resets the widget. Disabled backend configuration sends null.
  A failed script load offers Retry verification without disabling protection.
  The backend alone holds the secret and performs Siteverify/action validation.
- Published Terms require a manually checked box linked to the exact document,
  with the original version/test-warning text. Consent starts unchecked. Before
  submission the document is fetched again; changed version/hash clears consent
  and prevents submission until it is checked again. Unpublished Terms disable
  consent and record no draft acceptance.
- POST `/auth/register` sends exactly `{email,username,password,website,
captcha_token}` plus, only for published Terms, `{terms_accepted:true,
terms_version,terms_document_sha256}`. Email/username/honeypot are trimmed.
  The honeypot normally stays empty. This consent is separate from authenticated
  `/terms/accept`: registration records acceptance on the backend as client `api`.
- Create account shows `Creating account...`, prevents pending duplicates and
  retains the original 1200 ms attempt cooldown. Backend duplicate/validation/
  CAPTCHA/consent errors are shown through the shared API client. Failed requests
  retain fields and never automatically replay a registration POST.

The 201 response is a user record, not a JWT. When `is_email_verified` is false,
React clears the password and navigates to `/activate` with the returned canonical
email prefilled and **We sent your activation PIN. Check your inbox and spam folder.**
No token is stored and no login is attempted. Only email, a fixed notice and
validated destination/workspace are carried in Router history state; no email,
password, PIN, CAPTCHA token or JWT is added to the URL or an extra storage key.

When verification is disabled and the returned user is already verified, React
performs the same separate `/auth/login` call as the legacy, using the existing
authApi and session controller. Only that login JWT is persisted, then the existing
account/capability/Terms load and redirect policy apply. If login/session loading
fails after creation, the created-account result offers Login/session retry rather
than another Create account submission. Backend activation-email delivery can
return 502 after the account was already committed; React displays that exact
message with the real React activation/resend entry, without automatic retry.

Billing and account deletion remain reference-only. Old high-entropy
verification links remain supported on the unchanged reference frontend. Browser
screenshots and an external live challenge were unavailable;
the SDK boundary and actual backend contracts were tested with isolated doubles.

## Email activation and resend

Open <http://127.0.0.1:5173/activate>, follow the registration handoff, use Login's
activation link, or choose Account's **Verify email**. Direct access without route
state starts with an empty email. Handoff state is scoped to the Router history
entry, without a new global auth store/localStorage/sessionStorage key. PIN is
always local to the mounted form and starts empty; refreshing never restores it.

The original activation heading/copy, email label, single text PIN input, inputmode
numeric, one-time-code autocomplete, `[0-9]{6}` and six-character limits are reused.
Leading zeroes and ordinary paste/typing/backspace remain; there is no multi-box
or filtering UX. Focus starts on PIN with a prefilled email, otherwise Email.
The legacy dialog IDs/classes and paper/form/mobile CSS are retained inside the
auth shell as a routed card. Close returns to Login with email preserved. A native
modal backdrop/focus trap is not reproduced, consistent with existing routed views.

- **Activate account** publicly POSTs `/auth/email-verification/confirm` with
  exactly `{email: email.trim(), pin: pin.trim()}`. Backend normalizes the email.
  It returns `{verified:true, detail:"Email verified."}`, never a JWT. Pending
  requests show `Activating...` and prevent duplicate or overlapping resend calls.
  Failures keep both entered fields and show the shared API error.
- Signed-out success clears PIN and routes to `/login`, prefilling email and
  showing **Email activated. You can now log in.** No automatic login occurs.
  Enter a password to use the already-existing login/session/Terms flow.
- With an existing token, success forces the existing session controller to reload
  account/capabilities/Terms, preserving that JWT. Refresh failure offers Retry
  session while the consumed PIN cannot be posted again. Verified authenticated
  visits to `/activate` follow the existing authenticated destination/Terms policy.
- **Send a new PIN** validates only Email and publicly POSTs
  `/auth/email-verification/request` with exactly `{email: email.trim()}`. It shows
  `Sending a new PIN...`, prevents duplicate/overlapping requests, then displays
  the backend detail and clears PIN on success. Unknown, disabled and verified
  addresses all show **If that account exists and needs verification, an email
  has been sent.** The UI never uses `sent:true` as proof an account exists.
  Disabled configuration uses the backend's `sent:false` detail.
- No client countdown was added: legacy has none. Enabled send quota is three per
  address per hour; confirm quota is ten per address per 900 seconds, in addition
  to the shared auth limiter. 429 detail/Retry-After remain authoritative. PIN
  expiry defaults 15 minutes and persisted attempts default five; resend replaces
  PIN and resets attempts. UI does not guess those configurable limits or retry
  writes automatically.

Unknown/disabled/already-verified accounts, invalid/expired/exhausted PINs share
the same backend invalid/expired message. No activation/session data is inferred
from errors. Passwords, PINs, CAPTCHA/JWT values are not logged or passed through
navigation state. Registration's verified-user branch remains unchanged.

## Password recovery and reset

Open <http://127.0.0.1:5173/forgot-password> or use Login's **Forgot your password?**.
The original recovery heading, explanatory copy, native email input and **Send
reset link** button are reused. The controlled form POSTs
`/auth/password-reset/request` with exactly `{email: email.trim()}`, displays
`Sending...`, prevents pending duplicates and shows the backend detail. Existing,
unknown and disabled accounts all receive **If that account exists, a password
reset email has been sent.** The UI does not interpret `sent:true` as account proof.
Configuration/validation/network errors retain email. Backend per-address request
quota defaults three per hour, plus shared auth limits; 429/Retry-After remain
authoritative. No client countdown or automatic write retry exists.

The backend constructs `PUBLIC_APP_URL/?reset_password_token=...`, without email
or user ID. The inspected current setting is **http://127.0.0.1:5500**, so new
emails still point to the working reference site. No root config or backend
email behavior changed. React supports the same query on its own origin:

```text
http://127.0.0.1:5173/?reset_password_token=<email-token>
http://127.0.0.1:5173/reset-password?reset_password_token=<email-token>
```

A later authorized deployment/config change to backend `PUBLIC_APP_URL` pointing
at the React origin would make new emails target React; the generated root link
already works with this migration. Keep the reference URLs working in the meantime.
The frontend adds no alternative `token` parameter or token exchange protocol.

React captures a compatible token only in the mounted reset form's ref, then
immediately replaces the URL with token-free `/reset-password` via React Router.
It never places that token in history state, localStorage/sessionStorage, UI text
or logs. Token-bearing entry never renders AppShell; all reset/recovery navigation
links are token-free from their first render. Only public `api_base`/`view` query
settings survive recovery navigation. A new incoming link replaces the in-memory
token and clears entered passwords. Missing/malformed links offer a new recovery
request. Refreshing a cleaned URL loses the token intentionally: reopen the email
link rather than relying on a secret stored by the frontend.

The original required **New password** / **Confirm new password** inputs use
new-password autocomplete and minimum eight characters. Registration/reset share
the small minimum validator. No new strength/pattern policy or HTML maximum was
added: backend length 8–128 is authoritative, matching the existing registration
and reset markup. Confirmation mismatch gives **The passwords do not match.**
Password values remain unmodified, solely in local form state.

**Save new password** POSTs `/auth/password-reset/confirm` with exactly
`{token,new_password}`. Loading shows `Saving...`; pending duplicates are blocked.
Invalid/expired/used/replaced/disabled-account links share the backend invalid/
expired error, and recoverable failures keep local fields without replaying writes.
On `{reset:true,detail}` success, React displays the response, clears passwords
and the in-memory token, waits the original **1200 ms**, then replaces history
with `/login` and a fixed non-sensitive success notice. There is no automatic
login, password reuse or new JWT.

Existing JWTs remain valid after reset in the current backend: it changes password
and reset-token metadata without a session/password-version revocation check.
React preserves `feely_token` and the existing controller. Signed-in users follow
Login's normal authenticated/Terms redirect after success, matching the legacy
dialog's return to the underlying app. Authenticated Account password change is
a separate React form, described below.

Recovery/reset use original dialog/form/mobile CSS as routed cards in AuthLayout.
Native modal/backdrop behavior and real-browser screenshot comparison remain gaps.

## Terms review and acceptance

Open <http://127.0.0.1:5173/terms> manually, use the Terms link in the account
page, or follow **Review terms** when access is blocked. `/agb.html` is
a React alias for `/terms`; no new workspace tab was added.

- Signed-out readers use public `GET /terms/config` and can open the current
  document. **Sign in** takes them to React login before accepting.
- Signed-in state comes from `GET /terms/me`: `current` contains the configured/
  enforced flags, version, URL and SHA-256; `accepted_current` and typed
  `acceptances` describe the recorded acceptance. JWTs/subscriptions do not
  carry a separate accepted-terms capability.
- Required review has the original heading, document/version link and consent
  text. Consent starts unchecked. **Accept and continue** sends exactly
  `{accepted:true, version, document_sha256, client:"web"}` to `/terms/accept`.
  The linked publication remains the full authoritative content; React does not
  load legacy HTML or invent/embed a different terms document.
- After a successful POST, a forced session reload rereads account, subscription
  and terms. It cannot reuse an older in-flight read. Access returns only when
  fresh backend state permits it; a refresh failure remains an explicit error.
- A 409 refreshes the current document and resets consent, including changes to
  its version, hash or URL. Other errors retain consent and permit manual retry;
  pending requests disable consent/submit and prevent double clicks. POSTs never
  automatically retry. Already accepted or unpublished terms never prompt a POST.

The shared shell gate blocks Feedback and other feature outlets when the real
session says review is required. Leaving the Terms route or pressing Escape does
not remove that gate. Account remains exempt, matching the backend. Sign-out and
reference account/subscription management remain available without accepting.
After success the router returns to the originating feature, with query overrides
and workspace context preserved; a manual required review defaults back to Chat.

Terms is currently a routed paper view using the legacy `#terms-review`,
`.app-dialog`, `.terms-review-form` and responsive CSS, rather than a native modal.
It lacks the modal backdrop/focus trap and cannot prevent URL navigation; the gate
prevents that navigation from granting access. `TermsReview` is presentation-only
so a later modal can reuse it. Profile reading/editing is now in React; Terms'
account/billing management links still delegate to the reference account screen
for security/deletion/payment actions. Its existing prompt may require choosing
the management action. Login, registration and PIN activation/resend are now in
React, along with recovery/reset and authenticated password change; billing and
deletion remain deferred.

## Account/profile reading and editing

Open <http://127.0.0.1:5173/account> or choose the sidebar account gear. The page
uses the existing session's `GET /users/me/account` DTO and
`GET /billing/subscription` summary; it does not issue duplicate GETs on entry.
Account remains authenticated but exempt from mandatory Terms acceptance,
matching the backend. Feedback and other gated features remain blocked until
Terms are accepted.

The five editable fields are **Display name, Username, Email, Avatar URL, Bio**.
The original initial/avatar, heading, copy, grid, labels, email-verification status,
plan/status/period summary and global CSS are reused. Backend role, ID, password
flags and timestamps are not new editable fields. Avatar URLs are stored as text;
the original initial is displayed instead of fetching an avatar image.

**Save profile** PATCHes `/users/me/account` with the same five-field payload as
the reference. Values are trimmed; blank display name/avatar URL/bio become `null`.
The endpoint supports partial updates, but this form deliberately sends all five
fields as the legacy does. The separate `/users/me/profile` LLM/map data endpoint
is never used for personal profile edits.

After saving, the full normalized backend response is applied to SessionContext
and to the local form. The sidebar updates immediately without a page reload or
redundant account/subscription fetch. Existing terms/capabilities/JWT stay intact.
If a concurrent session refresh makes that direct update unavailable, the existing
forced reload provides fresh verified state instead of reviving an older snapshot.
Email verification changes use the actual response flags; Verify email now opens
the React activation page, which refreshes the same session after confirmation.

Loading, session errors, `Saving...`, `Saved.` and API failures remain explicit.
Native field validation/lengths are retained; backend username/uniqueness checks
remain authoritative. Failed saves retain all entered values. Dirty state is
tracked; unchanged Save remains available because the reference permits it.
Pending Save is disabled, and writes for the same session are serialized even
across close/reopen. Closing and reopening discards unsaved profile edits as in
the legacy; no new unload/navigation warning is added.

Billing/subscription and **Delete account**
are real links to `/reference/?view=account`, with a visible delegation note.
They only open the reference account screen; users must choose/confirm the action
there. React makes no payment or deletion mutation calls. **Verify email**
opens React `/activate` with the current account email and an Account return path.
Reference edits/verification/billing changes require reloading React to reread
account/capability data; ordinary focus checks validate the session only.

Account uses a routed card rather than a native modal. Original responsive
header/body/section/grid CSS remains the styling source. Full modal/focus behavior
and browser visual parity remain unverified/deferred.

## Authenticated Account password change

Open `/account` and use its **Change password** Security form. It retains the
original Account grid, labels, advisory copy and **Update password** button.
**Current password** is shown/required only when the backend Account DTO's
`has_password` is true. Passwordless accounts send null for current password;
the response makes the field required after a password is established.

**New password** reuses registration/reset's minimum-eight helper and native
constraint; backend maximum 128 remains authoritative. The original blank/
whitespace rejection remains **Enter a new password.** No strength/character or
same-password restriction is added: backend permits identical current/new values,
despite advisory copy recommending against reuse. **Confirm new password** was
added as explicitly requested for Phase 10; it is client-only, with matching
validation **The passwords do not match.** Legacy lacked that extra field.

The exact authenticated request is PATCH `/users/me/password` with
`{current_password: currentValue || null, new_password: newValue}`. Passwords are
not trimmed. Confirmation is never sent. The shared API client uses the existing
Bearer JWT and default fetch credentials, with no new CSRF/cookie protocol.
Pending requests show **Updating password...**, disable Update and reject
duplicates. Profile/password writes share an Account guard across close/reopen,
preventing overlapping full Account DTOs from overwriting newer data.

The success response is the full Account DTO, not a JWT/detail response. React
applies it through existing SessionController, preserving subscription/Terms/JWT,
clears all three local fields, shows **Password updated.** and stays in Account.
Passwordless provider metadata updates from that real response. No redundant
GET/login or proactive sign-out occurs. If a concurrent session read prevents
direct application, the existing forced-refresh fallback handles fresh state.

Wrong current password shows backend **Current password is incorrect** (403)
and keeps the session/fields. Validation/network/backend/429 errors use existing
shared parsing, retain local fields and never replay writes. An actual authenticated
401 uses existing controller expiry/route guard to return to Login. General server
rate limits remain authoritative; the backend adds no password-specific limiter.
Passwords never go to shared state, storage, URL, navigation state or logs. Leaving
the form removes its local inputs; reopening starts empty even during a pending write.

Both current and other JWTs remain valid after successful change in this backend;
no replacement JWT, password-version revocation or mandatory re-login exists.
The API is Terms-exempt like Account, and changing password does not accept Terms.
Unsaved Profile drafts retain their existing local dirty behavior. The Account
card remains routed rather than modal; real-browser visual comparison is unverified.

## Journal

Open <http://127.0.0.1:5173/journal> or choose **Journal** in the existing sidebar.
The editor/history/analysis controls replace the placeholder, retaining original
paper, textarea, header/sidebar, suggestions, fonts and mobile CSS. Journal's own optional map-insight analysis/review
is included through its existing endpoints and now integrates with the real Map.

Access uses the real session's `journal_access ?? my_map_access`, RequireSession,
Terms gate and backend authorization. Locked users see the original Premium copy.
Backend 402 is authoritative, with a verified access recheck; 401 expires through
the existing controller and 423 keeps Terms gating active. Same-owner failures
retain drafts; logout/owner changes clear private memory like legacy. Billing stays
a real reference action: View Premium opens reference Account, not new checkout logic.

Dates are local-calendar **YYYY-MM-DD**. Local-noon arithmetic and Intl formatting
avoid UTC/day and DST drift. First visit selects current today even after midnight;
later workspace visits retain selection. Previous/Next/Today and descending history
remain in the sidebar. Next stops at today; existing future history entries remain
selectable like legacy/backend. Successful mobile selection closes the drawer.

- GET `/journal/entries?limit=180`: history date/excerpt/counts/updated_at.
- GET `/journal/entries/{date}`: raw content/word_count/suggestions, analysis_stale,
  analysed_at/created_at/updated_at. Missing day returns empty/null timestamps
  without creating a row.
- PUT same date endpoint: exactly `{content}`, max 100000, lazy unique user/date
  create/update including explicit empty text. Response/timestamps are authoritative.
  Empty/no-suggestion rows disappear from local save history but reappear in a
  fresh server index, preserving the original unusual behavior.
- POST date `/analyse`: no body, returns `{entry}` after flushing dirty text.
  Original Find map insights, type/title/text/category/topic choices, Save topic /
  Add to map / Not this and readonly Saved/Dismissed cards are retained. POST date
  `/suggestions/{id}` uses the exact accepted/edit/null payload or `{accepted:false}`.
  Narrow GET `/users/me/map` supplies topic options; returned map changes are real
  and visible in React Map as well as the unchanged legacy frontend.

Input shows Unsaved and resets the exact **900 ms** debounce. No blur-save or
automatic write retry was added. Unchanged/identical saves are skipped; per-date
queues serialize save/analysis/review while editing stays enabled. Responses update
baseline/metadata without replacing newer text. Queued autosaves honor a newer
debounce, including reverting while an older PUT is pending. Status preserves New
page / Loading... / Unsaved / Saving... / Saved / Analysing... / Analysis ready/error.

Date/route navigation flushes latest content first. Failure keeps page/text/dirty
with Retry save; further edits also retry as legacy. An authorization 403 makes
the editor read-only and permits recovery navigation with the draft retained in
memory; Check session again and the existing email activation link are available.
Request identity/abort and
mutation versions reject stale date, history and topic-option responses. The outer
host now uses createBrowserRouter/RouterProvider with unchanged routes for its
navigation blocker. Feature-owned session memory retains drafts/selection/history
across workspace/Terms/loading unmounts; no editor text goes to browser storage
or shared auth state.

Tab hiding/beforeunload use the same keepalive PUT through lifecycle hooks, using
`@react-hookz/web` for visibility rather than manual editor/navigation event binding.
Dirty clears only on confirmed success; unload protection stays active while drafts
exist. Keepalive is best effort (browser size limits/offline/forced termination).
There is no backend ETag/version conflict protocol, so multiple clients/tabs still
have last-writer-wins behavior. Browser screenshots/responsive review were unavailable;
DOM/timer/race/API contracts and original assets were checked.

## My Map

Open <http://127.0.0.1:5173/map> or the **Map** tab. The real page preserves the
original bubbles, SVG connections, filters, Overall, detail drawer, topic sidebar,
controlled topic/entry forms, confirmations and original CSS/mobile breakpoint.
There is no new graph library or runtime dependency in Phase 12.

The backend stores Map JSON in the user's profile: `topic_spaces`,
`unassigned_entries`, `updated_at`. Topics have UUID-hex IDs, title/description,
person/trait/experience/other type, parent_topic_id, related_topic_ids, chat_ids,
journal_dates, entries and server timestamps. Entries retain category/text/source
metadata; practices add status/reflection. Overall is a synthetic UI node for
unassigned entries. Graph/UI positions, selection/filter/modal/menu state remain
feature memory, separate from server data and never written to browser storage.

Legacy rendering is custom positioned HTML buttons plus SVG lines; React uses
the same technology and classes. Desktop slots repeat deterministically with
original offsets/clamps. At <=900px, visible nodes form two columns on a growing
board. Sidebar traverses parent-first; its count includes Overall. Parent lines
are solid, related lines dashed/deduplicated. Parent direction comes from the
hierarchy, not arrowheads. No edge IDs/weights/labels, persisted coordinates,
dragging, zoom or pan exist in legacy/backend, so none were added.

All paths below are relative to the existing API base:

| Method/path                            | Exact request fields                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| GET `/users/me/map`                    | Whole Map; no separate node/detail/edge-list call                              |
| POST `/users/me/map/topics`            | title, category, description, parent_topic_id, related_topic_ids, chat_id      |
| PATCH `/users/me/map/topics/{id}`      | Edited topic fields; disconnect uses only related_topic_ids or parent_topic_id |
| POST `/users/me/map/topics/{id}/merge` | target_topic_space_id                                                          |
| DELETE `/users/me/map/topics/{id}`     | No body                                                                        |
| POST `/users/me/map/entries`           | category, text, topic_space_id, source_chat_id                                 |
| PATCH `/users/me/map/entries/{id}`     | category, text, topic_space_id                                                 |
| DELETE `/users/me/map/entries/{id}`    | No body                                                                        |
| PATCH `/users/me/map/practices/{id}`   | status, reflection (null for pause/resume/reactivate)                          |

Writes wait for the backend's full Map and changed entity, with no optimistic
graph changes. Topic name/description trim and keep original 120/2000 limits.
Entry text trims; legacy has no textarea maximum, so the server's 1000 maximum
remains authoritative. Backend validates cycles/self/missing links and symmetric
related backlinks. Delete moves topic entries to Overall and reparents children;
merge keeps the target, rewires references and preserves the source as merged_topic.
Only the latest three entries appear, with original 86-character more/less previews.

Entering Map or clicking its current tab refreshes and resets selection. Closing
details keeps the selected bubble; filters clear selection. Selecting a topic
outside the current filter restores Everything. Successful mobile sidebar selection
closes the drawer. Map -> Journal date links open the real requested date, including
its loading/error states. Journal analysis does not modify Map until a suggestion
is accepted. Review invalidates Map; entering Map shows persisted topics/entries/
source dates without a full-page reload. Shared topic/category DTOs avoid a second
representation.

A per-client write queue coordinates Map mutations and Journal review because
both update the same backend profile JSON. Request identity, abort, ownership and
write revisions reject older graph results. Full responses reconcile server fields
and preserve newer user selection. Our successful Map writes need no redundant GET;
external Journal writes invalidate/refetch only when Map is visible. Duplicate
entity writes and popup submission are protected; the graph itself stays interactive
outside modal actions. Failed forms retain their input and use existing errors,
with no write replay. Same-route session/Terms gating hides retained local dialogs;
leaving Map closes dialogs/temporary connection choices. Logout/owner change clears
private Map state. There is no offline persistence or cross-client conflict protocol.

Access uses shared RequireSession, Terms, `my_map_access` and authoritative backend
402/401/403/423 semantics. Verified access refresh can retry a server-denied Map.
Premium actions open reference Account; they do not issue checkout mutations.

Practice **Complete** now opens the real Reflection modal described below.
Connected conversations carry their unchanged chat ID to real `/chat` and use
authoritative loaded titles, falling back to Conversation for missing sources.
Manual topics/entries inherit the selected Chat source; a blank conversation has
no persisted source. Billing remains reference-only. Confirmation is a
controlled React dialog using original app CSS, focus refs/trapping and an inert
background rather than imperative native showModal. Real screenshots/mobile/native
focus/Back/Forward remain unverified because no browser was available. Concurrent
tabs/other clients retain backend last-writer-wins behavior.

## Practice Reflection

Choose **Complete** / **Complete practice** on an active or paused Map practice.
The original modal opens over Map, retaining topic selection and original
Review without shame / What happened when you tried it? heading and instructions.
One optional five-row textarea and **Mark complete** / **Completing...** button
reproduce the existing flow. No steps, scales, new questions or required text exist.

Reflection is a nullable field on the shared Map Practice entry, not another
entity or record. There is no standalone Reflection/config/detail/history endpoint,
Reflection ID or separate save. The only source read is authenticated
GET `/users/me/map`, locating the existing practice under a topic or Overall.
Practice ID, category, source chat/Journal date, reason and created_at remain;
backend updates status/reflection/updated_at and Map timestamp.

1. Map passes practiceId in React Router state to `/reflection`.
2. Validate source through the existing Map read and real access/Terms gates.
3. PATCH `/users/me/map/practices/{practiceId}` exactly
   `{status:"completed",reflection:answer.trim() || null}`.
4. Validate and apply authoritative `{practice,map}` before closing/returning to
   `/map`; preserve selected details and show the actual saved reflection/status.

This is **one atomic mutation**. No optimistic completion, second Reflection write
or mandatory refresh sequence exists. Shared Map write coordination also covers
Journal review and other Map mutations. A later refresh failure does not undo a
confirmed completion or trigger another PATCH. Backend repeat completion replaces
the same entry's reflection, without duplicate records. Normal completed entries
show saved reflection and Practice again, which clears it with active/null. Direct
completed-source access is read-only; no Reflection edit/history feature was added.

`/reflection` with no valid Router-state source explains choosing a Map practice.
No new practice-query/ID URL scheme or standalone writing mode was invented. Missing
or wrong-kind sources show Practice not found, with no mutation. Return routing is
fixed to Map and ignores arbitrary returnTo values. Answers never enter URLs, Router
state, auth/session state, browser storage or logs. Only a validated practice ID
passes through existing Terms/activation return routing to restore the same form.

Client trims text and sends empty/whitespace as null. The unchanged textarea has
no required/min/maxLength; the backend's 2000 maximum remains authoritative.
Recoverable errors retain raw answers and enable explicit retry; PATCH is never
automatically replayed. Errors are visible inside the modal rather than behind it.
Submission is protected against doubles. Source/submit/owner identity rejects old
reads, late redirects and cross-account responses. Newer typing during a pending
completion stays in the form, with an unsaved-changes message only after backend
completion; a subsequent Mark complete replaces that same reflection field.

Feature-local memory survives internal session/loading/Terms transitions. Explicit
Close/Escape/new opening resets the draft; there is no intrusive navigation prompt
or offline recovery. Close during a pending request follows legacy behavior: it
closes the form but cannot cancel a backend write already sent. Late responses may
update Map without redirecting from the user's new route. Logout/owner change clears
private drafts and masks the modal immediately. 401/403/402/423 retain shared
session/verification/capability/Terms semantics; no Reflection permission store.

Journal-generated practices use this identical completion operation; their source
dates remain, with no Journal content/analysis/history mutation. The unchanged Chat
backend consumes saved practice context through its existing generation logic.
The controlled React dialog reuses original app-dialog CSS, close/Escape behavior,
focus refs/trapping and inert background. Router uses a modal route over Map rather
than legacy's URL-free native showModal; normal closing replaces the route with Map.
No browser was available for screenshots/native focus/Back/Forward/touch comparison.
DOM/race/API tests and original assets pass; full visual parity remains unverified.

## Chat

Open `/chat`, the default route. `src/features/chat/` contains the real page,
conversation sidebar, composer, messages, topic/note/delete reviews, typed API,
controller/provider and timer-based phrase playback. The reference is
`website/views/chat.html`, `website/js/chat.js`, shared `website/app.js`,
`website/js/start.js`, navigation/auth/dialog bindings and original CSS.

The backend owns conversation IDs, titles, ordering and messages. Conversations
are listed by backend update time; `message_count` counts exchanges, while messages
are ordered `{role,content,created_at,reaction?}` records without message IDs.
The last user/assistant pair shares a timestamp. Model output is literal React
text; there is no HTML, Markdown interpretation, automatic linkification or speech.

New conversation is local until first send. That send persists `{}` once, adopts
the returned `chat_id`, and streams the trimmed composer text. Enter/Shift+Enter
insert new lines; Ctrl/Command+Enter sends outside IME composition. Prompts/lenses
fill the draft without sending. The server enforces its 8000-character boundary.

Paths below are relative to the unchanged configured `/api/v1` base:

| Operation      | Existing endpoint and payload                                                                                                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List/create    | `GET /llm/chats`; `POST /llm/chats` with `{}`                                                                                                                                                      |
| History/delete | `GET /llm/chats/{chat_id}`; `DELETE` same path, 204                                                                                                                                                |
| Generation     | `POST /llm/message/stream` with `{chat_id,context}`                                                                                                                                                |
| Reaction       | `PUT /llm/chats/{chat_id}/reaction` with `{created_at,reaction}`; `like`, `dislike`, or `null`                                                                                                     |
| Analysis       | `GET /llm/chats/{chat_id}/topic-suggestion`                                                                                                                                                        |
| Analysis retry | `POST /llm/chats/{chat_id}/topic-suggestion/retry`, no body                                                                                                                                        |
| Topic decision | `POST /llm/topics/confirm` with `chat_id,require_map_access:true,suggestion_id,entry_category,topic,description,category,related_topic_ids,accepted,existing_topic_space_id,parent_topic_space_id` |
| Note decision  | `POST /llm/map-suggestions/confirm` with `chat_id,accepted,category,text,reason,topic_space_id`                                                                                                    |

Streaming uses fetch NDJSON, not SSE: `status` describes progress,
`text_delta` carries text, `result.data` carries the authoritative response and
full `chat_info`, and `error` carries message/status. UTF-8/network boundaries,
blank lines and an unterminated final record are supported. Malformed, incomplete,
unknown or wrong-conversation results cannot claim a persisted exchange. No write
is automatically replayed and no JSON fallback/generation timeout was added.

One generation is tied to its captured session/request/conversation. Switching to
B or another workspace lets A continue; only A receives its text and final result.
Stop is available on A, even while A's history reloads, and aborts fetch. Before
commit the backend discards partial work; React removes the temporary user/reply
and restores sent text only when the composer is empty. Newer typing is retained.
Phrase playback follows legacy pacing, flushes final text, cancels detached timers,
and reveals instantly for hidden/reduced-motion state. It never speaks audio.

An explicit identical retry after an uncertain failure first reads authoritative
history. A matching saved next exchange is reconciled without another generation;
an unsaved attempt can be sent again to the same ID. Different new text remains
sendable. Pending reconciliation prevents double clicks and preserves newer
typing. This protection cannot promise cross-client idempotency: the backend has
no request key, and another client can write between history check and send.

Deletion uses the original confirmation and first-remaining/blank fallback. Local
tombstones/version guards ignore late reads, lists and stream results. Reactions
are backend-authoritative, timestamp-based toggles with pending protection and
retryable failure; switching conversations cannot redirect their result.

Topic/note reviews retain original fields, routing, trim/fallback and errors.
Polling runs immediately then 700/1800/4000/8000ms until analysis completes; equal
suggestions preserve edits. Analysis retry never resends Chat. Review results feed
the existing serialized Map resource, keeping source IDs and other Map edits.
Source links select the referenced conversation through Router state, not whichever
chat is currently active. Deleted sources retain IDs and display the backend 404.
Chat makes no separate Journal write. The backend may attach a note to an already
linked topic even when Overall/null was requested; this existing behavior remains.

Chat works for free users. Map acceptance remains Premium-gated, while dismissal
is allowed. Shared JWT/Terms handling covers HTTP and in-band 401/403/423; minute
and daily 429 copy remains distinct. Upgrade actions open reference Account.
Map capability loss closes an unavailable note review. Backend note acceptance
has no unique review/idempotency key; pending guards do not guarantee deduplication
across clients. No rename endpoint, billing migration or legacy cleanup was added.

Current validation: **552 React tests, including 78 Chat tests**, 28 targeted backend
tests, disposable real Chat/Journal/Map/Reflection contracts and 38 unchanged legacy tests pass.
Typecheck/build and 34-file legacy asset checks pass. Browser discovery found no
available browser, so screenshots/native mobile/focus/Back/Forward parity and
unsupported/older-browser behavior remain unverified. Phase 15 introduced route/dialog
splitting and removed the chunk-size warning, with providers retained for feature
lifetime. Native UI/Android validation remains pending. See [VALIDATION.md](VALIDATION.md).

## Navigation and preview assumptions

`/` opens real `/chat`. `/account`, `/feedback`,
`/terms`, `/login`, `/register`, `/activate`, `/forgot-password`, `/reset-password`,
`/journal`, `/map` and `/reflection` are real features. Legacy-style
`/?view=map`, `/?view=journal`, `/?view=account`, `/index.html`, and `/chat.html`
links redirect through React Router. Remaining query parameters are preserved,
including `api_base`; billing/auth return parameters are not processed yet.
Unknown paths have a fallback page with a return link.

Chat and Map remain the two main tabs. Journal remains a secondary link below
the contextual sidebar. Left/Right arrows select the main tabs. Router history
restores the selected workspace with Back/Forward. Clicking the current tab does
not add a duplicate history entry. Account/feedback keep the current workspace
context and offer a return link. Map practice completion opens the real Reflection
modal; no permanent reflection item was added to the legacy navigation.

At the original 900px breakpoint the sidebar becomes a drawer. The menu button
opens it; the close button, backdrop, Escape, or navigation closes it. Hidden
navigation and the background panel use `inert` to prevent offscreen/background
focus. Focus stays within the open drawer and returns to its opener on close.
Resizing to desktop resets the drawer state.

`SessionProvider` supplies real account data, subscription capabilities and the
feedback config flag to the shell. Sign-out removes the local token and clears
feedback state. Failed subscription reads use the same conservative free-access
fallback as the reference, except 401/403 errors propagate. The old Phase 2
preview fixture now lives only in `src/test/previewSession.ts` and is excluded
from the production dependency graph. Layout tests still use that explicit fixture.

New conversation opens `/chat` with a local blank conversation and retains composer text.
Map topic creation and Reflection completion use the real backend and capability gate.
Reference-only billing/account-deletion actions are intentional gaps,
not claims of feature parity. Feedback is a routed paper panel, not yet a modal:
it reuses the original copy, fields, CSS/ID selectors and responsive padding.
It preserves validation, pending-submit protection, success reset, failed drafts,
404 closure and backend request shape. Drafts survive closing/reopening within
the current session and clear on logout/account change. Enforced/unaccepted terms
block the form through the shared session/Terms gate; React acceptance restores it
after the session refresh.

## Structure and styling

- `src/components/layout/`: `AppShell`, `Sidebar`, `Navigation`, `SidebarContext`,
  `WorkspaceHeader`, and `ThemeToggle`.
- `src/pages/`: legacy-entry redirect and Router fallback; the historical placeholder is a test fixture.
- `src/components/shared/`: shared dialog focus/keyboard handling and lazy-view loading/recovery.
- `src/features/feedback/`: real page, typed API wrapper, session-scoped form/mutation state.
- `src/features/terms/`: real routed reader/review, reusable form, typed API, acceptance hook and shared gate.
- `src/features/account/`: real page, local profile draft/save hook, read-only summary, typed PATCH wrapper and reference links.
- `src/features/journal/`: editor, sidebar date/history, analysis/review, typed API/date helpers and a feature-owned draft/autosave controller/provider.
- `src/features/map/`: real Map route, declarative HTML/SVG/layout, sidebar/details/forms/dialogs, typed API and a feature-owned authoritative controller/provider.
- `src/features/reflection/`: practice-only modal/page, local answer/source lifecycle, API adapter and typed source helpers; shared Map remains the authoritative Practice store.
- `src/features/chat/`: conversation/history/composer/stream/reactions/reviews/sidebar, captured ownership, typed API and timer-based text player.
- `src/types/map.ts`, `src/services/mapResource.ts`: shared Journal/Map DTOs and write queue/invalidation, without a second graph store.
- `src/services/`: configuration, HTTP/NDJSON, shared error type, session API/controller, write coordination, shell adapter and reference delegation.
- `src/context/SessionContext.tsx`, `src/hooks/useSession.ts`: real session lifecycle.
- `src/hooks/`: appearance, viewport height, responsive layout and drawer state.
- `src/types/api.ts`: account, subscription, terms and feedback-config response types.
- `src/types/navigation.ts`, `src/utils/routes.ts`: shell/session contracts and route metadata.
- `src/styles/index.css`: original stylesheet plus small local active-state/disabled-control rules.
- `public/`: unchanged favicon copy; CSS image URLs resolve against the original files.
- `src/test/`, `vitest.config.ts`: shell interaction tests with jsdom. Run `npm test`.
- Tests use at most four workers to avoid simultaneous jsdom startup exhausting this environment; existing timeouts/coverage are unchanged.

React owns rendering and navigation. There is no HTML fragment loading,
`innerHTML`, navigation DOM querying, legacy script execution or manual URL
switching. React refs handle focus. Browser media/viewport subscriptions are
contained in hooks with cleanup; narrow hooks update `html[data-theme]` and
`--app-height` because the unchanged reference CSS depends on those document
values. React renders document title and theme-color metadata declaratively.

See [MIGRATION.md](MIGRATION.md) for the inspection, next files, API contracts,
and the verification checklist. See [VALIDATION.md](VALIDATION.md) for results.
