# Frontend migration validation

## Phase 15 stabilization results

Checked on 2026-10-12. This section supersedes historical phase/status notes below.
The audit was completed before refactoring; see [ARCHITECTURE_AUDIT.md](FRONTEND_ARCHITECTURE_AUDIT.md).
Implementation and current conventions are in [ARCHITECTURE.md](../../frontend-react/ARCHITECTURE.md).

- **552 React tests passed in 25 files**, **zero failed/pending**, compared with the
  original **532** in twenty files. All original test declarations remain; no case
  or parameterized case was removed/skipped. Existing `act(...)` environment warnings
  remain non-failing. Final tests include **78 Chat checks**.
- Twenty added checks: five dialog focus/Tab/Escape/restore/hidden-state cases;
  three lazy-view loading/failure/recovery cases; one actual sign-in-error description;
  two NDJSON same-packet abort/reader cleanup cases; one late analysis-retry error;
  two pre-effect owner projection cases; three saved-history rendering/reaction
  cases; and three logical drawer widths (1440/768/390).
- The Chat controller suite is grouped into streaming, history and concurrency
  files, sharing only its existing explicit setup/cleanup. Chat/Map/Reflection UI
  tests share root provider rendering; auth choice, fixture data/actions/assertions
  remain in feature tests. Historical shell placeholders moved to test fixtures.
- **TypeScript compilation, production build and Prettier check pass.** Build
  transforms 205 modules. No package/dependency/lockfile or Python fixture changes.

Incremental validation passed 114 shell/Chat/Map/Reflection cases, then 232 relevant
transport/controller/UI cases and dedicated ownership/history checks. The first
full lazy-loading run exposed a real regression: React Suspense could retain the
closed Account form and its password fields until the next chunk resolved. Page
boundaries are now keyed by pathname, so local form state unmounts immediately;
persistent feature providers still survive navigation. The original pending-write
password test passed after this fix. Four existing navigation assertions now wait
for lazy content; their behavioral checks remain unchanged. Final complete runs
passed all 552 cases after the final shared-reference-link consolidation.

Architecture/correctness checks:

- Three provider/dialog runtime cycles are removed. Providers no longer import
  their own forms; `FeatureDialogs` owns composition and shared `DialogFrame`
  serves Map/Chat/Reflection. Form keys and hidden Terms lifetime remain intact.
- Chat's NDJSON reader is independent of session/HTTP and feature-event validation.
  UTF-8/chunk/final-line/malformed/ownership/retry/Stop behavior remains covered.
  Aborting during one event suppresses subsequent same-packet events; reader
  cancellation/release is verified. Late retry errors cannot leak into another chat.
- Map/Journal mask another owner's data synchronously before provider effects.
  Tests observe committed layout state during owner transition, not just final
  post-effect DOM. Existing same-owner draft/Terms/access behavior still passes.
- Saved Chat messages no longer subscribe to stream/composer context updates.
  Renderer-call checks show no repeated saved-message renders with unchanged
  inputs; pending reactions still update and stale-source clicks cannot target B.
- Journal 900ms debounce, dirty/baseline/inflight distinctions, serialization,
  flush-before-navigation and source races remain explicit and unchanged. Map
  remains deterministic without drag/zoom/pan; mutations use canonical graph data.
- Named ChatConversation/typed chat_info remove production double assertions;
  Turnstile SDK types moved out of its renderer. Shared reference Account URL
  construction removes duplicated Terms/Journal code and Account-feature imports.
- The unreachable placeholder route loop and unused reference-auth helper were
  removed. Billing/account deletion, old HTML/view/register/reset routes and live
  shell fixtures remain. CSS declaration behavior is unchanged; only stale comments
  were corrected. The resulting bundled CSS retains its pre-phase filename/hash.

Large-file review (line counts describe boundaries, not a reduction target):

| File                                   |          Before | After / separation                                           |
| -------------------------------------- | --------------: | ------------------------------------------------------------ |
| ChatController                         |             709 | 711; coherent generation/history/review ownership retained   |
| JournalController                      |             443 | 445; explicit per-date autosave queue retained               |
| MapController                          |             365 | 366; authoritative graph/selection coordinator retained      |
| sessionController                      |             239 | 239; shared lifecycle retained                               |
| ChatReviews                            |             478 | 66 plus independent TopicReview/NoteReview forms             |
| MapForms                               |             392 | 55 plus independent TopicForm/EntryForm                      |
| MapDetails                             |             350 | 216 plus independent EntryPreview                            |
| ApiClient                              |             197 | 161 plus NDJSON reader/error module                          |
| chatController.test                    |             782 | 362 plus stream/concurrency suites and existing setup helper |
| map.test / chat.test / reflection.test | 665 / 592 / 507 | 642 / 569 / 478 with shared root renderer                    |

Bundle investigation and result, decimal kB:

| Measure                                           |               Before |                                                            After |
| ------------------------------------------------- | -------------------: | ---------------------------------------------------------------: |
| Largest JS chunk                                  |               504.36 |                                                           310.33 |
| Initial JS graph, including static modulepreloads |               504.36 |                                                     about 424.65 |
| Initial gzip graph                                | 146.83 (Vite report) | about 128.68 (summed gzip; compression-method differences apply) |
| CSS                                               |                81.72 |                                                            81.72 |

Build metadata before changes attributed roughly 537kB React DOM, 214kB React
Router, 17kB React, 9kB scheduler, 4kB hookz and 339kB application code before
minification. Libraries contribute about 70% of this attribution total; these are
not independent compressed download sizes. Largest application modules were
ChatController/reviews, Map forms/details and JournalController.
The unchanged lake asset is about 2.02MB; JS graph sizes above exclude CSS,
fonts and images and are not a complete first-page network budget.

Ten pages and three conditional dialog presenters now load lazily; Terms and reset
handling remain eager. Shared root controllers are intentionally retained for
source metadata, drafts and background work. Vite's size warning is gone, without
manual chunk rules or hiding it by raising the warning limit. The full collection
of chunks is slightly larger than the original single chunk; this improves initial
loading, not total bytes. No blanket memo/callback optimization was introduced.

Relevant existing backend checks (repository root, declared Python dependencies):

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py tests/test_topic_attachment.py tests/test_reflection_context.py tests/test_map_editing.py tests/test_journal_and_password_reset.py -k 'llm_stream_acknowledges or free_chat_daily or free_user_can_receive or one_chat_can_be_connected or user_can_delete_only or failed_map_analysis or chat_recovers_once or chat_does_not_retry or ollama_chat_streams or ollama_does_not_save or topic_categories_and_connections or map_edit_during_chat or user_can_confirm_map_suggestion_and_complete_practice or test_new_topic_confirmation or explicit_map_save or existing_topic_stores or same_name_reuse or journal_existing_topic or chat_can_revisit or map_memories or legacy_long_description or daily_journal or password_reset_email' -q
```

**28 passed / 54 deselected**, with the existing FastAPI/httpx deprecation warning.
Temporary `PYTHONPATH=%TEMP%/feely-react-python-deps` supplied the declared Stripe
dependency; root environments/source/tests were not changed.

Disposable real HTTP/DB contracts all passed. Start each fresh fixture from root,
then run its matching Node script from frontend-react with Node available:

| Fixture command suffix                                 |  Port | Contract script                            |
| ------------------------------------------------------ | ----: | ------------------------------------------ |
| `scripts/isolated-registration-server.py --chat`       | 18016 | `scripts/validate-chat-contract.mjs`       |
| `scripts/isolated-registration-server.py --journal`    | 18013 | `scripts/validate-journal-contract.mjs`    |
| `scripts/isolated-registration-server.py --map`        | 18014 | `scripts/validate-map-contract.mjs`        |
| `scripts/isolated-registration-server.py --reflection` | 18015 | `scripts/validate-reflection-contract.mjs` |

Use the repository-root path `frontend-react/scripts/isolated-registration-server.py`
with `.venv/Scripts/python.exe`; restart fixtures before reruns. Assertions cover
real history/stream/cancel/quota/review/reaction/source ownership, Journal save/date/
analysis, Map mutation/link/merge/metadata/serialization, atomic Reflection and
auth/Terms/capability/user isolation. Parallel SSR harnesses logged non-failing
unused WebSocket-port collisions; run the Node contracts serially to avoid those
diagnostics. Fixtures use disposable SQLite and process-local provider/captcha/mail
doubles, not external services or live data. They are unchanged in this phase.

**38 unchanged legacy JS tests passed**, using the Phase 14 command below. Integrity:
all **181 tracked files outside frontend-react remain byte-identical** to the saved
pre-phase hash baseline; the unchanged git diff check passes. **34 public legacy
files/index match disk bytes** through reference 5500 and both dev/preview bridges.
Aliases remain intact. All **13 dev/preview routes** serve entry markup;
**43 Chat/Map/Journal/Reflection modules** and new shared modules transform. Preview
files equal the final built files. Fonts/favicon/lake are preserved and fixture
secrets/historical placeholder content are absent from production chunks.

Security review found no production JWT/password/content logging, persisted
passwords/reset tokens, CAPTCHA secrets, eval or unsafe HTML rendering. Returned
content remains escaped React text; source paths are encoded, safe return routes
are constrained and external links keep noopener/noreferrer. JWT localStorage and
trusted API-base override behavior remain inherited contracts. Reset URL cleanup
stays eager; page-boundary tests protect credential unmount behavior.

No available browser was discovered. **Native visual parity is not verified**:
1440/768/390 checks cover DOM/media/drawer behavior, not screenshots, typography,
spacing, color, native focus/touch/keyboard/scroll or actual viewport rendering.
No unsupported-browser/Android device claim is made. Intentional differences are
lazy loading/recovery, stronger focus/owner/abort guards, existing controlled
dialogs and routed Account/Feedback/Terms panels; the visual design is preserved.

Android remains **blocked before packaging** by desktop localhost API precedence,
packaged reference bridge/auth integration and unverified real Turnstile origin
support. Storage, hardware Back/app resume, external URLs and keyboard/WebView
support require platform adaptation/device tests. Capacitor was not installed.
Remaining dependencies, destinations, complexity and removal blockers are
inventoried in [ARCHITECTURE.md](../../frontend-react/ARCHITECTURE.md#remaining-legacy-dependencies).

Task-owned reference/preview/fixture servers are stopped after validation; the
pre-existing dev server on 5173 is left running. Legacy deletion is not authorized
or performed. Visual verification and delegated feature replacement remain future
work, not claims of complete deployment/device parity.

## Dedicated formatting/readability pass results

Checked on 2026-10-12 after Phase 14, before Phase 15. No intentional feature,
design, backend-contract or architecture changes. The legacy/reference tree is
read-only and no working functionality or tests were removed.

- Added pinned local **Prettier 3.9.10**, normal `.prettierrc.json` with **100-column
  print width**, `.prettierignore`, and `npm run format` / `npm run format:check`.
  Formatting uses two-space indentation, single quotes, trailing commas and LF.
  No existing ESLint configuration/dependency was found; no rule set was added.
- All **168 pre-existing supported frontend files** were checked/formatted:
  **149 TS/TSX**, one CSS, four JSON, nine MJS validation scripts, one HTML and
  four Markdown. **153 existing files changed**, plus the new formatter files
  and generated npm lockfile update. Unsupported Python fixture scripts and
  generated dependencies/build files are excluded.
- Before local readability edits, all **167 files** other than changed
  `package.json` matched Prettier's output of the saved original text exactly.
  The remaining edits are small local branch/variable extractions, not rewritten
  controllers or relocated responsibilities. They replace nested status/title/
  dialog-label choices, name dense dialog/ownership/suggestion conditions, and
  separate previously combined hook/timer declarations. Request sequencing,
  ownership guards, API paths/payloads, copy and timing values remain intentional
  invariants. Tests were formatted without adding helper layers or reducing coverage.
- Severe compressed code improved: ChatController's widest line **306 -> 100**,
  MapController **363 -> 100**, ReflectionController **284 -> 99**, SessionController
  **155 -> 99**; Chat UI tests **1200 -> 119**, Map UI tests **778 -> 122**, Journal
  UI tests **218 -> 130**. Longer test names/literal copy/comments may legitimately
  exceed print width; preserving values is preferred to changing copy for wrapping.
- **Complete React suite: 532 passed in 20 files**, including all 72 Chat checks
  and every prior feature regression. No tests were added, removed or skipped in
  this pass. Existing test-environment `act(...)` warnings remain non-failing.
- **TypeScript compilation and production build: passed**, 196 modules. Vite's
  existing over-500kB JS chunk warning remains (504.36kB minified, 146.83kB gzip).
  No bundling/architecture refactor was undertaken.
- **`npm run format:check`: passed** against the finished tree.
- A saved SHA-256 baseline confirms **all 181 tracked files outside
  `frontend-react/` are byte-identical**, including legacy frontend/assets, backend,
  root tests and docs. `git diff --exit-code -- website app tests README.md STARTUP.md
