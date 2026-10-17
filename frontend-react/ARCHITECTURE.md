> Current update: React now owns styles/assets, billing and account deletion. Admin, webmail and legal files live in public/. See README.md for current startup. Delegation references below describe the previous migration phase.

# Frontend architecture

Read this first when extending the application. [README.md](README.md) covers
running it; [ARCHITECTURE_AUDIT.md](ARCHITECTURE_AUDIT.md) records the Phase 15 audit;
[VALIDATION.md](VALIDATION.md) records verified behavior and remaining UI gaps.

## Structure and routing

```text
src/
  App.tsx                    explicit routes and persistent feature providers
  components/layout/         shell, sidebar, header, feature-dialog composition
  components/shared/         DialogFrame and lazy-view loading/error boundary
  context/                   session provider
  features/                  account, auth, chat, feedback, journal, map, reflection, terms
  hooks/                     appearance, viewport, drawer and session access
  services/                  HTTP/NDJSON, session, shared write coordination, reference links
  types/                     shared account/capability and Map domain contracts
  utils/                     safe route returns and small password rules
  test/                      feature UI/controller tests and explicit backend fixtures
```

`App.tsx` defines routes; `utils/routes.ts` defines shell metadata and safe return
helpers. Feature pages and dialogs are lazy-loaded inside `ViewBoundary`.
Page boundaries are keyed by pathname: leaving a form unmounts local credentials
immediately even if the next chunk is pending. Reset-token handling stays eager
and replaces sensitive queries before rendering normal shell links. Legacy
`index.html`, `chat.html`, `agb.html`, `?view=...`, `?mode=register` and root reset
links remain supported. Deploy SPA fallback separately from the old allowlisted
Python website server.

Providers stay mounted above routes so generation/drafts survive workspace and
Terms transitions. `FeatureDialogs` composes Map/Chat/Reflection presentation;
providers do not import their own forms. Dialog keys and hidden Terms rendering
preserve edited fields. Shared dialogs handle registered focus refs, Tab boundaries,
Escape and restoration without DOM queries or fragment loading.

## State, session and gates

| Owner                                    | Responsibility                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| SessionController / SessionContext       | JWT lifecycle, validated account, capabilities, Terms and feedback availability                         |
| ChatController / ChatContext             | conversations, active ID, composer, generation, analysis, reactions/reviews, deleted-ID guards          |
| JournalController / JournalContext       | per-date editor drafts, baseline/inflight text, 900ms autosave, save queues, history and review choices |
| MapController / MapContext               | authoritative graph, selection/layout filters, dialogs and server mutation revisions                    |
| ReflectionController / ReflectionContext | selected Map practice and local answer/submission lifecycle                                             |
| FeedbackContext and form hooks           | same-owner drafts and explicit validation/pending/error/success state                                   |
| Shell/component hooks                    | appearance, responsive drawer and local UI controls                                                     |

Session restores `feely_token`, validates through the existing backend, then loads
account/capability/Terms configuration. Current authenticated 401 expires that
session; 403 remains an authorization/verification error; 423 activates Terms
review. Stale old-token responses cannot expire a newer session. JSON and stream
requests leave fetch credentials at their legacy default and use Bearer auth.
Private feature projections mask owner changes before effects clear caches.

`RequireSession` protects feature routes. `TermsGate` implements the existing
required-review policy, including Account/Terms exemptions. Map/Journal/Reflection
also use authoritative capability helpers and backend 402. Chat remains free with
server quotas; accepting Map reviews requires access. Do not infer a successful
session from a stored token or create a parallel permission store.

## API and async conventions

`ApiClient.request` owns JSON HTTP, Bearer headers, error normalization and one
400ms GET network retry. Writes are never automatically replayed. `stream` owns
HTTP/session semantics; `services/ndjson.ts` owns UTF-8 buffering, JSON records and
reader cleanup. Chat owns status/delta/result/error validation. `apiError.ts` is
shared; existing ApiClient error exports remain compatible.