.gitignore` also passes; git status contains only the existing untracked React
  directory. No backend/live-contract/browser revalidation was claimed in this
  formatting-only pass; their Phase 14 results and limitations remain below.

Phase 15 has not started. Formatter settings and commands are documented in
[README.md](../../frontend-react/README.md#formatting-and-readability).

## Phase 14 final results (resumed validation)

Checked on 2026-10-12 against the existing Phase 14 working tree. The implemented
Chat was retained; only reproduced bugs were fixed. All writes remain inside
`frontend-react/`. Earlier phase sections below are historical results.

- Complete **`npm test -- --reporter=dot`: 532 passed**, twenty files: the previous
  **460** feature checks plus **72 Chat checks** (43 parser/controller/cadence/race
  checks and 29 routed UI checks). Shell/session, Login/registration/CAPTCHA,
  activation/recovery/reset, Feedback/Terms, Account/profile/password, Journal,
  Map and Reflection regressions all pass. Existing test-environment `act(...)`
  warnings remain; they did not fail tests or require timeout changes.
- **`npm run typecheck` and `npm run build`: passed**, 196 modules. No dependency
  or lockfile changes in Phase 14. Vite warns that the 504.14kB minified JS chunk
  exceeds 500kB (146.61kB gzip); splitting is deferred to Phase 15.
- The first resumed full-suite result was 515 passed/one failed: the upward-scroll
  test expected text in one node after phrase spans were introduced. It now checks
  complete rendered text and still verifies no automatic scroll after scrolling up.
- Strengthened tests reproduced and verified four targeted fixes: failed A retry
  reconciliation cannot display its error in B; losing Map access closes an otherwise
  invisible note review; immediate selection polling follows with the original
  700ms delay; returning to A keeps Stop usable during a pending history read.
- Additional tests verify different new messages, duplicate retry clicks, typing
  during reconciliation, delayed reaction/review success/failure after selection,
  repeated mutations, authoritative failed reactions and explicit retry, unmount
  suppression, deleted-history/late-stream suppression, B not cancelling A,
  detached/returning phrase playback, 402/429 and missing Map conversation sources.

Chat protocol/behavior checks:

- Server order and array message order are retained, with local blank startup,
  first-send `{}` creation, returned ID adoption and one canonical exchange.
  Selecting A then B suppresses A's late detail; old list snapshots cannot undo
  saved generation or resurrect deleted conversations.
- `POST /llm/message/stream` sends `{chat_id,context}` once. NDJSON status,
  `text_delta`, `result.data` and error events use the existing shared Bearer
  session semantics. UTF-8 boundaries, blank lines, unterminated final line and
  exact ordered deltas pass; malformed JSON, missing result, unknown event and
  wrong-chat result produce errors instead of claiming persistence. POST is never
  automatically replayed or replaced with `/llm/message`.
- A's generation continues when B is selected or Chat is hidden; only A changes.
  Stop aborts the selected owning request, removes optimistic/partial display,
  restores sent text into an empty composer and retains newer typing. Deletion
  aborts its request and tombstones its ID; uncooperative late results are ignored.
- Identical retries after uncertain failure first read persisted history. A saved
  next exchange is adopted without another POST; an unsaved attempt sends again
  against the same ID. Different new text bypasses reconciliation. Pending guards
  prevent concurrent preflight; newer composer text is not overwritten. The backend
  has no idempotency key, so history-check/send races with other clients and lost
  acknowledgements after commit cannot be guaranteed duplicate-free.
- Reactions use assistant `created_at`, exactly `like`/`dislike`/`null`, and canonical
  returned reaction. No optimistic success or invented message ID is used; pending
  repeats are blocked, failed values stay unchanged and late results belong to A.
- Topic/note reviews preserve original fields, targets, copy, trim/fallback and
  failed edits. Equal polling data preserves review edits; retry analysis has no
  body and never resends the message. Review mutations update the existing serialized
  Map resource; switching source cannot consume B's suggestion or display A's error.
  Backend topic suggestion IDs prevent already-reviewed acceptance when supplied.
  Note acceptance has no equivalent unique key; pending guards do not imply
  cross-client/repeated acceptance idempotency.
- Map uses loaded authoritative Chat titles, unchanged source IDs and Router
  `state.chatId`. Missing/deleted sources retain IDs, use a generic label and show
  the backend 404 rather than another conversation. Manual Map additions inherit
  the selected chat. Deleting a chat does not unlink Map IDs. No additional Journal
  creation/analysis/write is performed by Chat.
- Text playback is visual phrase cadence, not speech. Timer tests cover punctuation
  pauses, partial/final words, reduced/hidden instant mode, finish/cancel and detached
  conversation ownership. No speech/browser playback API was introduced. Native
  rendering and older-browser support remain outside these checks.
- Security inspection found no production Chat/API JWT/content logging, raw HTML
  injection, DOM queries/manual event bindings or dynamic code evaluation. Model
  text and titles render as escaped React text; no automatic model links exist.
  Trusted route IDs are encoded by API helpers. Private drafts remain in memory.

Existing backend checks, from repository root with declared packages available:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py tests/test_topic_attachment.py -k 'llm_stream_acknowledges or free_chat_daily or free_user_can_receive or one_chat_can_be_connected or user_can_delete_only or failed_map_analysis or chat_recovers_once or chat_does_not_retry or ollama_chat_streams or ollama_does_not_save or topic_categories_and_connections or map_edit_during_chat' -q
```

**17 passed / 58 deselected**, including real stream acknowledgement, free daily
quota, free topic semantics, owned deletion, provider partial/recovery behavior,
analysis retry, topic metadata and Map-edit-during-generation merge. Existing
FastAPI/httpx deprecation warning remains. Temporary
`PYTHONPATH=%TEMP%/feely-react-python-deps` supplied declared missing Stripe without
changing the repository environment. Backend tests/source remain unchanged.

Disposable real HTTP/DB Chat contract (restart the fixture before each run):

```powershell
# Repository root, terminal 1
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --chat
# frontend-react/, terminal 2, Node available
node scripts/validate-chat-contract.mjs
```

**Passed**, including the expanded resumed checks, against loopback 18016 and
disposable SQLite. Real routes/schemas/JWT/Terms/transactions/quota/source models
are unchanged. Only model delay, local Siteverify, captured delivery and fixture
state are test-only; no external model, SMTP, payment or live database is used.
Fixture output never prints JWTs or conversation content.

Contract checks real owned list/create/detail/delete, UUID IDs/empty history,
user/assistant order/shared timestamp, persisted reaction toggles and missing
timestamp 404; actual status/delta/result NDJSON and complete exchange; free daily
429 versus separate minute-rate 429; free topic/note acceptance 402 and dismissal
allowed; Premium topic/existing-topic/note/practice/manual Map source IDs;
Map edits during generation; cancellation before delayed provider completion with
empty persisted history; analysis-only retry preserving history; 8001-character
422; 401/423/Terms acceptance and other-user list/read/delete isolation. The topic
already-reviewed 409 assertion uses the offered suggestion ID when analysis
provides one; otherwise the documented no-suggestion-ID backend schema path is used.
Cancellation after commit cannot roll back an already-saved exchange.

Unchanged legacy checks:

```powershell
node --test tests/map_node_render.test.cjs tests/topic_confirmation_ui.test.cjs tests/session_expiry.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs tests/chat_controls.test.cjs tests/chat_text_player.test.cjs tests/chat_map_polling.test.cjs
```

**38 passed.** No legacy test or source was edited.

Final integrity/serving checks passed: **34 public legacy files**, including index
at `/`, match disk bytes on reference 5500 and both dev/preview reference bridges;
`/chat.html` retains its redirect. All **13 routes** serve React entry markup on
dev 5173 and preview 4173; **38 Chat/Reflection/Map/Journal modules** plus five
modified shared modules transform successfully. These are serving checks, not
browser UI checks. Preview files match build bytes; original Chat/Map/Journal/
mobile selectors, DM Sans/Manrope links, favicon and lake asset remain. Fixture
secrets are excluded from the production bundle.
`git diff --exit-code -- website app tests README.md STARTUP.md .gitignore` passed;
git status contains only the existing untracked `frontend-react/` directory.

No browser was available (`browsers.list()` returned `[]`, selection reported
no available browser). Screenshots and native focus/Back/Forward/touch/mobile/
keyboard/viewport behavior remain unverified. React review dialogs use original
CSS with controlled focus/inert handling rather than native `showModal`.
History-load errors are explicit; retry reconciliation and stale-work suppression
are deliberate protections beyond the global legacy handlers. Backend Overall/null
note routing may fall back to an already-linked topic; no domain rewrite was made.
Reference-only billing/account deletion, broader visual/accessibility/Android
readiness and bundle splitting remain deferred. Phase 15 has not started.

Changes since the interrupted run: `ChatController.ts`, `ChatComposer.tsx`,
`chatController.test.ts`, `chat.test.tsx`, `isolated-registration-server.py`,
`validate-chat-contract.mjs`, and frontend-only `README.md`, `MIGRATION.md`,
`VALIDATION.md`. Existing Chat components were not regenerated. Task-owned
fixture/reference/preview servers are stopped after checks; the pre-existing
development server on 5173 is left running.

## Phase 13 results

Checked on 2026-10-12. `/reflection` is now the real practice-completion modal over
Map. All changes stay in `frontend-react/`; legacy/backend, existing root tests,
root docs and `.env` are unchanged. Chat, billing and deletion remain deferred.

- Complete **`npm test`: 460 passed**, eighteen files: all previous **409** checks
  plus **51 Reflection checks** (21 controller/source/race tests, 30 routed UI tests).
  All shell/session/auth/CAPTCHA/activation/recovery/reset, Feedback, Terms, Account/
  password, Journal and Map regressions pass. Historical shell fixtures explicitly
  supply a Reflection placeholder; production does not.
- `npm run typecheck` and `npm run build`: passed, 186 modules. Original dialog,
  Map/mobile/Journal CSS, fonts and assets remain bundled. No new dependency or
  package-lock change. Four-worker test concurrency preserves existing timeouts.
- First unrestricted full run hit twelve cold-start/DOM-worker timeouts at the
  existing 5-second limit. The same suite passed with maxWorkers=4; configuration
  now bounds workers, with no timeout increase, test removal or coverage reduction.
- Routing/source checks: Map action/direct valid Router state, missing/invalid ID,
  wrong-kind/missing/deleted Practice, GET loading/error/retry, already-completed
  read-only value, paused completion, fixed safe Map return, selected detail
  restoration and simulated Router Back. No invented standalone Reflection API.
- Original prompt/copy/IDs/classes/rows/optional/no client max, controlled text,
  focused input once loaded, Tab boundaries/inert background and Close/Escape pass.
  Backdrop clicking does not dismiss Reflection, matching native legacy semantics.
- Submission checks: exactly one authenticated PATCH `{status:"completed",
reflection:answer.trim() || null}`, empty/whitespace null, pending copy/doubles,
  no optimistic completion, canonical returned text/Map/source metadata, same-ID
  retry and no extra Reflection entity. Completed Map entries show saved text.
- Recoverable 422/backend/network/429 errors retain raw answers and do not replay
  writes. Malformed/wrong-status/wrong-field/Map-inconsistent DTOs cannot claim
  completion. Already-completed source is read-only, while backend repeat PATCH
  is allowed and updates the same field, not a duplicate record.
- Source/read/submit/owner races pass: A read after B navigation, answers typed
  during pending success, failed save with input retained, pending close/navigation,
  stale return suppression, refresh failure after successful completion, source
  deletion and token change before provider effects. Normal Map selection and
  pause/resume/reactivation remain unaffected; shared write serialization is reused.
- Authentication/Terms/capability and server 401/403/402/423 pass. 401 clears private
  drafts; 403 keeps JWT/answers; real Terms review/acceptance and existing-token
  email activation both restore the same source/answer. Only practice ID/resume
  metadata enters routing; answers stay in feature memory, not auth/storage/URL.

Existing backend checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'user_can_confirm_map_suggestion_and_complete_practice' -q
.\.venv\Scripts\python.exe -m pytest tests/test_reflection_context.py tests/test_map_editing.py tests/test_topic_attachment.py tests/test_journal_and_password_reset.py -q
```

**1 passed / 68 deselected**, then **13 passed** (14 targeted tests total).
The selection includes the existing real practice completion test, two stored
reflection/context tests and Map/topic/Journal/reset regressions. Existing FastAPI/
httpx warning remains. Temporary `PYTHONPATH=%TEMP%/feely-react-python-deps` supplies
the declared missing Stripe dependency without changing the root environment.

Unchanged legacy checks:

```powershell
node --test tests/map_node_render.test.cjs tests/topic_confirmation_ui.test.cjs tests/session_expiry.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs
```

**25 passed.** No legacy test/source was edited.

Actual disposable Practice -> Reflection -> Map/Journal contract, from root with
declared Python packages available:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --reflection
```

From `frontend-react/` in another terminal with Node available:

```powershell
node scripts/validate-reflection-contract.mjs
```

**Passed against the final implementation.** New mode uses loopback 18015,
disposable SQLite, synthetic accounts and unchanged real routes/schemas/DB/JWT/
Terms/premium gates. Mock Journal analysis/local Siteverify/captured delivery stay
fixture-only; no SMTP/payment/live DB or private-data logs. Restart before reruns.

Contract verifies GET Map source, practice creation/reference/source metadata,
one atomic completion PATCH/returned practice+Map, trim/null/paused/reactivate,
server 2000/2001 boundary, raw draft retention after validation failure, canonical
ID/status/creation timestamp and selected topic, readonly completed UI controller,
backend repeated completion replacing one field without duplicate entries,
missing/wrong-kind 404, real Journal-generated practice/source-date preservation,
unchanged Journal text, 401/402/423, Terms acceptance and other-user isolation.
There is no separate Reflection endpoint/ID/configuration or partial two-write
completion sequence to validate. A confirmed response does not require another GET.

Final integrity/serving checks passed: all **34 public legacy files** match disk
bytes, including Reflection markup and original Map completion handlers. All
thirteen tested dev 5173/preview 4173 routes serve; **28 Reflection/Map/Journal
modules** and shared shell/Terms/auth handoff modules transform successfully.
Preview files match build bytes; original dialog/Map/Journal/radio/mobile selectors,
DM Sans/Manrope links and lake/favicon remain. Fixture secrets are excluded from
the production bundle. `git diff --exit-code -- website app tests README.md
STARTUP.md .gitignore` passed. Task-owned fixture/reference/preview servers were
stopped; the existing development server on 5173 was reused and left running.

Browser selection found no available browser (`[]`). Screenshots and native
Back/Forward/focus/touch/mobile behavior remain unverified; DOM/timer/race/backend
checks do not establish complete visual parity. Controlled React dialog/Router
state replace native showModal/global IDs; direct missing/completed sources have
safe explicit states. Errors are inside the modal rather than legacy behind it,
and newer typing remains for an explicit same-field save after an older success.
Close does not cancel an already-sent write; late persistence cannot redirect a
new source/route. Explicit closing/new opening/logout clears drafts; no offline
storage or intrusive unsaved prompt was added. Cross-client last-writer-wins is
still the backend's behavior. Keep legacy until full parity is verified.

## Phase 12 results

Checked on 2026-10-12. Changes stay in `frontend-react/`. `/map` now uses real
backend data and preserves the original custom HTML/SVG renderer. Reflection,
Chat, billing and deletion remain deferred/reference actions. Legacy/backend,
existing tests, root docs and `.env` remain unchanged.