Each feature API names its endpoints/payloads explicitly. Validate canonical
returned domain data before claiming success; pass an AbortSignal for cancellable
reads. Do not replace named operations with a generic mutation framework.

- Capture the session token and the relevant request/source/edit revision before
  awaiting. Recheck them before applying results. Keep the reason for each ignored
  response visible at the call site.
- Abort reads on source change/unmount. An already-sent write may persist after
  closing; suppress stale UI effects rather than claiming rollback.
- Journal queues each date, compares saved/inflight/local text and flushes before
  changing date/route. Its 900ms debounce is feature behavior, not a generic form hook.
- `mapResource.ts` serializes Journal/Map/Chat review writes to the shared profile.
  It stores queue/revision metadata, not copied Map data. Apply returned graph
  versions monotonically and wait for writes before loading the graph.
- One Chat generation owns its originating conversation even after selection
  changes. Stop only aborts the selected origin. Deleted IDs stay tombstoned.
  Explicit identical retry reconciles saved history first; the backend has no
  cross-client idempotency key. Keep that limitation visible.

Cross-feature links use Router state: `journalDate`, `practiceId` and `chatId`.
Validate sources and safe returns; never put answers, passwords or reset tokens
in routing/storage. Reflection completes an existing Map practice atomically.
Chat/Journal reviews update the shared Map; Chat does not create Journal records.
Map layouts are deterministic with no dragging, zoom or pan. Saved Chat history
is memoized separately from live generation/composer state.

## Extending the application

1. Put the page, feature API, domain types and any cohesive controller inside one
   feature folder. Keep UI-only state local; add a persistent provider only when
   drafts/requests must survive navigation.
2. Add an explicit route in App, shell metadata/type entries where needed and the
   existing session/Terms/capability guards. A new primary workspace additionally
   needs navigation/sidebar/keyboard behavior; do not invent an automatic registry.
3. Add a named backend call through ApiClient using the existing endpoint and DTO.
   Keep feature types local; use `types/map.ts` for genuinely shared Map/source
   contracts. CAPTCHA SDK types belong to auth registration, not its renderer.
4. Test meaningful request/owner/error behavior and the routed flow. Reuse
   `test/renderApp.tsx` when appropriate while showing auth choice and backend
   fixtures in the test. Run relevant tests, then the complete validation commands.

## Remaining legacy dependencies

Complexity estimates are relative implementation scope, not delivery promises.
No legacy frontend/backend is removed or modified by Phase 15.

| Feature/dependency                                | Reason and destination                                                                                                                                | React replacement                                                               | Blocks removal                                                  | Complexity                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------- |
| Billing, checkout, Stripe management/cancellation | Account, Terms and premium CTAs use `services/referenceFrontend.ts` -> configured reference entry with `view=account`; then original Stripe flow      | Account display exists; mutations/delegation remain legacy                      | Yes                                                             | High                                          |
| Account deletion                                  | React Account/Terms link to the same reference Account/password-confirmed delete flow                                                                 | Entry link exists; destructive flow is delegated                                | Yes                                                             | Medium/high                                   |
| Reference bridge/login handoff                    | Vite dev/preview `/reference/` proxies the old site on the same origin; production hosting must provide/configure its equivalent                      | React auth exists; bridge supports delegated actions and original token storage | Yes while actions are delegated                                 | Medium deployment/integration                 |
| CSS and lake source                               | `src/styles/index.css` imports `website/styles.css`, whose lake URL is bundled by Vite                                                                | Styling is reused rather than copied; runtime dist includes it                  | Yes for rebuilding without `website/`                           | Low/medium asset ownership                    |
| Favicon provenance                                | Original asset was copied to React public; source is used for integrity comparison                                                                    | Runtime/build copy already independent                                          | No, by itself                                                   | Low                                           |
| Not-found reference link                          | `NotFoundPage` uses `VITE_LEGACY_APP_URL` (default reference port 5500)                                                                               | Safe React fallback also exists                                                 | Link must be retired/redirected first                           | Low                                           |
| Old root/view/HTML/register links                 | React handles root, recognized view queries, index/chat/AGB aliases and register mode                                                                 | Yes; keep compatibility routes                                                  | No when origin/SPA deployment is correct                        | Low                                           |
| Reset email origin                                | Backend `public_app_url` defaults in code to reference port 5500 and emits `/?reset_password_token=...`; actual deployment settings need verification | React handles the exact link and cleans its token                               | Origin/deployment must point to React before retiring reference | Low configuration; mobile deep links separate |
| Email verification                                | Current email contains a six-digit PIN, no activation URL; React `/activate` handles it                                                               | Yes                                                                             | No verified link dependency to remove                           | Already migrated                              |
| Terms document hosting                            | URL is backend-configured and may use separate or shared hosting; preserve published version/hash/URL                                                 | React review/acceptance exists; document hosting is not owned by the frontend   | Conditional on the actual document host                         | Low deployment review                         |
| Admin/webmail                                     | Separate applications remain served by `website/`; they are outside this React migration and have no React routes                                     | No                                                                              | Yes if removing the entire website directory                    | Separate substantial scopes                   |