- Complete `npm test`: **409 passed**, sixteen files: all previous **346** checks
  plus **63 Map checks** (31 API/controller/layout/race tests, 32 routed UI tests).
  All Journal, shell/session, auth/CAPTCHA/activation/recovery/reset, Feedback,
  Terms, Account/Profile and password-change regressions pass. Historical shell
  fixtures explicitly inject a Map placeholder; production uses the real feature.
- `npm run typecheck`: passed. `npm run build`: passed, 180 modules; original
  CSS/fonts/assets are retained. No dependency/package-lock changes in Phase 12.
- Map rendering coverage: real/empty/malformed/loading/error/retry, Overall, node
  data, counts/category colors, parent direction, symmetric related deduplication,
  filtered endpoints, desktop slots/clamps, mobile two-column/growing board,
  parent-first/sidebar ordering/orphans/cycle guard, selection/close/reopen/filter.
- Pointer/wheel checks prove no invented dragging, position writes, zoom or pan.
  Legacy has no such interactions/endpoints/persisted coordinates. Tests verify
  edge endpoints derive from the same node positions, including filtered layout.
- Topic creation/editing/merge/delete, original trim/limits/radios/parent/related
  fields, Under/Contains/Related disconnection, original confirmation/cancel and
  exact methods/payloads pass. Backend-normalized full responses reconcile Map;
  no optimistic server mutation was introduced.
- Entry creation/edit/move/delete, practice create/pause/resume/reactivation,
  latest-three/reverse previews, more/less and menus pass. Existing practice
  reflection displays and reactivation clears it with `{status,reflection:null}`.
  Complete goes to the deferred Reflection route with practice ID and makes no
  completion mutation. Chat links retain ID without migrating Chat content.
- Failure coverage includes initial read, network/no write replay, server length/
  hierarchy errors, malformed/wrong-identifier writes, preserved graph/form text,
  pending duplicate/close protection, and explicit retry clearing resolved errors.
  Capability/Terms/unauthenticated/401/402/403/423 semantics use existing session
  helpers and backend errors, with real verified-access refresh.
- Concurrency coverage: ignored late GET despite transport ignoring abort,
  unmount/route leave/old-owner data, pending duplicates, overlapping full-profile
  writes, newer selection during mutation, deleted selection, stale refresh after
  delete, Journal review waiting for Map writes and invalidating older graph reads,
  queued old-owner payload rejection, and hidden-workspace no-refetch behavior.
- Journal review -> navigate Map shows the accepted topic/date without reload;
  Map -> Journal opens its real linked date/loading/error. Same-route session/Terms
  gating retains hidden local form drafts, and explicit route leave clears dialogs.
  DOM checks cover modal inert background, focus return/Tab boundaries, mobile
  drawer closing and refreshing the active Map tab without duplicate history.

Existing backend and legacy checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_map_editing.py tests/test_topic_attachment.py tests/test_journal_and_password_reset.py -q
node --test tests/map_node_render.test.cjs tests/topic_confirmation_ui.test.cjs tests/session_expiry.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs
```

**11 backend tests passed**, including existing Map editing, topic attachment,
Journal and password-reset regression coverage; **25 legacy JavaScript checks
passed**. The existing FastAPI/httpx TestClient deprecation warning remains.
The declared missing Stripe dependency was provided by temporary
`PYTHONPATH=%TEMP%/feely-react-python-deps`, without modifying root dependencies.

Actual isolated Map/Journal contract: from root with the declared Python packages
available, start a fresh fixture:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --map
```

From `frontend-react/` in another terminal with Node available:

```powershell
node scripts/validate-map-contract.mjs
```

**Passed against the final implementation.** Map mode binds 127.0.0.1:18014 with
disposable SQLite, synthetic accounts, mock Journal analysis and local Siteverify
transport. Real unchanged routes, schemas, authorization/profile persistence,
premium capabilities and Terms acceptance run. Private fixture controls affect
only synthetic subscription/publication state; no SMTP/payment/live DB calls,
token/password/content logs or backend source changes. Restart before rerunning.

Contract validates Bearer 401, capability/server 402 and verified grant/reload,
empty Map, UUID IDs/server timestamps/no position field, trimmed same-name reuse,
category/long description, parent/self/cycle validation, related dedup/symmetry/
missing-target errors, topic/entry length 422, entry create/edit/move/delete,
practice pause/reactivate/wrong-kind errors, relationship removal, merge source
preservation, deletion to Overall, missing entities 404, real Journal analysis/
review/topic/date/source metadata, overlapping serialized writes retaining both
updates, enforced Terms 423/acceptance recovery and other-user isolation.

Final serving/integrity checks passed: **34 whitelisted public legacy files** match
disk bytes, including original Map/Journal/sidebar HTML and navigation/feature JS.
Development 5173 and preview 4173 serve all thirteen tested route URLs; **22 Map/
Journal feature modules** and changed shared modules transform. Preview build files
match disk; original Map node/link/detail/popup/mobile selectors, radio/Journal CSS,
DM Sans/Manrope links and byte-identical lake/favicon remain. Fixture secrets are
excluded from the production bundle. The existing development server already held
5173; strictPort refused a duplicate launch and that server was reused. It was
left running. Task-owned fixture/reference/preview servers were stopped afterward.
`git diff --exit-code -- website app tests README.md STARTUP.md .gitignore` passed.

Browser discovery returned no browser (`[]`), so screenshots, native Back/Forward,
touch/focus/mobile rendering remain unverified. DOM/layout/race/backend contracts
pass, but do not establish full visual parity. Known scope differences: Reflection
completion is deferred; Chat conversation labels/source context remain generic/
null until Chat migration; billing delegates reference Account; confirmations use
controlled React dialogs with original CSS rather than imperative native dialogs.
Navigating to Terms/another route closes unsent Map forms, even though same-route
gating preserves them. There is no backend ETag/version conflict protocol, so
multiple tabs/clients retain last-writer-wins behavior; no offline persistence was
added. Legacy must remain the reference until those parity gaps are resolved.

## Phase 11 results

Checked on 2026-10-12. All changes remain in `frontend-react/`. `/journal` is a
real feature; Map, Reflection and Chat pages, billing and deletion stay deferred.
Legacy frontend/backend, existing tests, root docs and `.env` remain unchanged.

- Complete `npm test`: **346 passed**, fourteen files: all previous 290 checks
  plus **56 Journal checks** (31 controller/API/date/race tests, 25 routed UI tests).
  The historical shell fixture still tests the placeholder explicitly; production
  uses the real Journal route. All previous feature regressions remain covered.
- `npm run typecheck`: passed. `npm run build`: passed, 168 modules. Journal,
  suggestion/radio/mobile CSS, original fonts, lake and favicon are retained.
  One runtime dependency, `@react-hookz/web`, delegates visibility subscriptions;
  package/lock stay frontend-only. Installation audit reported zero vulnerabilities.
- Loading coverage: existing/missing day, explicit loading, independent entry/
  history failures and retry, malformed/wrong-date responses, raw content/limits,
  no unchanged writes, authenticated 401 expiry and capability/Terms gates.
- Autosave coverage: exact 900ms debounce and `{content}` PUT, saving/saved/error,
  no identical duplicates, serial requests, newer typing during a save, queued
  older debounce after a newer edit, revert during a pending write, failed save
  with newer text retained and explicit/legacy retry behavior.
- Navigation/race coverage: previous/next/today/history/future restrictions, local
  calendar/noon/DST arithmetic, first visit across midnight, active-workspace
  refresh, flush before date/route changes, continued typing during that flush,
  rapid date changes, ignored stale entry/history/topic-option responses, drafts
  across workspace/Terms/loading transitions and owner-change isolation.
- Gate/recovery coverage: server 402 and verified access refresh, 423 retaining
  the draft through Terms, save 403 retaining JWT/text and allowing existing email
  activation recovery. The denied editor is read-only. Other failed route-leave
  saves keep Journal selected with the unsaved draft and retry control.
- Original Journal analysis/suggestion acceptance/dismissal/type/category/topic
  fields, exact nullable payloads, pending/reviewed controls and analysis errors
  pass. This narrow dependency exercises real map writes/options, not a Map page.
- Simulated visibility/beforeunload dispatch checks keepalive and dirty protection.
  Tests verify dirty is cleared only on confirmed success, not at request dispatch.
  Real browser termination/keepalive delivery is not guaranteed by these tests.

Existing backend and legacy checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_journal_and_password_reset.py tests/test_topic_attachment.py -k 'journal' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/session_expiry.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs
```

**4 passed / 5 deselected** in the first selection, **6 Terms/backend tests
passed**, **18 legacy JavaScript checks passed**. Pytest's module-name matching
also selects the existing password-reset test in the Journal/reset module; the
four are not all Journal-only test functions. Journal premium gating, mock-LLM
retry/analysis and topic attachment are covered. The existing FastAPI/httpx warning
remains. Missing declared Stripe dependency was supplied from temporary
`PYTHONPATH=%TEMP%/feely-react-python-deps`, without modifying the root environment.

Reproducible isolated contract: start a fresh disposable fixture from root, with
the declared Python requirements (or that temporary PYTHONPATH) available:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --journal
```

In another terminal, from `frontend-react/` with Node available:

```powershell
node scripts/validate-journal-contract.mjs
```

**Passed.** Journal mode binds loopback port 18013 with disposable SQLite, synthetic
accounts, mock analysis and a local Siteverify transport. Real unchanged routes,
schemas, authorization, unique user/date persistence and Terms acceptance run.
Private fixture controls adjust only synthetic subscription/publication state;
no SMTP/payment/live database or token/content logs are involved. Restart the
fixture before rerunning, so seeded accounts and rows are fresh.

The contract checks missing Bearer 401, paid capability/server 402, grant/reload,
lazy empty GET/no row, history limit/date/count/metadata, exact raw PUT and stable
created_at, content/extra-field/invalid-date 422, explicit persisted empty rows,
backend-allowed future dates, real analysis/suggestion review/topic linking,
duplicate review 409, analysis staleness after edits, controller flush persistence,
Terms 423/acceptance recovery and separate-user isolation. No backend behavior was
changed to accommodate React.

Final serving/integrity checks passed: all **34 existing whitelisted public legacy
files** match disk bytes; original Journal/sidebar HTML and Journal/navigation JS
are included. React dev 5173 and production preview 4173 serve all thirteen tested
route URLs; all twelve Journal modules and the changed main/header/sidebar modules
transform successfully. Built files match preview responses, original CSS selectors/
font links/lake/favicon remain present, and fixture passwords/secrets are excluded
from the bundle. `git diff --exit-code -- website app tests README.md STARTUP.md
.gitignore` passed. Test/preview/reference fixture servers were stopped afterward.

Remaining limits: browser discovery returned no available browser, so screenshots,
native Back/Forward, focus/mobile rendering and actual page-close/visibility delivery
remain unverified. Normal asynchronous interactions are covered by DOM/timer/race
tests. Keepalive is best effort under browser size limits/offline/forced closure;
drafts are session memory only and clear on logout/expiry. Multiple tabs/clients
remain last-writer-wins because the backend has no version/ETag conflict protocol.
View Premium delegates to reference Account. Map graph/active selection rendering
is deferred even though Journal's own reviewed additions are persisted.

## Phase 10 results

Checked on 2026-10-12. Changes remain in `frontend-react/`; legacy frontend,
backend, existing tests, root docs and `.env` are unchanged.

- Complete `npm test`: **290 passed**, twelve files: all 266 previous checks plus
  24 password-change checks. The obsolete reference-password link expectation now
  checks the React Security form; billing/deletion delegation checks remain.
- `npm run typecheck` and `npm run build`: passed, 93 modules. Original Account
  grid/section/mobile/font CSS and assets remain bundled; no dependencies added.
- Coverage: original fields/copy/grid/required-current/has_password behavior,
  requested client-only confirmation, shared minimum, blank/whitespace/mismatch,
  exact raw PATCH payload/Bearer/default credentials, full Account response/shared
  update, clearing all fields/remaining in Account, unchanged JWT/capabilities/Terms,
  passwordless-provider transition and allowed identical-password reuse.
- Pending/double protection, wrong-current 403, server current/new max 422, no
  secret input in validation text, rate limit, network/no replay, backend/malformed/
  wrong-account response, 401/session clearing/Login, signed-out gate, Terms
  exemption, Profile/password coordination/dirty-draft preservation, close/reopen
  password clearing/pending guard and stale-session protection also pass.
- All shell/session/API/Login/registration/CAPTCHA/activation/recovery/reset/
  Feedback/Terms/Account/Profile regressions pass. No passwords appear in storage,
  navigation state or rendered success/error text in the checks.

Existing targeted backend/legacy checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'user_can_edit_account_change_password_and_delete_account' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/session_expiry.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs
```

**1 Account/Profile/password test passed, 68 deselected; 6 Terms/backend tests
passed; 18 legacy JavaScript checks passed.** The existing combined Account test
also deletes only its synthetic test user; React deletion was not migrated/called.
Existing FastAPI/httpx TestClient warning remains. The declared missing Stripe
dependency was supplied by temporary PYTHONPATH `%TEMP%/feely-react-python-deps`,
without changing root environment/dependencies.

Reproducible actual authenticated password-change contract with disposable SQLite,
synthetic accounts, mock LLM and local Siteverify transport. From root:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --password-change
```

Then from `frontend-react/` with Node/npm available:

```powershell
node scripts/validate-password-change-contract.mjs
```

**Passed.** New fixture-only mode binds 127.0.0.1:18012; earlier modes keep their
defaults. Routes/DB password verification/JWT creation/validation stay real and
unchanged. Private fixture controls create a historical passwordless account,
mint another synthetic user token, change a process-local publication and exercise
the general HTTP limiter. Those controls are not backend source or production
frontend endpoints. No SMTP/Cloudflare/payment/live DB calls or password/JWT logs.
Stop with Ctrl+C when done.

Contract validates missing Bearer/client session, exact PATCH/account DTO, wrong/
missing current password 403, new min/max 422, same-password acceptance, raw new
password Login, old-password rejection, no token/secret in response, current and
second distinct JWT both remaining valid, controller canonical account/capability
preservation, passwordless current-null/provider change, Terms exemption and
Profile PATCH after change. Actual general middleware 429/Retry-After is tested;
no password-specific limiter or proactive revocation semantics were invented.

- Reference 5500, dev 5173 and production preview 4173 started successfully; all
  **34** actual allowlisted legacy assets matched source bytes. Dev/preview routes
  and proxy Account/auth/shared scripts remained runnable/unchanged.
- All six password/Account API/guard modules transformed through Vite. Original
  Account/grid/full-width/mobile/fonts stayed bundled; lake/favicon matched
  reference. Fixture password and Siteverify secret were absent from production JS.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Password source has no manual DOM queries/listeners/HTML loading, direct
  fetch, password logging/storage, cookie/CSRF/token lifecycle, billing/deletion calls.
- Browser selection failed; troubleshooting discovery returned an empty list.
  No real screenshots/mobile/focus comparison was possible. DOM/API/contracts
  do not establish full visual parity. Requested confirmation, localized password
  status, coordinated writes and retained routed Account presentation are documented.

Earlier phase sections below record historical scope/results.

## Phase 9 results

Checked on 2026-10-12. Changes stay in `frontend-react/`; legacy frontend/backend,
existing tests, root docs and root `.env` remain unchanged.

- Complete `npm test`: **266 passed**, eleven files: all previous 223 checks plus
  43 recovery/reset checks. Login's old reference-recovery expectation now checks
  `/forgot-password`; previous feature behavior coverage remains intact.
- `npm run typecheck` and `npm run build`: passed, 89 modules. Build retains the
  original password-reset/dialog/mobile/font styling and assets.
- Request coverage: original UI/Login email prefill/native validation, exact public
  JSON/default credentials, equivalent existing/unknown/disabled generic success,
  loading/pending duplicates/no invented cooldown, 422/503/delivery/network/429/
  malformed errors, retained email and unchanged existing JWT on public requests.
- Reset coverage: compatible explicit/root/HTML/Login query entries, memory-only
  token and immediate Router URL cleanup, no token in rendered links/history state/
  UI/storage, missing/malformed links, original fields/confirmation/native minimum/
  backend maximum, mismatch, exact unmodified password/token payload, pending/double
  protection, invalid/expired/used/replaced/disabled failures, validation/network/
  backend/429/malformed errors, retained local fields, success secret clearing and
  original 1200 ms safe Login handoff without auto-auth, refresh/new-link behavior,
  close/unmount protection, and unchanged signed-in JWT/authenticated routing.
- An initial full run hit the existing Account interaction test's five-second
  timeout under concurrent load. The subsequent complete run passed without
  changing its implementation, assertions or timeout. A new anti-enumeration test
  regex was corrected to distinguish an affirmative message from the prescribed
  generic `If that account exists...` copy.

Read-only existing backend/legacy checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_email_and_feedback.py -k 'reset_email_sender_link_and_single_use' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs tests/session_expiry.test.cjs
```

**2 reset/recovery/email tests passed, 8 deselected; 6 Terms/backend tests passed;
18 legacy JavaScript checks passed.** Existing FastAPI/httpx TestClient deprecation
warning remains. The missing declared Stripe package was supplied through existing
temporary PYTHONPATH `%TEMP%/feely-react-python-deps`, without modifying the venv.

Reproducible live contract with temporary SQLite, synthetic accounts, mock LLM,
local Siteverify double and captured real reset-message construction. From root:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --recovery
```

Then from `frontend-react/` with Node/npm available:

```powershell
node scripts/validate-recovery-contract.mjs
```

**Passed.** Fixed local port 18011 is the new fixture-only mode; earlier fixture
modes/ports keep their defaults. Only email transport is replaced; real token,
HMAC, expiry/link construction, route validation and database consumption are used.
No SMTP/payment/Cloudflare or real database calls. Test-only email/state readers
exist only in this disposable fixture, never backend code or production output.
No email token, password or JWT contents are printed; stop with Ctrl+C when done.

Contract checks use actual React API/session wrappers and verify exact generated
root link/parameter (no email ID), normalized request, unknown/disabled equivalent
generic responses with no delivery, real per-email quota/429, malformed token and
password lengths, successful reset DTO, consumed/expired/replaced/disabled tokens,
new-password Login/old-password rejection, unchanged pre-reset JWT with successful
session revalidation, disabled recovery 503 and real shared auth limiter on confirm.
The configured non-fixture PUBLIC_APP_URL was inspected separately: it remains
`http://127.0.0.1:5500`. Neither root configuration nor email behavior was changed.

- Reference server 5500, dev 5173 and production preview 4173 started successfully.
  All **34** actual allowlisted legacy assets matched their source bytes.