The configured Terms document, Google font links and Turnstile SDK are external
resource URLs, not imported legacy HTML. Verify document hosting before retiring
its origin and keep document URLs configurable. The public
`api_base` override and Vite reference/API settings remain trusted configuration
with legacy precedence; do not distribute untrusted API overrides.

## Android readiness

No Capacitor dependency, configuration or native bridge was added. This is a code
and documented-platform review, not an Android device test.

| Status                    | Finding and required work                                                                                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| READY                     | Declarative React UI, typed Bearer APIs, deterministic Map, plain-text Chat, visual-only text playback, no speech/file/download requirement and a packaged Vite build                                                                         |
| SMALL ADAPTATION          | Hardware Back/app resume/deep-link routing must reuse safe Router returns, modal Close and Journal flush semantics; browser focus/visibility listeners are not a native lifecycle bridge                                                      |
| SMALL ADAPTATION          | Review token/theme storage behind a platform adapter; JWT uses inherited localStorage, while passwords/reset tokens/drafts remain memory-only                                                                                                 |
| SMALL ADAPTATION          | Check minimum supported WebView for inert, CSS `:has`, matchMedia, fetch streams/TextDecoder and VisualViewport; test keyboard resize, textarea focus, scrolling, fonts and touch at real device sizes                                        |
| SMALL ADAPTATION          | External Terms/reference/Stripe links currently use `_blank` with noopener/noreferrer, not `window.open`; add an explicit platform navigation adapter if required                                                                             |
| BLOCKING BEFORE CAPACITOR | `resolveApiBase` treats localhost as desktop development and selects `127.0.0.1:8000` ahead of Vite API settings. A localhost native origin would target the device; define platform-aware API configuration and backend CORS before wrapping |
| BLOCKING BEFORE CAPACITOR | The Vite reference proxy does not exist in packaged assets. Decide hosted/native billing/deletion delegation and separate browser authentication; never pass JWTs in query strings                                                            |
| BLOCKING BEFORE CAPACITOR | Validate Turnstile with the chosen WebView origin/hostname, provider configuration and network access; current tests use a SDK double, not a real native challenge                                                                            |

Capacitor's documented default hostname is localhost, which makes the API-origin
blocker above a direct inference from this code. See [configuration](https://capacitorjs.com/docs/config).
Its [App API](https://capacitorjs.com/docs/apis/app) exposes Android Back and URL-open
events; integration remains future work. Its [storage documentation](https://capacitorjs.com/docs/apis/preferences)
notes that mobile localStorage may be cleared. Cloudflare documents the browser
and network requirements for [Turnstile in mobile WebViews](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/).

Native visual/keyboard/mobile verification is still pending because no browser
was available. DOM checks at 1440/768/390 test drawer logic, not typography or
pixel parity. Preserve the reference until those comparisons and delegated
feature replacements are separately completed and approved.