- Both React servers served recovery/reset and existing routes/fallback. Proxy
  original reset HTML/auth/start/shared scripts remained unchanged; all nine
  recovery modules transformed via Vite. Fonts/reset/dialog CSS remained bundled;
  lake/favicon matched reference; fixture passwords/secrets were absent from JS.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Recovery source has no manual queries/listeners/HTML loading, token/
  password logging/storage, direct fetch or account password/billing/deletion calls.
- Browser selection failed and troubleshooting discovery returned no browsers.
  No real-browser screenshots/mobile/history comparison was possible. DOM/router
  and actual backend contracts do not establish full visual parity. Routed-card
  presentation, token-free refresh requiring the email link, and unchanged email
  destination are documented in README/MIGRATION.

Earlier phase sections below record their historical scope/results.

## Phase 8 results

Checked on 2026-10-12. Changes are confined to `frontend-react/`; legacy frontend,
backend, existing tests, root docs and `.env` remain unchanged.

- Complete `npm test`: **223 passed**, ten files: all previous 183 checks plus
  40 activation/resend checks. Obsolete reference-PIN expectations now assert
  React activation routing/email state; account delegation copy excludes the
  migrated verification action. No prior feature/regression coverage was removed.
- `npm run typecheck` and `npm run build`: passed (81 modules). Original auth/PIN/
  dialog/form/mobile/font CSS and assets remain bundled.
- Coverage: direct route, safe registration email/notice handoff, original single
  PIN validation/focus/paste/backspace/leading zeroes, invalid input, exact public
  payload/default credentials, success without token/automatic login, Login prefill/
  fixed message/destination, pending/double/cross-operation guards, generic invalid/
  expired/unknown/verified/disabled/exhausted responses, validation/backend/network/
  malformed failures, field retention, resend exact payload/email-only validation/
  pending/disabled-config/generic anti-enumeration/Retry-After/no invented timer,
  separate Login with required/accepted Terms, verified authenticated route handling,
  existing-token refresh/account return/error retry/revocation, verification-denied
  session recovery and stale/unmounted response protection.
- All shell/session/API/Login/registration/CAPTCHA/Feedback/Terms/Account suites pass.
  Router state tests ensure only email/fixed notice/validated destination survives
  handoff; PIN/password/challenge/JWT values are neither stored nor passed in URLs.

Existing targeted backend/legacy checks (unchanged source/tests):

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_email_and_feedback.py -k 'pin or registration_mail_failure' -q
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'email_verification_request_and_confirm or user_can_register_login_and_send_llm_message' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs tests/session_expiry.test.cjs
```

**5 PIN/activation/resend recovery tests passed, 5 deselected; 2 auth tests passed,
67 deselected; 6 Terms/backend tests passed; 18 legacy JavaScript checks passed.**
Existing FastAPI/httpx TestClient deprecation warning remains. As before, the
missing declared Stripe package was supplied from `%TEMP%/feely-react-python-deps`
via temporary PYTHONPATH; root environment/dependencies were not modified.

Reproducible actual registration -> activation -> Login/session contract, using
only disposable SQLite and synthetic accounts. In one terminal from root:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --activation
```

In another terminal from `frontend-react/` with Node/npm available:

```powershell
node scripts/validate-activation-contract.mjs
```

**Passed.** Fixture binds 127.0.0.1:18010, reuses real unchanged FastAPI routes and
local Siteverify/email transport doubles. Real per-email resend/confirm quotas
remain enabled; only unrelated IP quotas are raised in the isolated process.
Test-only readers/state controls exist only in this fixture, not backend source.
No SMTP/Cloudflare/billing/live DB calls; PIN/credentials/JWT contents are not
printed. Stop with Ctrl+C. Phase 7 fixture defaults and its two original ports
remain unchanged; only the optional activation mode was added.

The Vite module runner uses actual React registration/activation/resend/Login/
session/Terms/Feedback services. It verifies normalized payloads, unverified
registration/no JWT, generic invalid/unknown/already-verified/disabled responses,
malformed PIN, resend anti-enumeration, real expiry and persisted lockout recovery,
3-per-hour unknown-address resend quota and 10-per-900-second confirmation quota,
429/Retry-After, no activation token/session, separate Login with fresh verified
account/capabilities and registered acceptance, Feedback after Login, and changed
publication -> Terms acceptance/reload without replacing JWT.

- Legacy 5500, dev 5173 and production preview 4173 started successfully. All
  **34** actual allowlisted legacy assets matched original files byte-for-byte.
- Dev/preview served activation, auth/existing feature routes and fallback; proxy
  PIN HTML/auth/account JS remained unchanged. Six activation/shared state modules
  transformed through Vite. Original PIN/form/dialog/font CSS remains in output;
  bundled lake/favicon matched original bytes; fixture secrets absent from JS.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Activation source contains no manual DOM queries/listeners/HTML loading,
  credential/PIN logging, direct fetch, token writes or recovery/payment/deletion
  endpoints. Hooks rely on public ApiClient and existing SessionController reload.
- Browser selection failed; troubleshooting discovery returned an empty list.
  Full real-browser mobile/visual/keyboard comparison remains unverified. Simulated
  interaction and actual backend contracts do not establish screenshot parity.
  Routed-card differences and retained reference token-link compatibility are
  documented in MIGRATION/README.

Earlier phase sections below record historical scope and results.

## Phase 7 results

Checked on 2026-10-11. All source/docs/test fixtures stay in `frontend-react/`.
Legacy frontend, backend, existing tests, root docs and root `.env` are unchanged.

- Complete `npm test`: **183 passed**, nine files: all 139 previous checks,
  34 registration checks and 10 CAPTCHA/SDK lifecycle checks. The old login
  reference-registration assertion now expects `/register`; other login behavior
  coverage remains. TypeScript compilation and production build passed (76 modules).
- Registration tests cover original fields/honeypot/no confirmation field, exact
  payload and public headers, required/native/minimum validation, challenge and
  consent requirements, test/unpublished Terms, fresh version/hash change, disabled
  CAPTCHA, pending/double submits/cooldown, expiry during Terms preflight, duplicate
  email/username, validation/consent/CAPTCHA/network/backend/malformed errors,
  preserved fields, failed config/fresh Terms reads, canonical-email handoff without
  token/login/PIN calls, verified auto-login/session/Terms gate, login failure after
  creation, post-commit email error, Router tabs/legacy mode/auth redirects and stale
  unmounted responses. All shell/session/API/Login/Feedback/Terms/Account suites pass.
- CAPTCHA tests mock only the provider boundary: official explicit SDK loading,
  public options/ref, callback/expiry/error, failed-attempt reset, cleanup/late
  callbacks, script error/retry, disabled/unsupported/missing key, changed site/
  action, shared pending loader and leaving before load. No production test bypass
  or secret-key setting exists. Widget operations are confined to its React ref;
  the tiny dependency loader owns only the external script.

Existing read-only backend/legacy tests:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'registration or captcha or email_verification_request_and_confirm or user_can_register_login_and_send_llm_message' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/terms_ui.test.cjs tests/email_feedback_ui.test.cjs tests/session_expiry.test.cjs
```

**6 registration/auth/CAPTCHA tests passed, 63 deselected; 6 Terms/backend tests
passed; 18 legacy JavaScript checks passed.** Existing FastAPI/httpx TestClient
deprecation warning remains. The missing declared Stripe dependency was supplied
from `%TEMP%/feely-react-python-deps` via temporary PYTHONPATH, leaving venv intact.

Reproducible live backend contract checks (fresh temporary databases only): start
these from repository root in two terminals with backend requirements installed:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-registration-server.py --verified
```

Then from `frontend-react/` with Node/npm available:

```powershell
node scripts/validate-registration-contract.mjs
```

**Passed.** Fixed local ports 18007/18008 represent email verification enabled and
disabled. Each fixture uses unchanged FastAPI registration/login/Terms routes,
temporary SQLite and mock LLM; a local HTTP Siteverify double exercises the real
backend verification transport/action checks without Cloudflare. Email transport
is captured only inside the fixture process; no SMTP, payment or real DB calls.
Test-only PIN/fixture/account-exists readers belong solely to these fixture servers,
never backend source or the React bundle. Stop fixtures with Ctrl+C when done.

Contract checks verify public CAPTCHA (no secret), exact registration fields,
missing/expired/wrong-action token, honeypot, invalid password/username/email,
strict/missing/current version/hash consent, normalized 201 UserRead/no JWT/PIN,
both duplicate variants, unverified no-login/no-token state, real reference-style
PIN activation then login, verified-user separate login, real shared account/
capability/Terms state, registration acceptance `client:"api"`, and activation
delivery 502 with the account still committed. No credential/token values printed.

- Reference 5500, dev 5173 and production preview 4173 started successfully; all
  **34** actual allowlisted legacy files were byte-identical to original sources.
- Both React servers served registration, login, existing routes, mode hint and
  fallback. Proxy auth/PIN/Terms HTML/JS remained byte-identical. All eight new/
  shared auth source modules transformed through Vite. Original auth/honeypot/
  CAPTCHA/consent/font CSS stayed bundled; favicon/lake matched reference bytes.
  Synthetic fixture password and Siteverify secret were absent from built JS.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Registration source has no querySelector, innerHTML, manual event
  listeners, fragment loading or PIN/recovery/payment/deletion endpoint calls.
- Browser selection failed and troubleshooting discovery returned an empty list.
  Screenshots, real responsive/keyboard review and a live external CAPTCHA were
  unavailable. Simulated provider lifecycle tests and local backend contracts do
  not establish live Cloudflare or full visual parity. Registration-to-PIN handoff
  needs an extra reference control selection/manual email entry, documented in
  README/MIGRATION; no unsupported URL/prefill protocol was invented.

Earlier phase sections below record historical scope/results.

## Phase 6 results

Checked on 2026-10-11. All changes stay in `frontend-react/`; the legacy frontend,
backend, existing tests, root docs and root `.env` remain unchanged.

- Complete `npm test`: **139 passed**, seven files. All 101 previous checks remain,
  plus 38 sign-in checks. Obsolete reference-login expectations now verify the
  actual React login guard/form, without removing their protected-data checks.
- `npm run typecheck` and `npm run build`: passed. Build includes 68 modules,
  original auth CSS/fonts, lake image and favicon; synthetic contract credentials
  are absent from production output.
- Login coverage: original layout/fields/theme/native email and length validation,
  exact trimmed identifier/unmodified password payload and public headers,
  localStorage-only token, controller account/capability load, pending duplicates
  and 1200 ms cooldown, backend 401/403/422/503, malformed responses, network error,
  field retention, password clearing, storage failure, post-login account failure/
  retry, invalid/expired/revoked tokens, stale/unmounted response guards.
- Routing covers signed-out Account/Feedback -> login -> real feature, Feedback
  submission after login, authenticated login redirects, Terms-first login and
  acceptance return to Account/Feedback, public Terms -> login -> Terms, rejection
  of external/login destinations, legacy view hints and preserved API override.
  Existing account editing, Terms exemptions and shell/session/API suites pass.

Existing targeted backend checks (no source/test edits):

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'user_can_register_login_and_send_llm_message or email_verification_request_and_confirm or login_attempts_are_rate_limited_by_identifier or user_can_edit_account_change_password_and_delete_account' -q
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/terms_ui.test.cjs
```

**4 auth tests passed, 65 deselected; 6 Terms/backend tests and 4 legacy Terms JS
tests passed.** Python emits the existing FastAPI/httpx TestClient deprecation
warning. As before, the missing declared Stripe dependency was supplied from
`%TEMP%/feely-react-python-deps` via temporary PYTHONPATH; no venv/root changes.

Reproducible live contract check, using only a temporary SQLite database and
synthetic accounts with the unchanged backend routes. From repository root,
in one terminal with backend requirements installed:

```powershell
.\.venv\Scripts\python.exe frontend-react/scripts/isolated-auth-server.py
```

Then from `frontend-react/` in another terminal with Node/npm available:

```powershell
node scripts/validate-login-contract.mjs
```

**Passed.** The fixture listens only on 127.0.0.1:18006, seeds verified/disabled/
unverified users, overrides only its own DB dependency and process settings,
disables emails/billing/rate limits and uses mock LLM. It never initializes or
edits the real database. Stop it with Ctrl+C when done. The Vite module runner
calls actual React auth/session/Terms/Account/Feedback services: email/username
login, exact response/bearer JWT shape, wrong/disabled/unknown 401, unverified
403, invalid payload 422, localStorage handoff, real account/capability/Terms
load, pre-consent Feedback 423, acceptance/reload, profile write/shared update,
Feedback success, next-login accepted Terms and tampered-token backend 401
clearing. No credentials/JWT values are printed, and no live providers are called.

- Reference 5500, Vite dev 5173 and production preview 4173 started successfully.
  All **34** actual allowlisted reference assets matched original files byte-for-byte.
- Both React servers returned the SPA entry for login, existing feature routes,
  view hint and fallback. Full reference Register, auth JS/HTML, password-reset
  and PIN documents were served unchanged through both proxies. All seven auth
  modules transformed successfully through Vite. CSS keeps original auth/mobile/
  light-theme selectors; bundled lake/favicon match reference bytes.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Auth source uses no manual DOM navigation, fragment loading, event
  listeners, direct fetch, or registration/recovery/payment/deletion mutations.
- Browser runtime selection failed; troubleshooting discovery returned an empty
  browser list. No real-browser sign-in/visual/mobile screenshot comparison was
  possible. Simulated DOM/routing and actual API contracts do not establish full
  visual parity. This and reference-dialog handoff differences are documented.

Historical results below describe earlier phase scope, not current login support.

## Phase 5 results

Checked on 2026-10-11. All source changes remain in `frontend-react/`; the legacy
frontend/backend, root `.env`, root docs and legacy tests are unchanged.

- Complete `npm test`: **101 passed** across six files: the previous 81 checks
  plus 20 account/profile checks. No regression behavior was removed; historical
  shell route fixtures and the real Terms exemption assertion were adapted to
  the now-real account route.
- `npm run typecheck` and `npm run build`: passed.
- Account coverage includes session loading/failure/retry/unauthenticated states,
  existing/null values, five editable fields and read-only metadata, native
  validation/limits, dirty tracking, unchanged Save availability, exact trimmed/
  nullable payload, normalized response/reset/shared sidebar update, no redundant
  GETs, failures and manual retry, no write replay, pending/double/overlapping
  submissions, stale/wrong-account guards, close/reopen behavior and email flags.
- Delegation tests verify billing/password/deletion reference links and absence
  of their mutation calls. Account read/save stays terms-exempt without clearing
  the real Terms gate; Feedback/Terms/shell tests continue to pass.

Existing targeted backend checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_auth_and_llm.py -k 'user_can_edit_account_change_password_and_delete_account or email_verification_request_and_confirm' -q
```

**2 passed, 67 deselected.** Existing fixtures isolate those legacy backend tests;
their password/deletion operations occur only in their synthetic test databases,
not through the React account feature. No dedicated legacy JavaScript account
test file was present. No legacy test/source was edited.

An actual contract check loaded React's API/session/profile wrapper and payload
conversion through Vite against unchanged FastAPI routes on port 18005. It used
a fresh temporary SQLite database and synthetic users/publication, mock LLM and
disabled email/Stripe settings; the real database/root configuration was untouched.
It passed authenticated reads, terms-exempt profile writes, trimmed/lowercased
persisted responses, nullable clearing, backend partial PATCH semantics, uniqueness
409s, pattern/length 422s, canonical shared-session update, and unchanged terms,
subscription capabilities and JWT. No real billing/password/deletion flow or
external provider was called by the React services.

- Reference server on 5500, Vite dev on 5173 and production preview on 4173
  started successfully. All 34 actual allowlisted legacy assets matched their
  original files byte-for-byte.
- Both React servers served `/account`, its legacy view query, Feedback, Terms,
  all remaining feature routes and fallback entry. The reference account HTML/JS
  proxy and public favicon were verified unchanged on both React origins.
- All seven account/profile modules transformed through Vite. Production CSS/JS
  include the real account code and original account/grid/font selectors. The
  lake image/favicon match reference bytes; fixture credentials are absent.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Source inspection found no manual DOM queries/listeners/HTML loading,
  direct fetch, password/billing/deletion mutation paths in the account feature.

The Browser skill found no available browser. No screenshots or real responsive/
modal comparison were possible. Routed-card differences, cached session reads,
dirty behavior and delegated actions are documented in `MIGRATION.md`/`README.md`.

## Historical Phase 4 results

Checked on 2026-10-11. Source changes are confined to `frontend-react/`; the legacy
website, backend, root `.env`, root docs and existing legacy tests are unchanged.

- `npm run typecheck`: passed.
- `npm run build`: passed, including the real Terms route/gate/API code and original CSS/assets.
- Full `npm test`: **81 passed** across five files: all 60 previous checks plus
  21 Terms checks. No existing behavior checks were removed. The Phase 3 review
  link assertion now names the migrated React action.
- Covered signed-in/public loading and reading; configured/unpublished/already
  accepted terms; current version/document; explicit unchecked consent; exact
  payload/headers; successful return to Feedback; updated capabilities; pending
  and double-submit protection; ordinary/network failure; 409 version/hash/URL
  changes; failed session refresh; publication change during acceptance; forced
  reads resisting old responses; gate enforcement, account exemption and sign-out;
  manual entry and legacy legal/view aliases.

Unchanged reference checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_terms_and_android.py -q
node --test tests/terms_ui.test.cjs
```

**6 Python tests and 4 legacy JavaScript tests passed.** They cover explicit
versioned acceptance, strict boolean/hash validation, idempotence, user isolation,
publication/revision gating, unpublished terms, and the legacy consent UI.

An actual contract check loaded React's API client, session controller and Terms/
Feedback API wrappers through Vite and called the unchanged FastAPI routes on
port 18004 with a fresh temporary SQLite database and synthetic user/publication.
Mock LLM settings and disabled email prevented external calls; the real database
and root backend configuration were not changed.

The check passed: public `/terms/config`, authenticated `/terms/me`, pre-consent
Feedback 423, rejected false/string consent (400/422), version/hash conflicts
(409), exact web acceptance record with timestamp/URL/hash, idempotence, forced
session reload, restored Feedback 201, and unchanged JWT. POST success alone did
not clear the client's gate before rereading the session.

- Reference server on 5500, Vite dev on 5173 and build preview on 4173 started.
  All 34 actual allowlisted legacy assets matched the original files byte-for-byte.
- Both React servers served `/terms`, `/agb.html`, `/?view=terms`, all other
  feature routes and the fallback entry. The unchanged reference Terms script and
  favicon were served through the proxy/public asset paths on both React origins.
- All six new Terms modules transformed through Vite. Production CSS/JS contain
  the real Terms code and original form selectors/fonts; the lake image and
  favicon match their reference bytes. Fixture passwords/sentinels are absent.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Source inspection found no DOM querying/manipulation, HTML loading,
  manual listeners or direct fetch calls in `src/features/terms/`.

The Browser skill reported no available browser. No screenshots or real browser
modal/responsive comparison could be performed; DOM tests and backend/HTTP checks
do not establish visual parity. Terms' routed presentation and reference management/
login dependencies are documented in `MIGRATION.md`.

## Historical Phase 3 results

Checked on 2026-10-11. Source changes remain confined to `frontend-react/`.
Legacy website/backend files, existing tests, root docs and `.env` are unchanged.

- Phase 3A was verified before Feedback implementation: **43 React tests passed**
  and the production build/TypeScript compilation passed.
- Final `npm test`: **60 tests passed** across four files: 23 Phase 2 shell
  checks, 9 API-client checks, 12 session checks and 16 Feedback checks.
- `npm run typecheck` and `npm run build` passed. The final build includes the
  real providers/Feedback implementation; the historical preview fixture and
  test credentials/sentinels are not production dependencies.
- Session/API coverage includes loading, verified authenticated/unauthenticated
  states, failures/retries, malformed/expired JWTs, timed expiry, public/current
  and stale 401s, token preservation on 403/429/5xx, stopped-provider responses,
  focus validation, StrictMode, storage changes, default credentials/Bearer/JSON,
  config precedence, GET retries, no POST replay, FastAPI errors and 423 status.
- Feedback coverage includes original fields/copy/validation, controlled input,
  exact trimmed payload, successful reset, failed draft retention, pending and
  repeated submission, config disabled/error/retry, 404, 401, 423, 422, 429,
  close/reopen/pending navigation, sign-out/account isolation, and late responses.

### Actual backend contract and HTTP checks

The actual React `ApiClient`, `SessionController`, and Feedback API wrapper were
loaded through Vite and exercised against the unchanged FastAPI application on
an isolated local server at port 18003. It used a fresh temporary SQLite database,
the existing dependency override mechanism, mock LLM settings, and disabled email.
No real account/database, external LLM or SMTP provider was used.

Verified existing registration/login payloads, returned JWT restoration,
account/subscription/terms/config reads, real free-test capability flags, Feedback
201/detail, public rejected-login behavior, React-origin CORS preflight, and local
sign-out/protected-request rejection. The contract check passed.

The unchanged reference server started on 5500; all 34 actual allowlisted files
matched reference bytes. Vite dev on 5173 and preview on 4173 started successfully.
All requested React routes, source transformations, build assets and original
favicon/lake images were checked over HTTP. The `/reference/` proxy served original
login/views/scripts/CSS/assets byte-for-byte on the React origin; it did not copy
or alter those files. This verifies the proxy/resources, not a browser login session.

Additional unchanged backend tests:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_email_and_feedback.py tests/test_auth_and_llm.py -q
```

**78 passed, 1 failed.** The existing `test_local_website_cors_preflight` expects
`Origin: null` to be permitted, but the current environment's CORS settings reject
it with 400. Local HTTP origin checks passed. No backend/CORS source or root `.env`
was changed to alter this unrelated expectation. As in Phase 1, missing Stripe
was supplied only through the temporary validation dependency directory.

`git diff --exit-code -- website app tests README.md STARTUP.md .gitignore` passed.
No other legacy cleanup or removal occurred.

### Limits

The Browser skill found no available browser. No screenshots, real browser
same-origin sign-in/storage events or responsive visual comparison were possible.
Interaction coverage uses jsdom and mocked media/viewport/API inputs; the separate
backend check exercises actual HTTP/services. Feedback's routed-panel difference,
reference-login dependency and deferred terms dialog are documented in
`MIGRATION.md`. Larger feature pages remain placeholders.

## Historical Phase 2 results

Checked on 2026-10-11. Implementation changes are confined to `frontend-react/`.
The legacy frontend, backend, existing tests and root documentation remain
unchanged. The Phase 1 minimal React frame/preview were replaced only within the
new frontend by reusable layout components and route placeholders.

- `npm run build`: passed, including TypeScript compilation. Output remains in
  `frontend-react/dist/`; original fonts, CSS and lake asset are bundled.
- `npm test`: **23 passed** in Vitest/jsdom. Tests mount React, interact through
  controls, and use Router history, rather than asserting only source strings.
- Covered all six direct feature routes, root and legacy HTML aliases, `view`
  mapping, query/hash preservation on redirects, unknown routes, contextual
  sidebars, active states, Journal's separate placement, keyboard tab selection,
  document titles, Back/Forward and duplicate-history prevention.
- Covered contextual account/feedback return navigation and reflection's Map
  association.
- Covered simulated mobile drawer opening, navigation/backdrop/close/Escape
  dismissal, focus containment/restoration, `inert` markup, desktop resize reset,
  and prevention of reopening a stale drawer on Forward.
- Covered appearance restoration/persistence, theme-color metadata, blocked
  storage fallback, and visual viewport resize/unmount cleanup.
- Covered explicit capability inputs, feedback hiding, disabled feature controls,
  no API requests, and no changes to a token sentinel in browser storage.
- Source inspection confirms no navigation `querySelector`, `innerHTML`, legacy
  fragment/script loading, manual history/URL switching, or auth/API logic.
  Media/viewport subscriptions are isolated in lifecycle hooks with cleanup.

- Runtime startup passed for the unchanged reference server at port 5500, Vite
  development at 5173 and Vite production preview at 4173.
- All 34 actual allowlisted legacy assets were served byte-for-byte unchanged.
- Both React servers served the entry for all six direct routes, root, legacy
  HTML aliases and an unknown route. All 17 checked shell/route/hook/style source
  modules transformed successfully through the development server.
- Production CSS/JS were served successfully; original font/color definitions,
  drawer rules, 900px breakpoint and light-theme selectors remain bundled. The
  CSS optimizer converts the media query to equivalent `width<=900px` syntax.
  The bundled lake image and public favicon match the legacy originals byte-for-byte.
- `git diff --exit-code -- website app tests README.md STARTUP.md .gitignore`
  passed. Existing baseline test failures listed under Phase 1 were not rerun or
  altered; new Phase 2 tests live only in `frontend-react/src/test/`.

The Browser skill again reported no available browser. The tests use a simulated
DOM and mocked media/viewport inputs; no screenshot comparison or real-browser
responsive interaction review was possible. Feature parity, real auth, billing
and backend workflows are intentionally not claimed. See `MIGRATION.md` for the
temporary preview assumptions and remaining differences.

## Historical Phase 1 results

Checked on 2026-10-11. Changes are confined to `frontend-react/`; `git diff`
confirms that the tracked reference website, backend, and existing tests are
unchanged.

## React checks

- `npm ci`: successful clean install from `package-lock.json`; audit reported
  zero vulnerabilities at validation time.
- `npm run typecheck`: passed.
- `npm run build`: passed; output stays in `frontend-react/dist/`.
- `npm run dev`: started at `http://127.0.0.1:5173/`.
- `npm run preview`: started at `http://127.0.0.1:4173/`.
- Both servers returned the React entry for `/` and an unknown deep route.
- Vite successfully transformed the entry, App, shell, both route components,
  configuration and stylesheet modules over HTTP.
- React server rendering with `MemoryRouter` rendered the home and fallback
  routes, the shared shell, and the reference-site links.
- Production CSS/JS and the favicon were served successfully. The favicon
  and the CSS-bundled lake image matched the originals byte-for-byte. The
  production CSS retained the existing font definitions and color tokens.
- Source inspection found no manual fragment loading, `innerHTML`, imperative
  event binding, API calls, or browser-token access in the new implementation.

## Reference checks

The unchanged `backend.website:app` server started at `http://127.0.0.1:5500/`.
All 34 actual allowlisted files were served byte-for-byte from the original
`website/` files (excluding the virtual `chat.html` redirect entry).

Existing targeted JavaScript checks:

```powershell
node --test tests/frontend_startup.test.cjs tests/session_expiry.test.cjs tests/chat_controls.test.cjs tests/email_feedback_ui.test.cjs tests/terms_ui.test.cjs
```

**31 passed, 1 failed.** The existing test
`persistent gateway errors stop after three attempts` expects three retries;
the unchanged reference loader defines `MAX_LOAD_ATTEMPTS = 6` and retries six
times. Session expiry, stale responses, chat controls, registration PINs,
feedback handling and terms checks passed.

Existing targeted Python checks:

```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_frontend_structure.py tests/test_frontend_security.py -q
```

**18 passed, 5 failed.** The five failures assert exact unversioned strings
`href="styles.css"` or `src="js/load-views.js"`, while the unchanged reference
entry already uses `?version=...`. The passing checks cover serving the shell,
views and scripts, redirects, bindings, structure, and other reference behavior.
These failures involve only existing source and tests and are unrelated to
the new React scaffold. They were left intact under the preservation rule.

The existing Python virtual environment initially could not collect tests
because `stripe` was missing. For validation only, the declared Stripe dependency
was installed in `%TEMP%/feely-react-python-deps` and exposed through a temporary
`PYTHONPATH`. The existing environment and requirements were not changed. Normal
backend startup requires the existing environment to satisfy `requirements.txt`.

## Limits

The Browser skill reported no available browser. No screenshots, visual parity
review, or browser-mounted interaction checks could be performed. HTTP checks and
React server rendering are not a substitute for those checks. Complete desktop
and mobile visual/interaction comparison in Phase 2 when the full shared layout
is migrated and a browser is available.

No feature pages or live API/auth workflows were migrated or claimed to have
parity in Phase 1. Real-account end-to-end tests and external services were not
run. Admin and webmail were served as unchanged assets, not functionally tested.
