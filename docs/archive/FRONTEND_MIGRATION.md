# Incremental migration plan

## Phase 15 stabilization and maintainability

Completed the implementation/contract/DOM audit and targeted refactoring on
2026-10-12. Native visual comparison remains pending because browser discovery
found no available browser. The earlier phase sections record historical scope.

The audit was written before refactoring in [ARCHITECTURE_AUDIT.md](FRONTEND_ARCHITECTURE_AUDIT.md),
with high/medium/low-value findings, complete source/import/test inspection and
bundle attribution. [ARCHITECTURE.md](../../frontend-react/ARCHITECTURE.md) is now the developer guide,
including state/async/API/routing conventions, feature extension, the complete
remaining reference dependency inventory and Android readiness classifications.

- Removed three provider/view import cycles by making providers own state and
  composing conditional Map/Chat/Reflection dialogs in `FeatureDialogs`.
  Feature providers remain mounted; dialog keys and hidden Terms state are preserved.
- Moved the genuinely shared modal primitive to `components/shared/DialogFrame`.
  Split independent Chat TopicReview/NoteReview, Map TopicForm/EntryForm and Map
  EntryPreview; aggregate files now compose these forms rather than contain them.
  Cohesive Chat/Journal/Map/Session controllers retain explicit ownership logic.
- Extracted the NDJSON reader and shared ApiError from ApiClient, preserving its
  public error exports and HTTP/session behavior. Cancellation is checked between
  records in the same packet; reader cleanup remains explicit. Late analysis-retry
  errors are scoped to their originating Chat conversation.
- Added synchronous Map/Journal owner projections, matching existing Chat/Reflection
  masking without deleting same-owner drafts through gates. Shared Map write
  coordination and Journal's explicit 900ms autosave/flush remain unchanged.
- Made saved Chat history a memoized presentation boundary with explicit reaction
  inputs, retaining live stream/composer updates. Added modal focus boundaries for
  heading/empty-control states and associated form fields with status/error text.
- Named `ChatConversation` and typed the already-validated `chat_info` shape to
  remove double assertions. CAPTCHA SDK types no longer depend on its renderer.
  Renamed the safe workspace-return helper and centralized shared reference Account
  URLs, removing duplicate Terms/Journal URL construction and Account-feature coupling.
- Removed the empty placeholder route loop and unused reference-auth helper;
  moved the live historical placeholder into test fixtures. Billing/deletion,
  compatible old email/root/query routes, preview test inputs and legacy files remain.
  Local CSS has no duplicate selector blocks; only obsolete comments were corrected.
- Lazy-loaded ten pages and three conditional dialogs, with a shared loading/error
  boundary. Reset-token handling stays eager. Full testing caught Suspense retaining
  closed Account password fields; pathname-keyed page boundaries now unmount local
  credentials immediately. A few assertions await lazy content without losing checks.
- Grouped the large Chat controller tests into streaming, history and concurrency
  suites, preserving all cases. One explicit renderer shares only root provider wiring
  across Chat/Map/Reflection tests. Twenty new checks cover ownership, cancellation,
  modal/lazy/error behavior, history rendering and 1440/768/390 drawer logic.

Final validation: **552 tests in 25 files** (all 532 originals retained), typecheck,
build, format check, **28 existing backend tests**, all four disposable feature
contracts, **38 legacy JS tests**, **34 asset-byte comparisons** and **181 external
tracked-file hashes** pass. No package/dependency/backend/legacy changes. Largest
chunk is **310.33kB**, initial JS graph about **424.65kB** versus **504.36kB** before;
the warning is gone. Splitting reduces initial work, not total application bytes.

Visual/tablet/touch/keyboard/screenshots and actual Android testing remain unverified.
The app is not yet ready for Capacitor packaging: API localhost precedence,
reference bridge/authentication and real Turnstile native-origin behavior need
separate work. No native package or platform framework was introduced.

## Dedicated formatting/readability pass after Phase 14

This is a separate readability pass, not Phase 15 architecture cleanup. Added
project-local Prettier 3.9.10, `.prettierrc.json` (print width 100), `.prettierignore`
and `format`/`format:check` npm commands. No ESLint setup existed and none was added.

Prettier checked/formatted all 168 pre-existing supported files: 149 TS/TSX
source/config/test files, one CSS, four JSON, nine validation MJS, one HTML and four
Markdown files. 153 existing files changed; the two formatter files are new and
the npm lockfile records the single new development dependency. Generated files,
dependencies, environment settings and the generated lockfile are ignored by
Prettier; the Python fixtures are unchanged.

Chat/Map/Journal/Reflection and Session/auth controllers, API modules and test
setup/render/payload/assertion code now use consistent vertical formatting.
Only obvious local readability edits were made beyond formatter output: named
display labels/statuses, explicit if/switch branches instead of nested ternaries,
separate hook/timer declarations, a named suggestion guard and dialog/ownership
conditions. Existing evaluation priority, request identity checks, endpoints,
payloads, timing values and UI text are preserved. No components/controllers were
moved, split, replaced or given new responsibilities; no helper abstraction was
added to hide tests.

Complete 532-test React suite, TypeScript compilation, production build and
Prettier check pass. All 181 tracked files outside `frontend-react/`, including
legacy/backend/root tests/docs/assets, remain byte-identical to the saved
pre-pass baseline. See [VALIDATION.md](FRONTEND_VALIDATION.md) for detailed results.
Phase 15 remains a separate, unstarted task.

## Phase 14 completion and resumed validation

The current tree now runs real React Chat. The Phase 14A inspection below remains
the record of the legacy behavior read before implementation. Subsequent phase
sections are historical, including their then-deferred Chat assumptions.

| Reference responsibility                                        | React ownership                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `views/chat.html` and `js/chat.js` history/messages/composer    | `features/chat/ChatPage`, `ChatMessage`, `ChatComposer`, typed `types.ts`                               |
| Global conversation list/active ID/generation/polling/reactions | `ChatController` and root `ChatContext`, captured token/request/chat identities                         |
| Sidebar chat list/menu/New/delete                               | `ChatConversationList`; existing `SidebarContext` delegates rendering                                   |
| Original Chat header/title                                      | Existing `WorkspaceHeader` and `AppShell` read Chat context                                             |
| Topic/note/confirmation dialogs                                 | `ChatReviews` reuses existing Map dialog primitives and original CSS                                    |
| `app.js` fetch NDJSON                                           | Shared `ApiClient.stream`, typed event validation in `chatApi.ts`                                       |
| Phrase cadence in `js/chat.js`                                  | Pure `textPlayer.ts`; visual text reveal only, no speech                                                |
| Map connected conversation titles/navigation/source fields      | Narrow `MapDetails` title lookup/Router source and `MapController` source setter/canonical Map response |

No legacy scripts run inside React. No new global session/profile store or model
domain was created. `/chat` uses the existing Router/RequireSession/Terms shell;
historical test fixtures can explicitly inject a placeholder, production cannot.
Original classes/assets/copy and responsive CSS are reused, including phrase spans,
waiting display, reactions and review forms.

Conversation/message shapes and the complete existing endpoint/payload table are
documented in [README.md](../../frontend-react/README.md#chat). In particular `message_count` counts
exchanges, timestamps identify reactions, and authoritative message-array order
is retained without inventing message IDs. Local blank conversations have no
backend identity until first-send `POST {}` succeeds.

Shared fetch NDJSON accepts `status`, `text_delta`, `result.data`, `error`, arbitrary
UTF-8/network boundaries and a final unterminated line. Canonical result validation
requires the owning chat ID and complete matching user/assistant pair. Invalid or
incomplete streams produce a recoverable error; no automatic resend/JSON fallback
or new generation/cancel/rename endpoint exists.

One owned generation survives conversation/workspace changes. A's stream cannot
render into B; Stop aborts only the selected origin and clears temporary display.
New typing survives cancellation/failure. Token changes clear/mask private state;
unmount suppresses late mutations. Reads and list refreshes capture request/version
identities; deleted IDs stay tombstoned so late work cannot restore them.

Explicit identical retry after an uncertain connection first reads persisted
history. A matching next saved exchange is reconciled without a POST; otherwise
the same-ID attempt can be sent. Different new text remains sendable and pending
preflight prevents duplicate clicks. No backend idempotency key exists, so another
client's write between read and send or disconnection after commit remains a limit.

Reactions remain canonical timestamp-based toggles. Topic/note reviews retain
legacy targets/categories/source IDs/payloads, failure edits and pending guards.
Analysis retry does not resend messages; polling remains 700/1800/4000/8000ms
after the initial read, indefinitely until complete. Map writes reuse the existing
queue and authoritative graph; Chat creates no separate Journal entry/analysis.
Connected Chat labels come from the server list, missing IDs retain fallback labels
and 404, and manual Map additions inherit the selected Chat source. Deleting Chat
does not unlink Map records. Overall/null note routing may still resolve to an
already-linked topic in the backend. Topic IDs protect already-reviewed proposals;
note acceptance has no corresponding cross-client deduplication guarantee.

Free Chat, actual daily plan copy, Premium review acceptance/allowed dismissal,
minute/daily quotas and HTTP/in-band 401/403/423 use the existing shared semantics.
Billing and account deletion remain reference actions. No additional product
behavior or backend changes were introduced.

The resumed validation reproduced four bugs and fixed only their affected guards:
retry-preflight errors after navigation, invisible note reviews after capability
loss, first follow-up poll timing, and disabled Stop during history reload. Sixteen
additional Chat tests were added; the upward-scroll assertion was adapted to
already-implemented phrase spans without reducing its behavior check. Fixture-only
contracts now separately test free acceptance/dismissal and minute versus daily quota.

Final checks: **532 React tests**, including **72 Chat tests**; **17 existing backend
tests**; disposable real HTTP/DB Chat contract; **38 unchanged legacy tests**;
TypeScript/build; **34 byte-identical public assets**, dev/preview routes/modules
and unchanged legacy/backend git diff. See [VALIDATION.md](FRONTEND_VALIDATION.md) for
commands, test scope and limitations. No dependency change. Vite's 504.14kB chunk
warning is recorded, without a Phase 15 bundling refactor.

Browser discovery found none available. DOM/timer/backend checks do not establish
native visual/mobile/focus/history or older-browser parity. Controlled dialog
semantics and stronger stale-work/retry guards are explicit differences. Keep the
reference frontend until parity is separately approved. Phase 15 is recommended
for readability/architecture/duplication/file sizes, visual/responsive/accessibility,
maintainability and Android readiness; it has not begun.

## Phase 14A Chat findings and mapping, before implementation

Read complete `website/views/chat.html` and `website/js/chat.js`, shared app NDJSON
client/state, start/navigation/auth/sidebar/dialog/CSS bindings, all relevant LLM
routes/schemas/generation/background-analysis helpers and source/usage semantics.
Legacy/frontend/backend remain read-only.

- ChatSession has scoped UUID-hex chat_id and JSON info. GET `/llm/chats` returns
  all owned chats in DB updated_at descending order, full last-80 message arrays,
  title, message_count (exchanges, not bubble count), updated_at and pending topic/
  topic queue/map note. Messages have role/content/created_at/optional reaction,
  no message IDs or sequence numbers. Array order is authoritative; each completed
  exchange appends user then assistant with the same UTC timestamp. No Markdown,
  HTML, copy controls, visible timestamps or hidden-system filtering: textContent
  renders everything except user role as assistant. React will render literal text.
- Startup opens a local blank chat; New conversation makes no API write. First
  send POST `/llm/chats` `{}` persists an empty chat, then POST
  `/llm/message/stream` `{chat_id,context:trimmedText}`. Composer has no maxlength
  (backend 8000), Enter/Shift+Enter insert lines, Ctrl/Command+Enter sends unless
  composing/generating. Suggestions/lenses populate draft, never send automatically.
- Streaming is fetch ReadableStream + newline JSON, not SSE/WebSocket: status,
  text_delta, result(data LLMResponse), error(message/status). Decode UTF-8 across
  arbitrary chunks, blanks and final unterminated line. Result includes assistant
  message, profile, scoped chat_id/full chat_info and map_suggestion. Only successful
  generation commits the whole exchange; partial text is not persisted. No client
  resend/retry endpoint/fallback exists. Shared GET network retry is 400ms once;
  POST stream is not replayed. Model recovery is backend-only.
- One global generation has token/request/chat/navigation ownership. It continues
  while selecting another chat or workspace; only originating chat gets chunks.
  Send becomes Stop response there; disabled in other conversations until it ends.
  Stop aborts fetch, removes optimistic user/partial reply and restores sent text
  only if composer is empty, retaining newer typing. Failure does the same and
  stores per-chat failed draft/error for return. No generation timeout/cancel API.
  Server cancellation before commit rolls back/relinquishes reserved quota; a
  connection lost after commit cannot guarantee rollback or deduplicate resend.
- Phrase reveal ports two-word/four-word backlog pacing, sentence/clause/CJK pauses,
  minimum24ms, reduced-motion/hidden instant and complete flush. Scrolling follows
  new conversation/sends; deltas/resize follow only within 80px of bottom.
- GET `/llm/chats/{id}` loads history. Delete DELETE same path returns204 after
  original confirmation and selects first remaining chat or fresh blank. No rename
  API/UI exists; first message excerpt then first strong topic can set server title.
  PUT `/llm/chats/{id}/reaction` uses created_at/reaction like/dislike/null, not index.
- Topic/map-note analysis polls GET `/llm/chats/{id}/topic-suggestion` immediately
  on selection and delays700/1800/4000/8000 indefinitely until not queued/analysing.
  Equal suggestion JSON must not reset edited review fields. Retry analysis POST
  `/llm/chats/{id}/topic-suggestion/retry` has no body, never resends messages.
- Topic review POST `/llm/topics/confirm` includes chat_id, require_map_access:true,
  suggestion_id, entry_category, topic/description/category/related IDs/accepted,
  existing_topic_space_id/parent_topic_space_id. Recommendation/new/existing routing,
  queue/type/related/parent/note fields and exact trim/fallback are preserved. Map
  note POST `/llm/map-suggestions/confirm` includes chat_id/accepted/category/text/
  reason/topic_space_id. Accept requires Premium; dismiss retains free behavior.
  Topic response profile contains Map; note returns Map. Shared profile write queue
  and authoritative Map cache must be reused, not copied into Chat.
- Map topic/entry/practice sources use chat ID, not message ID. Labels use loaded
  authoritative conversation titles and Map -> Chat selects that ID. Manual Map
  creation uses selected Chat source once migrated. No Chat -> Journal creation,
  analysis or date-writing integration exists; preserved Map/Journal source metadata
  is enough. Deleting Chat does not unlink existing Map source IDs.
- Chat is available to free users; real subscription daily limit and free-test copy,
  shared RequireSession/Terms and server minute/daily limits are authoritative.
  Free-message429 shows upgrade action delegated to reference Account; billing is
  not migrated. 401/403/423 keep shared semantics, including in-band stream errors.

React mapping: feature-owned ChatController/ChatContext server conversations plus
local composer/failed-draft/owned-generation/poll/review state, outside SessionContext.
Add typed chatApi and shared ApiClient NDJSON transport, pure phrase player, real
ChatPage/messages/composer/sidebar/review dialogs. Header/sidebar use feature context;
Map reads titles and receives selected source ID through a narrow setter. `/chat`
uses existing Router state chatId from Map, no new URL routes. Reads/list merges use
request/version/tombstone identities, generation remains tied to captured chat/token,
and delete invalidates/aborts its owned request instead of resurrecting deleted UI.
React refs measure composer/scroll/menu and focus; React state/styles render them,
with no fragment loads/unsafe HTML/manual event binding. Test stream/parser/cadence,
all controls/reviews/gates/races/source links and unchanged-feature regressions;
validate real routes in disposable fixture and document browser/parity limits.

## Phase 13A Reflection findings and mapping, before implementation

Read the complete `website/views/reflection.html`, all Reflection/Practice handlers
in `website/js/map.js` (there is no `website/js/reflection.js`), start/global-state/
navigation/dialog/error/CSS integration, Journal source metadata, practice schemas,
`users.py` practice route, `self_authorship.py` practice storage and existing tests.

Reflection is only a practice-completion modal. There is no standalone Reflection
entity/ID, configuration/list/detail/create endpoint, rating, multiple modes or
multi-step flow. Its practice is an existing Map entry with category practice,
UUID ID, active/paused/completed status, optional reflection string/null, source
chat/Journal metadata and timestamps, located under a topic or Overall. Opening
sets global completingPracticeId, clears textarea, focuses it and shows the native
dialog over the selected Map. No legacy URL/source route exists.

Original copy is Review without shame / What happened when you tried it? / Your
reflection can include what helped, what got in the way, or what you would change.
One optional five-row textarea has no required/min/maxLength or steps. Backend
reflection max is 2000, authoritative; client trims and sends whitespace as null.
Mark complete becomes Completing... while pending. Close/Escape remain allowed,
and there is no unsaved-navigation prompt, autosave or draft storage.

One atomic PATCH `/users/me/map/practices/{entryId}` with
`{status:"completed",reflection:answer.trim() || null}` both saves reflection and
completes the existing entry. Response `{practice,map}` is authoritative; there is
no separate reflection save/partial-success sequence. Success rerenders Map and
closes dialog, retaining selected topic. Failure leaves answers, re-enables submit
and displays existing error (legacy places it behind the dialog in Map). Backend
allows repeat completion replacing the same field, not creating duplicate records.
Completed entries remain in Map and show reflection/read-only text. Normal legacy
UI offers Practice again (active/null reflection) rather than Reflection editing.

GET `/users/me/map` is the only source-loading API; no practice-detail endpoint.
Missing/wrong-kind practice PATCH is 404. Authentication/verification/Terms/premium
use existing 401/403/423/402 gates and my_map_access. Paused practice can complete;
source IDs/topic/category/creation timestamp are retained and updated_at is server
generated. Journal-created practices use the same field, without changing Journal
analysis/content/history. Chat later consumes saved reflection as existing context;
Chat itself remains deferred.

Mapping: preserve Phase 12 `/reflection` and Router state practiceId, no new query/
ID URL routes. Render original controlled modal over real Map, with safe fixed Map
return and selection preserved. Direct missing source explains choosing a practice;
valid state loads Map; missing/wrong-kind and already-completed sources get explicit
safe states, completed source read-only. Add feature-local Reflection controller/
provider/form/page/API adapter, reusing shared Map Practice DTOs and practice mutation
queue. Answers live only in feature memory, surviving internal session/Terms
remounts; explicit close/new opening resets them like legacy. Carry practice ID
through Terms return, not answers. Source/submit/owner identities reject stale
responses and late navigation; newer edits during pending completion stay available
instead of being closed over by an older submit. No intrusive unsaved prompts.
Validate DTO/status/field consistency before recognizing success, apply canonical
Map response before closing, and never repeat a write for a Map-refresh failure.
Reflection errors appear inside the modal for recoverability. Backend/legacy stay
read-only; test/contract/docs changes remain under frontend-react.

## Phase 12A Map findings and mapping, before implementation

Read the complete `website/views/map.html` and `website/js/map.js`, relevant
sidebar/header/navigation/start/global state/dialog/CSS code, capability helpers,
Journal suggestion review, all Map routes in `backend/api/routes/users.py`, profile
schemas and the full relevant `backend/services/self_authorship.py` implementation.
These are read-only references; there is no `website/shell.html` in this checkout.

- Server Map is profile JSON: `topic_spaces`, `unassigned_entries`, `updated_at`.
  Topics have UUID-hex string IDs, title, description, person/trait/experience/other
  category, parent_topic_id, related_topic_ids, chat_ids, journal_dates, entries and
  UTC timestamps. Older rows may omit metadata; read_map supplies compatibility
  defaults. Entries have string IDs, category/text, source chat/Journal/reason and
  timestamps; practices additionally have active/paused/completed status/reflection.
- Overall (`__across_topics`) is a permanent synthetic UI node for unassigned
  entries, not a persisted topic. Backend array order determines graph slots;
  sidebar uses parent-first depth traversal with cycle protection/indent cap five.
- Parent links are directed hierarchy, validated against self/cycles. Related
  links are symmetric, deduplicated, reject self/missing targets, and render once
  per unordered pair. No edge IDs, weights, labels, independent edge endpoint or
  edge-selection state exists. Solid parent/dashed related SVG lines have no arrows.
- Rendering is custom HTML buttons plus an SVG viewBox 0 0 100 100 behind them.
  Nine deterministic desktop slots repeat with clamped lap offsets. At <=900px,
  visible nodes form two columns with a growing board height. Filtering preserves
  desktop slots and recalculates mobile positions. No persisted coordinates,
  position endpoint, pointer dragging, zoom, pan, force simulation or graph library
  exists. None will be added.
- GET `/users/me/map` loads the entire Map; no node/detail/edge-list endpoint.
  Topic POST/PATCH `/topics[/id]` uses title/category/description/parent/related,
  create additionally chat_id. Merge POST `/topics/id/merge` uses
  `{target_topic_space_id}`; delete DELETE `/topics/id` moves entries to Overall,
  reparents children and removes backlinks. Merge keeps target, combines references,
  rewires links, and preserves source description in a merged_topic entry.
- Entry POST `/entries` uses category/text/topic_space_id/source_chat_id; edit
  PATCH `/entries/id` category/text/topic_space_id; delete DELETE `/entries/id`.
  Practice PATCH `/practices/id` uses `{status,reflection}`. All writes return a
  full authoritative Map with the changed topic/entry/practice. Topic input trims
  name/description (120/2000); entry text trims, legacy textarea has no maxLength
  although server max is 1000. No optimistic server mutations occur.
- Selection opens the existing detail drawer; close retains selected bubble;
  filters clear selection. Entering Map resets selection and refreshes. Details
  include counts/signals, Under/Contains/Related/disconnect, connected dates/chats,
  and only the latest three entries in reverse order with 86-character previews.
  Topic/entry forms retain failed input and block duplicate submission/closing while
  pending. Deletion/merge/disconnect require original app-styled confirmations.
- Journal analysis alone does not write Map; accepted suggestions create/link
  topics/entries via the verified Journal endpoint. Full map response/topic/date
  metadata is the same representation. React needs invalidation after review and
  serialization across Journal review and Map writes because each writes profile
  JSON. Older GET/full-map responses and old-owner writes must be rejected.
- Access is real `my_map_access`, RequireSession, Terms and server premium gate
  (402 "Premium is required to access My Map."). 401/403/423 retain existing shared
  semantics. View/Unlock Premium remains reference Account, no checkout migration.
- Practice completion opens legacy Reflection, which this request explicitly
  defers. React Complete will route to the existing Reflection placeholder carrying
  practice ID; pause/resume/reactivate are Map mutations. Connected conversations
  similarly route with chat ID to deferred Chat. No fake completion/chat data.

React mapping: shared `types/map.ts` DTOs; `features/map/mapApi.ts` exact API;
feature-owned MapController/MapContext as one authoritative Map plus local
selection/filter/popup/error state; MapCanvas declarative buttons/SVG and ported
mapLayout helpers; MapSidebar in SidebarContext; MapDetails and MapForms for
existing content and controlled dialogs. A small per-client Map write coordinator
stores only queue/revision/listeners, shared with Journal review (no second graph
store). Reads use identity/abort/write revisions, mutations wait for backend and
do not reset a newer user selection. Tests cover contracts, graph/layout, forms,
gates, races, Journal review -> Map, and previous regressions. Backend/legacy stay
unchanged; docs and disposable contract fixture stay under frontend-react.

## Phase 11A Journal findings recorded before implementation

Read-only references: complete `views/journal.html` and `js/journal.js`, sidebar
Journal markup, navigation/workspace changes, start input/date/analysis/unload/
visibility handlers, global state/capability helpers, Journal/Topic picker CSS;
backend Journal routes/schema/model, billing gate, relevant topic enums and tests.
React shell/header/sidebar, SessionContext/client, Terms gate and Router were read.

- Date is local-calendar YYYY-MM-DD, derived from getFullYear/getMonth/getDate.
  Date arithmetic/Intl formatting use local noon (`date + T12:00:00`) to avoid
  UTC/day and DST drift. Initially today; selected date survives workspace changes.
  Previous has no lower restriction; Next stops at today. Backend accepts valid
  future dates, and legacy history can select an existing future entry.
- One DB row per user/date (unique constraint). DB numeric IDs are not exposed;
  API uses entry_date. GET missing day returns empty content/zero words/empty
  suggestions/null timestamps without creating a row. PUT lazily creates or updates
  even empty content. UTC timestamps are server-generated; content is not trimmed.
- Auth GET `/journal/entries?limit=180` returns descending list items: entry_date,
  excerpt, word_count, suggestion_count, updated_at. GET `/journal/entries/{date}`
  returns content, counts, suggestions, analysis_stale/analysed_at/created_at/
  updated_at. PUT same path sends only `{content}`, max 100000, extra fields rejected.
  No delete UI, title, rich-text formatting, date picker or blur-save exists.
- Each input marks Unsaved, updates word count and resets a 900 ms debounce.
  Normal save shows Saving..., then Saved only if date/text still match captured
  values. Failures retain dirty/text; debounce errors display API detail. Further
  typing/date change/analysis retries; no automatic retry of failed writes. History
  is updated from response; locally an empty/no-suggestion saved row is removed,
  although server history includes empty rows on the next index load.
- Date selection awaits a dirty save, then GETs that date; switching workspaces
  starts a save without waiting and keeps Journal's global in-memory draft. Hidden
  tab/beforeunload use keepalive but optimistically clear dirty before completion.
  Legacy can issue overlapping PUTs and races between rapid date GETs; unchanged
  text edits also mark dirty. React must preserve timing/contracts while correcting
  those loss risks as explicitly requested: compare baseline, serialize writes,
  ignore stale reads, retain newer edits, wait/retain drafts when navigation fails.
- Access is `journal_access ?? my_map_access` from the existing subscription.
  Backend requires premium feature access (or its configured test-phase bypass),
  otherwise 402 `Premium is required to access Journal.`. Authentication/verification
  and global Terms 423 apply. Existing Premium paywall/sidebar copy must remain;
  billing itself stays delegated, so View Premium opens real reference Account.
- Journal includes Find map insights: flush dirty text, POST date `/analyse`, show
  Analysing.../Finding insights... then Analysis ready and suggestions. Topic/map-entry
  cards support editing, category/topic selection, acceptance and dismissal via
  POST date `/suggestions/{id}` exact payload. These Journal controls are included
  for full parity; reading topic options/using returned map is a Journal dependency,
  not migration of the Map page, graph, Reflection or Chat.

Mapping: feature-local JournalProvider/controller shared only with Journal sidebar/
header/editor, plus JournalPage/Editor/Navigation/Status/Suggestions, typed APIs,
date helpers and autosave/navigation hook. Provider-owned in-memory drafts are
needed to match legacy workspace persistence and survive Terms/loading unmounts;
they are cleared on session-owner change, never persisted in browser storage.
Use per-date mutation queues, baseline comparison and request identity/abort for
reads. React Router's blocker awaits dirty saves before leaving; migrate its outer
host to the data-router API (same routes) so it works in production and tests.
Router unload hook and a small documented document-visibility hook dependency
replace manual event binding; no editor/navigation DOM queries/listeners/loading.
Keepalive remains best effort, never marks a failed save clean; browser unload
protection warns while dirty. Loading disables only the editor for that date;
editing stays available during saves. Sidebar/header classes/assets stay original.

## Phase 10A password-change findings recorded before implementation

Read-only references: `views/account.html`, `js/account.js`, password form binding/
errors in `js/start.js`, DOM references in `app.js`, session semantics in auth.js,
Account grid/mobile CSS; backend users password route/Account DTO/schema, user
model, security/JWT validation/dependencies and existing Account password tests.
React Profile/API/controller/shared password validation were inspected first.

- Password change is a section inside the existing Account dialog, not a separate
  password dialog. Legacy visible fields are Current password and New password;
  no confirmation exists. Phase 10 explicitly requests client-only confirmation,
  so add it in the same grid and document that requested parity difference.
- Current field is hidden/not required when Account `has_password` is false;
  otherwise required. New input has native minlength 8, no maxlength/pattern.
  Legacy rejects blank/whitespace new password as `Enter a new password.` and
  sends raw passwords without trimming. Server new length is 8–128; current is
  nullable, max 128. Provider/passwordless users can set a password without current.
- Authenticated PATCH `/users/me/password` sends exactly
  `{current_password: currentValue || null, new_password: newValue}`. Confirmation
  is never sent. JSON/Bearer uses feely_token and legacy fetch credentials defaults,
  not CSRF/cookie authentication. Backend response is full UserAccountRead, including
  has_password/auth_provider, not a success-detail or replacement-token DTO.
- Incorrect/missing current password when hashed password exists gives 403
  `Current password is incorrect`; new/current length or malformed payload gives
  422 validation details. No same-password/reuse check exists, despite advisory
  copy `avoid reused passwords`; same current/new remains allowed. No password-
  specific or auth endpoint limiter is attached; general API middleware still
  applies, and frontend must preserve any 429/Retry-After response.
- Legacy shows `Updating password...`, applies returned account/user, rerenders
  Account (clearing current/new), then `Password updated.`. Errors go to Account
  status, retain entered fields and are not automatically replayed. No dedicated
  pending/double-submit guard exists; React will add requested duplicate protection.
- Backend updates hash/provider only. JWT validation uses sub/type/exp/active/
  verification without password-version/session revocation; current and other
  user JWTs remain valid. There is no replacement token, logout or fresh-login
  requirement. Apply the authoritative DTO through existing SessionController;
  Terms/subscription/JWT remain intact. `/users/me/password` is Terms-exempt,
  matching Account management; authentication/verification requirements still apply.

Mapping: `features/account/password/{ChangePasswordForm,changePasswordApi,
useChangePassword,types}` in the existing Account Security section. Local password
state only, shared minimum helper, requested confirmation, exact authenticated
PATCH, clear fields on success, and existing guarded Account response application/
forced-refresh fallback. Coordinate Profile/password writes with a small Account
write guard so full DTOs cannot race across forms or close/reopen. No new auth store
or token lifecycle, and no legacy/backend edits. Billing/deletion remain reference.

## Phase 9A recovery/reset findings recorded before implementation

Read-only references: `views/password-reset.html`, `js/auth.js`, recovery bindings
and startup in `js/start.js`, initial token capture in `app.js`, dialog/mobile CSS;
backend auth request/confirm routes, schemas/auth, core/password_reset/config,
security/dependencies and existing reset-email tests. React AuthLayout/Login,
safe auth handoff, Router and existing session behavior were inspected.

- Recovery requires one native email input, prefilled from Login; no username
  lookup UI. POST `/auth/password-reset/request` sends exactly `{email:trimmed}`.
  Backend EmailStr validation/lowercasing applies. Configured success for existing,
  unknown and disabled accounts is `{sent:true,detail:"If that account exists, a
password reset email has been sent."}`. Missing email delivery/reset config
  gives 503. Requests have the shared auth limiter plus three per address/hour
  by default, with 429/Retry-After. Legacy shows `Sending...`, disables Submit,
  displays detail/errors, keeps email, and has no client cooldown.
- Email link is `PUBLIC_APP_URL.rstrip('/') + '/?reset_password_token=' +
quote(token)`, no email/user ID/path parameter. Currently links use the configured
  existing frontend origin; no backend/config change is authorized. Old reference
  links keep working. React will accept the same root query or
  `/reset-password?reset_password_token=...` at its own origin. A future
  PUBLIC_APP_URL deployment/config change is needed to send new links to React.
- Tokens are secrets.token_urlsafe(32), stored backend as HMAC hash with a separate
  password-reset prefix. Expiry defaults 60 minutes; newer requests replace the
  previous hash. Confirm consumes/clears hash atomically; invalid/expired/used/
  disabled-user links share 400 `Password reset link is invalid or expired.`.
  Confirm uses the shared auth rate limiter, not an extra per-token policy.
- Form has required New password and Confirm new password, native minlength 8
  and new-password autocomplete. No strength/character policy. Backend password
  is 8–128 characters. Legacy does not set HTML maxlength; backend remains final
  authority for the maximum. Confirmation mismatch shows `The passwords do not
match.` and prevents the POST. Missing token shows `This reset link is missing
its token.`. Schema token length is 20–512; malformed requests produce 422.
- POST `/auth/password-reset/confirm` sends exactly `{token,new_password}`,
  password unmodified. Success `{reset:true,detail:"Your password has been reset.
You can now log in."}` has no JWT. Legacy shows `Saving...`, then detail, clears
  the underlying Login password, waits 1200 ms and closes back to the underlying
  Login/app. It neither logs in automatically nor signs out the existing session.
- Confirm changes password hash/provider and clears reset-token metadata. User JWT
  validation uses sub/type/exp/active/verification, without password-version checks;
  existing JWTs are not revoked. React must not clear feely_token or invent a new
  token lifecycle. Signed-in Login handoff follows its normal authenticated routing.

Mapping: `features/auth/recovery/{ForgotPasswordPage,ForgotPasswordForm,
ResetPasswordPage,ResetPasswordForm,recoveryApi,usePasswordRecovery,usePasswordReset,
types,resetLink}`. Reuse AuthLayout in routed paper mode and the original dialog
IDs/CSS. Native/password minimum rules remain shared in a small auth utility;
backend maximum/pattern/confirmation semantics stay unchanged. Reset token is
captured only in a mounted ref, never Router history state/storage/UI. Token-bearing
React root/HTML aliases render reset directly outside AppShell, then replace the
URL with token-free `/reset-password` without remounting that form. Recovery links
carry only public api_base/view and validated destination/email. Success clears
form secrets, waits the original 1200 ms, and replaces history with Login/fixed
notice; failed writes retain local fields and never replay automatically.

## Phase 8A activation findings recorded before implementation

Read-only references: `views/email-verification.html`, `js/auth.js`, activation
bindings in `js/start.js`/`app.js`, registration handoff and account verification/
old-link handlers in `js/account.js`, dialog/PIN/mobile CSS; backend auth request/
confirm routes, schemas/auth, core/email_verification, rate_limit/config and
existing email/PIN tests. Current React registration, Login, AuthLayout, session,
account verification link and routing were inspected before editing.

- Legacy opens its PIN dialog from registration, Login activation control,
  verification-required Login 403, or account request. Email is copied from the
  current field/canonical registration response into local UI state; it is not
  persisted or put into a URL. PIN starts empty; focus goes to PIN when email is
  present, otherwise email. Close keeps the underlying auth/account view.
- One required text PIN input: numeric inputmode, one-time-code autocomplete,
  `[0-9]{6}`, minlength/maxlength 6. It permits ordinary text/paste and validates
  on submit, without multiple boxes, filtering, auto-advance or special backspace.
  Email is required native email input. Leading zeroes are preserved.
- Public POST `/auth/email-verification/confirm` sends exactly trimmed email/PIN.
  Backend lowercases the validated email. Response `{verified:true,detail:"Email
verified."}` contains no JWT. Unknown, disabled, already-verified, invalid,
  expired or exhausted-attempt PINs share the same 400 invalid/expired message.
  Malformed email/PIN is FastAPI 422. PIN expiry defaults 15 minutes; maximum
  persisted attempts defaults five, scoped to email. Rate limit is 10 confirm
  requests per email per 900 seconds, plus the existing shared auth limiter.
- Public POST `/auth/email-verification/request` sends exactly `{email:trimmed}`.
  Enabled response for all accounts is `{sent:true,detail:"If that account exists
and needs verification, an email has been sent."}`; unknown/disabled/verified
  users receive that same response. Disabled configuration returns sent false
  with `Email verification is not enabled.`. Enabled send limit is three per email
  per hour, checked before user existence. 429 supplies Retry-After. Resend replaces
  PIN and resets attempts. SMTP failures propagate; response does not reveal PIN.
- Legacy disables the respective request button, shows `Activating...` or
  `Sending a new PIN...`, displays shared API errors, preserves fields on failure,
  clears PIN on success/resend. There is no client cooldown/countdown for resend;
  backend limits are authoritative. Add pending duplicate protection, no fake timer.
- Signed-out success closes activation, switches to Login, prefills email and
  shows `Email activated. You can now log in.`; no automatic login occurs and no
  token is written. Signed-in success loads the user and any open account; React
  will use existing forced session reload for account/capability/Terms freshness.
  Refresh failure must remain retryable and must not repeat the successful PIN POST.
- Newly generated email contains a six-digit PIN, not a verification URL. Existing
  high-entropy `verify_email_token` links are still handled by reference account.js
  using the same confirm endpoint's token variant. They remain valid at the
  unchanged reference URLs; React PIN mode will not invent a second link protocol.

Mapping: `features/auth/activation/{ActivationPage,ActivationForm,activationApi,
useActivation,types}` with shared pending mutation handling for confirm/resend.
Use AuthLayout and original dialog/form IDs/CSS in a routed card. Router state
carries only email, a fixed notice and validated destination/workspace; never
password/PIN/CAPTCHA/JWT. Registration unverified 201 navigates directly to
`/activate`; success returns to `/login` with prefill/fixed notice when signed out.
Login activation and account Verify email entries become React links. Verified
authenticated `/activate` reuses existing destination/Terms policy. No new session
store or authentication protocol, backend changes or recovery/reset migration.

## Phase 7A registration findings recorded before implementation

Read-only references inspected: `website/views/auth.html`, `js/auth.js`,
`js/start.js`, shared CAPTCHA state in `app.js`, `js/terms.js`, the email
verification view/handlers and auth/CAPTCHA/mobile CSS; backend `api/routes/auth.py`,
`schemas/user.py`, `core/captcha.py`, `services/terms.py`, and existing registration
tests. React login, API client, controller, routing and Terms services were read.

- UI: required Email (native email), Username (minlength 3) and Password (minlength
  8, new-password autocomplete in register mode). No confirmation/display-name,
  newsletter or separate privacy checkbox exists. Backend enforces username
  length 3–80 and ASCII letters/digits/underscore/dot/hyphen; password 8–128;
  EmailStr plus lowercasing. No availability/uniqueness preflight exists.
- POST `/auth/register` under `/api/v1` sends trimmed email/username/website,
  unmodified password, `captcha_token` (token when enabled, otherwise null), and
  only for published Terms: `terms_accepted:true`, `terms_version`,
  `terms_document_sha256`. Empty honeypot is `website:""`. No extra fields.
- Public `/terms/config` controls an explicit unchecked consent checkbox and the
  exact published URL. Before every submit legacy rereads it and clears consent
  on version/hash changes. Unpublished Terms disable consent and omit all consent
  fields. Test versions get the original unfinished-test warning. Registration
  stores acceptance server-side with `client:"api"`, unlike authenticated
  `/terms/accept`'s `{accepted,version,document_sha256,client:"web"}`.
- Turnstile configuration comes from public `/auth/captcha/config`: enabled,
  provider, site_key, action. Secret stays backend-only. Legacy loads the official
  explicit script, renders a flexible widget, receives a callback token, clears
  it on expiry/error and resets after every failed registration attempt. Backend
  verifies token/action remotely, with its existing test-secret behavior. React
  will keep this contract and refuse to submit while configuration is unknown
  instead of assuming CAPTCHA disabled after a failed config request.
- Legacy submit cooldown is 1200 ms, loading label `Creating account...`.
  Backend handles validation (422 detail list), missing/failed CAPTCHA (400),
  honeypot (400), duplicate email or username (same 409 detail), stale Terms (409),
  missing consent (422), provider failures (500/502/504) and rate limits (429).
  It can return 502 after committing the account if activation-email delivery
  fails; React must expose Activate account and avoid automatic registration replay.
- Successful 201 is UserRead: id/email/username/display_name/bio/avatar_url,
  is_email_verified/role/is_active/created_at. No JWT, PIN or activation identifier
  is returned. Backend uses username as display name. With verification enabled,
  email delivery sends the PIN and response is unverified. Legacy clears password,
  switches to login and opens its PIN dialog with the canonical response email.
  Otherwise legacy immediately POSTs login using the entered credentials.
- Reference PIN UI has no direct-entry/prefill URL or supported handoff storage.
  Keep it there: show canonical email and the original activation message in a
  React success handoff, link the same-origin reference login with public API-base
  override, instruct Activate account / enter email PIN, then return to React
  login. Do not invent query parameters, store credentials or migrate PIN UI.

Planned mapping: shared AuthLayout, `features/auth/registration/{RegistrationPage,
RegistrationForm,registrationApi,useRegistration,types,CaptchaWidget}`. Inputs,
consent and challenge token are local React state; provider operations are isolated
in a ref/effect boundary with cleanup and testable callbacks. Verified users reuse
existing authApi login and SessionController.establishSession. Unverified responses
never write `feely_token`. Registration success survives login failure as a created
account handoff, avoiding duplicate account creation. All legacy/backend files
remain unchanged. Password confirmation tests will assert its absence.

## Phase 6A sign-in findings recorded before implementation

Read-only references: `website/views/auth.html`, `js/auth.js`, `js/start.js`,
`app.js`, login-related `js/dialogs.js`/`js/account.js`, auth/responsive/theme CSS,
backend `api/routes/auth.py`, `schemas/auth.py`, `core/security.py`,
`api/dependencies.py`, and React SessionContext/controller/API/Terms routing.

- Login UI requires Email (`type=email`, autocomplete email) and Password
  (required, minlength 8, autocomplete current-password). Username, CAPTCHA,
  honeypot and registration consent belong to registration, not login. There is
  no remember-me option. Despite the email-only native UI, the backend also
  accepts case-insensitive usernames; preserving that UI restriction is deliberate.
- POST `/auth/login` relative to the existing `/api/v1` base sends exactly
  `{email_or_username: email.trim(), password}`. Backend identifier length is
  3–320 and password length 8–128. Password is neither trimmed nor transformed.
  Response is `{access_token, token_type: "bearer"}`. JWT contains `sub`,
  `token_type: "user"`, `exp`; the backend signs and validates it unchanged.
- Unknown, disabled or wrong-password accounts return 401 with detail
  `Incorrect email, username, or password`. Unverified accounts return 403
  `Please verify your email before logging in.` when verification is enabled or
  required. FastAPI validation detail and 429/Retry-After use the shared API error
  handling. A public login 401 must not invoke authenticated-session expiration.
- Legacy stores only the JWT at localStorage `feely_token`; sessionStorage and
  cookies are not the authentication mechanism. Authorization uses Bearer.
  Legacy prevents submissions within 1200 ms, disables the button with
  `Logging in...`, and keeps fields on failure. Unverified login opens its PIN
  dialog; React will instead link to that actual reference flow, without PIN logic.
- Legacy success stores the JWT, schedules expiry, checks Terms immediately,
  then loads subscription/user/chats/map and normally starts a fresh chat. Query
  `view=map/journal/account` changes destination. Feature data loading remains
  deferred. React's controller already owns expiry, 401 clearing, account,
  subscription and Terms loading; valid-token transient failures retain the token.
- React will add `features/auth/{LoginPage,LoginForm,authApi,types,useLogin}`,
  a small controller persistence method, and a shared authenticated-route guard.
  `/login` sits outside AppShell and uses the original auth classes/assets/theme
  and viewport hooks. The existing session remains the sole source of truth.
- Protected routes remember a validated local feature destination. Authenticated
  `/login` redirects to that destination or `/chat`, with `/terms` first whenever
  the existing `termsRequired` flag is true. Terms remains publicly readable;
  direct authenticated Account remains terms-exempt as before. Query API base
  and workspace state survive routing. Reference registration uses `mode=register`;
  recovery/verification links open the real reference login where those controls
  already exist; no unsupported legacy query flags will be invented.

## Phase 5A account findings recorded before implementation

References inspected: `website/views/account.html`, `js/account.js`, relevant
`auth.js`/`start.js`/`app.js` and `dialogs.js` handlers, account CSS, backend
`api/routes/users.py`, `schemas/user.py`, account/subscription/session dependencies,
and the current React SessionContext/controller, Terms gate and account DTO.
Legacy/backend source remains read-only.

- The visible editable personal fields are display name, username, email, avatar
  URL and bio. The header uses an initial, not the avatar URL as an image. Email
  verification and subscription plan/status/period are read-only displays. Backend
  IDs, roles, provider/password flags and timestamps are metadata, not editable
  profile controls; the legacy does not render extra metadata editors.
- Opening the legacy dialog fetches `/users/me/account` and `/billing/subscription`
  and copies account into shared user/account state. React already obtains both
  through its real session load, so the page can consume that verified data without
  duplicate feature-level GETs. This is the personal account endpoint, not the
  unrelated LLM/map `/users/me/profile` data endpoint.
- Save PATCHes `/users/me/account` with all five fields: trimmed `display_name`,
  `avatar_url`, `bio` or null; trimmed `username` and `email`. The backend PATCH is
  partial: omitted fields remain untouched; explicitly supplied nullable fields
  may be cleared. The frontend's full five-field payload preserves legacy behavior.
- Backend username rules: 3–80 characters, ASCII letters/digits/underscore/dot/
  hyphen, case-insensitive uniqueness. Email is validated, trimmed/lowercased and
  unique. Optional text is trimmed and empty becomes null; display name max 120,
  avatar URL/bio max 500. Native form validation also includes required username/
  email, email and URL input types, length constraints. Legacy markup does not add
  a username pattern; backend validation errors remain authoritative.
- A changed email resets verification according to existing backend configuration.
  The response contains normalized persisted fields and verification metadata.
  Legacy save directly replaces shared account/user and rerenders fields/sidebar;
  it does not reload subscription or issue a new JWT. Status text is `Saving...`,
  then `Saved.`, or the API error. Failed saves preserve entered values.
- Legacy Save is available with no changes and does not disable fields/button or
  prevent repeated submissions. No profile dirty warning, unload guard or close
  confirmation exists; reopening reloads and replaces unsaved fields. React will
  track dirty state without adding a navigation warning or disabling unchanged
  Save; only pending-save duplicate protection will be added as requested.
- Billing/checkout/portal/resume/cancel, password changes, deletion confirmations
  and verification/PIN actions are separate legacy handlers. In this phase their
  entry actions delegate to the same-origin reference account screen; React will
  neither submit their endpoints nor render new password/deletion workflows.
- Account remains authenticated but terms-exempt, matching backend/TermsGate.
  Subscription capabilities remain read-only data from SessionContext.

Planned mapping: `features/account/AccountPage.tsx`, `AccountSummary.tsx`,
`ProfileForm.tsx`, `accountApi.ts`, `types.ts`, a local draft/save hook, and a
minimal guarded SessionController method to apply the actual PATCH account DTO.
The routed card reuses the original account dialog/header/grid/section CSS;
native modal presentation remains a documented gap. Sensitive actions remain
clearly labeled reference links, without fake behavior or automatic side effects.

## Phase 4A findings recorded before implementation

Inspected `website/js/terms.js`, its callers in `auth.js`/`app.js`, relevant
`start.js`/`account.js` handlers, `website/agb.html` and
`website/legal/terms-page.js`; backend terms routes/service/model, user dependency
gating, and existing React API/session/capability/Feedback code. There is no
`website/views/terms.html`: mandatory review markup is constructed in `terms.js`.

- `GET /terms/config` is public and returns configured/enforced flags, version,
  document URL and SHA-256. A valid configured publication is enforced.
- `GET /terms/me` returns the same current publication, `accepted_current`, and
  acceptance records containing version, URL/hash, accepted timestamp and client.
  Acceptance must match the exact current version, URL and hash; JWTs contain no
  accepted-terms capability. Subscription permissions are separate.
- Legacy required review uses `current.enforced && !accepted_current`. Its UI
  links to the exact published document; it does not inject/download the document
  HTML into the application. Its checkbox starts unchecked; POST `/terms/accept`
  sends `{accepted:true, version, document_sha256, client:"web"}` with Bearer/JSON.
- An acceptance record is persisted by the backend; the legacy then reruns the
  session/application load. It does not locally grant Premium capabilities or
  issue a replacement JWT. Backend feature access changes with the persisted
  acceptance; client UI must reread real session/terms state.
- Pending submission disables checkbox/submit; failures remain visible and permit
  retry. A 409 recreates review from current `/terms/me` data with unchecked
  consent. Unpublished terms cannot be accepted (503). Duplicate same-version
  acceptance is backend-idempotent; account acceptance records are isolated.
- Mandatory review cannot be dismissed with Escape to regain protected feature
  access. Sign-out and account/subscription management remain available. The
  backend exempts terms, user/session/account/password, subscription and portal
  endpoints; other authenticated user features, including Feedback, receive 423.
- Manual reading exists through `/agb.html` and account/registration document
  links. Its public reader uses `/terms/config` without requiring sign-in.
- React currently reads `/terms/me` into SessionContext and blocks Feedback with
  `termsRequired`; 423 sets that flag. It has a reusable `controller.reload()`
  that reloads account, subscription and terms. Its review action still points to
  the reference site, so no real React acceptance UI exists yet.

Planned mapping: typed `features/terms/termsApi.ts`/`types.ts`, reusable
`TermsReview.tsx`, routed `TermsPage.tsx`, an acceptance hook using the existing
API client/controller, and a shared shell terms gate. `/terms` supports manual
reading and required review; `/agb.html` aliases it. Account/billing management
will keep reference links, and login will remain in `/reference/`. Required review
will use a routed paper view rather than a native modal in this phase; leaving
that route will not remove the backend/session gate.

## Inspection before implementation

The actual reference root is `website/`, not the repository root. There is no
separate `shell.html` in this checkout.

| Responsibility             | Existing implementation                                                                                                   | Migration implication                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry and shared frame     | `website/index.html`                                                                                                      | Keep the entry and all fragment references unchanged.                                                                                               |
| View loading               | `website/js/load-views.js`                                                                                                | Fetches `template[data-view]` fragments in parallel, inserts markup, then loads classic scripts sequentially. React must not execute this loader.   |
| Shared state and helpers   | `website/app.js`                                                                                                          | Global state, DOM bindings, theme, viewport sizing, API-base resolution, HTTP and streaming helpers. Extract only as a feature needs them.          |
| Navigation and events      | `website/js/navigation.js`, `website/js/start.js`                                                                         | Workspace visibility, active tabs, mobile sidebar, title updates, event listeners, initialization. Replace with React state and routing in Phase 2. |
| Shared visual design       | `website/styles.css`, `website/assets/`, Google Fonts in the entry                                                        | Import CSS directly; preserve classes, font weights, spacing and image URLs.                                                                        |
| Auth and session lifecycle | `website/js/auth.js`, helpers in `website/app.js`                                                                         | Preserve JWT expiry, stale-request protection, session validation, CAPTCHA, email verification and reset behavior.                                  |
| Dialogs and account        | `website/views/*.html`, `website/js/dialogs.js`, `website/js/account.js`, `website/js/terms.js`, `website/js/feedback.js` | These are mostly dialogs, not standalone page routes. Preserve dialog focus, dismissal and validation behavior when migrating.                      |
| Larger features            | `website/js/journal.js`, `website/js/map.js`, `website/js/chat.js`                                                        | Keep domain rules; split network logic, hooks and declarative components incrementally.                                                             |
| Static reference server    | `backend/website.py`                                                                                                          | Explicit allowlist for the original files; React runs independently with Vite.                                                                      |

Direct DOM manipulation is spread across the loader, `app.js`, the feature files,
and `start.js`: `querySelector`, `innerHTML`, element creation, `classList`, form
value updates, and `addEventListener`. These scripts also share global functions
and `state`; importing them directly into React would execute DOM bindings and
mix ownership. Only port pure logic and explicit services as needed.

## Phases and next files

Current status is Phase 15 stabilization. Earlier phase sections below record their historical
scope; Phases 6–15 supersede reference-only auth and Journal/Map/Reflection/Chat placeholders.

1. **Phase 1, implemented:** separate React/TypeScript/Vite package, locked
   dependencies, React Router, original styles/fonts/assets, basic shell and
   fallback route, independent run/build instructions. No feature/API migration.
2. **Phase 2, implemented:** `website/views/sidebar.html`, `website/js/navigation.js`,
   navigation handlers in `website/js/start.js`, and theme/viewport helpers in
   `website/app.js`. Add full sidebar, mobile behavior, active navigation,
   accessible workspace controls, appearance state and routing. That phase used
   public placeholders; the real session and feature gates were added subsequently.
3. **Phase 3A/3B, implemented:** real typed API/session integration first, verified
   independently, then `website/views/feedback.html` + `js/feedback.js`. Only
   Feedback was the real feature page in that pass. Account, login/registration,
   password reset and verification UI remain with the reference implementation.
   Account includes billing, cancellation, password changes and deletion; handle
   these separately in later work.
4. **Phase 4 (current request), implemented:** React Terms reading/review/acceptance,
   shared gating and forced post-acceptance session refresh. This numbering follows
   the current user request; larger-feature migration remains deferred below.
5. **Phase 5, implemented:** account/profile reading/editing and read-only plan
   summary, with billing/security/deletion/verification delegated to the reference.
6. **Phase 6, implemented:** existing-user sign-in with the original auth view,
   exact `/auth/login` payload/JWT storage, shared session loading, protected-route
   guard and Terms-first post-login routing. Registration/recovery remain reference.
7. **Phase 7, implemented:** registration, Turnstile, fresh explicit registration
   consent, real registration POST, verified-user existing-login branch and
   unverified-user reference activation handoff. PIN/recovery remain reference.
8. **Phase 8, implemented:** React PIN/email confirmation and resend, direct
   registration handoff/email prefill, separate Login after signed-out activation,
   and existing-token session refresh. Recovery/reset remain reference-only.
9. **Phase 9, implemented:** recovery email request and compatible password reset,
   memory-only token capture/URL cleanup, confirmation/password rules and original
   success/Login handoff. Existing JWT lifecycle is preserved.
10. **Phase 10, implemented:** authenticated Account password change, requested
    client confirmation, shared validation and write coordination, canonical DTO
    update with existing JWT/session behavior. Billing/deletion remain reference.
11. **Phase 11, implemented:** Journal editor/loading/history/local dates, exact
    autosave timing with safe queues/navigation, access gates and Journal-owned
    optional analysis/suggestion review. Map graph and Reflection remain deferred.
12. **Phase 12, implemented:** real Map HTML/SVG, deterministic desktop/mobile
    layout, selection/filter/sidebar/details, topic/link/merge/delete, entry/practice
    mutations, Journal refresh/date integration, authoritative access and safe queues.
13. **Phase 13, implemented:** original practice-only Reflection modal, optional
    answer, exact atomic completion, canonical Map response, source/owner/gate/error/
    pending-input protection and safe Terms/activation return metadata.
14. **Phase 14, implemented:** `views/chat.html` + `js/chat.js`: real conversations,
    fetch NDJSON streaming, phrase playback, owned generation/Stop, shortcuts,
    deletion/reactions, analysis/reviews, quota gates and Map sources. Shared
    session/Map coordination remains authoritative; see final validation below.
15. **Implemented with explicit verification gaps:** targeted architecture/readability,
    shared dialogs/transport, state ownership, loading boundaries, accessibility,
    bundle splitting, developer/legacy/Android documentation. Native visual/device
    testing remains pending; no Capacitor installation or legacy removal.

Admin and webmail remain separate reference applications and are outside these
phases. Do not remove any reference files until full parity is explicitly approved.

## API and authentication contracts to preserve

No backend, endpoint, request or response contract changed in Phases 1–14.
Phase 3 extracts shared JSON request/session behavior; Phase 4 adds Terms UI;
Phase 5 adds account/profile editing; Phase 6 adds sign-in; Phase 7 adds registration;
Phase 8 adds PIN activation/resend; Phase 9 adds recovery/reset; Phase 10 adds
authenticated password change; Phase 11 adds Journal; Phase 12 adds My Map;
Phase 13 adds atomic Practice Reflection/completion; Phase 14 consumes existing
Chat NDJSON streaming and conversation/review endpoints without backend changes.

When extracting `website/app.js`, preserve the actual API-base precedence:
`api_base` query parameter first; file/local hosts use
`http://127.0.0.1:8000/api/v1`; otherwise the `feely-api-base` meta value,
then `feely_api_base` storage, then the current origin plus `/api/v1`.
The reference entry's public meta value is `https://api.feel-y.com/api/v1`.
Local hosts ignore the stored base; use `?api_base=...` to override them.

`feely_token` holds the JWT. Authenticated calls explicitly attach
`Authorization: Bearer ...`; the shared HTTP helper adds JSON content type.
Preserve the one retry after 400 ms for GET network failures, no automatic retry
for writes, FastAPI `detail`/validation errors, HTTP 429 `Retry-After`, authenticated
401 expiry, 423 terms acceptance, stale-token response checks, and the separate
line-delimited streaming parser. Temporary failures must not erase a valid session.

Relevant existing endpoint groups (not an exhaustive list):

- `/auth/login`, `/auth/register`, `/auth/captcha/config`, `/auth/email/config`,
  email-verification and password-reset routes.
- `/users/me/account`, `/users/me/password`, `/users/me` session revalidation.
- `/billing/subscription`, checkout/sync, portal, and resume routes.
- `/feedback/config`, `/feedback`; `/terms/config`, `/terms/me`, `/terms/accept`.
- Journal and LLM routes defined in `backend/api/routes/journal.py` and `llm.py`.

Browser storage is separated by origin, including port. Signing in at 5500 will
not sign in at 5173. The same-origin `/reference/` bridge lets the original login
establish the original localStorage session on React's origin, without transferring
tokens between origins. Premium and authorization checks remain enforced by the API.

The exact React origin must be allowed by the existing backend CORS rules. Phase 3
uses those rules without editing backend configuration. The inspected local-mode
origin regex permits local HTTP origins; the real isolated API preflight for
`http://127.0.0.1:5173` passed. Public deployments still need their approved origin.
`127.0.0.1` and `localhost` are different origins even at the same port.

## Historical Phase 2 implementation and component mapping

This section records the Phase 2 boundary. Phase 3 below supersedes its preview
session and feedback-placeholder assumptions; the shared layout remains intact.

The reference files were read before edits. `website/index.html` is the actual
shell; the requested `website/shell.html` does not exist. Existing reference HTML,
JavaScript, CSS, assets, backend, and tests remained read-only.

| Reference                                                                     | React implementation                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shell layout in `website/index.html`                                          | `src/components/layout/AppShell.tsx`: persistent frame, backdrop, header and routed outlet.                                                                              |
| `views/sidebar.html`                                                          | `Sidebar.tsx`: exact brand/icons/profile placement, Journal/feedback/account controls. `SidebarContext.tsx`: workspace-specific sidebar sections and capability layouts. |
| Chat/Map tabs in `views/sidebar.html`; arrow handlers in `js/start.js`        | `Navigation.tsx`: original buttons/classes/SVGs, selected state, roving focus, React Router navigation.                                                                  |
| `js/navigation.js` open/close and workspace switching                         | `useSidebar.ts`, route metadata in `utils/routes.ts`, `App.tsx` and Router location/state. No manual view downloads or class toggling.                                   |
| Header portions of `views/chat.html`, `views/map.html`, `views/journal.html`  | `WorkspaceHeader.tsx`: workspace copy, full/short map title, menu button, original header classes. Feature-specific actions remain deferred.                             |
| Theme helpers in `app.js`; toggle handlers in `js/start.js`                   | `useAppearance.ts` and `ThemeToggle.tsx`: original preference key, colors, switch labels and icons; storage failures remain nonfatal.                                    |
| Viewport helpers in `app.js` and resize/orientation handlers in `js/start.js` | `useViewportHeight.ts`, `useMobileLayout.ts`: the original CSS height variable and 900px breakpoint, browser subscriptions with cleanup.                                 |
| User/Premium/feedback-driven sidebar rendering                                | Typed `ShellSession` input plus explicit `services/previewSession.ts`. No auth/business logic was migrated.                                                              |

The reference navigation uses DOM visibility and global state rather than a URL
router. It depends on `state.activeChatId`, `state.activeMapNodeId`,
`state.mapDetailOpen`, `state.journalDirty`, subscription capabilities and user
details. Workspace changes close the sidebar, adjust title/active controls,
select the matching sidebar context, trigger feature loading, save dirty journal
content, and sometimes reopen navigation when returning to an empty chat.
React now handles only the shared route/layout/state responsibilities. Those
feature lifecycle effects remain with their legacy modules until later phases.

Authentication originally hides the entire shell until a valid session and terms
acceptance exist. Feedback visibility comes from `/feedback/config`; map/journal
access comes from billing. The new shell is an explicitly unauthenticated public
preview with no data. Its free-access flags and visible feedback are local layout
assumptions, not an auth state or permission check. Sign-out is disabled.

All six requested routes are available. Root/legacy HTML aliases and `view`
queries canonicalize using `<Navigate replace>`. Unknown routes render a fallback.
Query overrides survive shell navigation. Account/feedback preserve workspace
context in Router state; direct entry defaults to Chat. Reflection belongs to
Map. Back/Forward restore the corresponding sidebar and close an open mobile
drawer. Re-selecting an active tab replaces its history entry.

### Deferred behavior and parity limits

- Chat lists, streaming, polling, composer, fresh-chat state and automatic
  reopening when returning to an empty chat are deferred to the chat migration.
- Journal lists, date controls, autosave and dirty-entry navigation handling are
  deferred. Topic creation, graph selection/reset/loading and reflection practice
  completion are deferred. No feature data or fake saved records are supplied.
- Account, feedback and reflection currently display full-panel placeholders;
  their legacy dialogs, focus restoration and submission behavior belong to
  Phase 3/4. The reflection preview link exists only in placeholder content.
- Authentication guards, terms requirements, real capabilities, feedback config,
  sign-out and billing return notifications remain deferred. Header feature
  actions and the billing banner are not implemented in the placeholder shell.
- Router paths and Back/Forward behavior are new; the legacy workspace switch
  leaves the URL unchanged. Legacy `view` query entry semantics are retained where
  practical and extended to all placeholder routes.
- Appearance and icons reuse original CSS. Small React-only CSS rules provide
  active feedback/account states, readable active Journal text in light mode and
  disabled-sign-out appearance. The reference stylesheet is not edited.
- Escape dismissal, focus containment/restoration and `inert` handling improve
  the legacy mobile drawer's keyboard behavior without changing its geometry.
- No browser was available for screenshots or real responsive visual review.
  DOM interaction tests simulate the media/viewport inputs; they do not establish
  visual parity or prove real-browser `inert`/CSS behavior.

### Phase 2 recommendation (completed in Phase 3)

Start with `website/views/feedback.html` and `website/js/feedback.js`: a small
form with a configuration flag, submission, loading, success and error states.
Introduce the typed HTTP/session boundary and required authentication before
making protected feedback calls; preserve `/feedback/config`, `/feedback`, the
existing JSON body, JWT header, flag-disable behavior and failed-message retention.
Keep its dialog semantics when replacing the placeholder. This phase does not
implement those services or change any endpoint. Phase 3 now implements the
recommended foundation and Feedback within the new frontend only.

## Historical Phase 3A inspection and API/session mapping

References read before edits: `website/app.js`, `js/auth.js`, `js/account.js`,
`js/start.js`, `js/terms.js`, `js/feedback.js`; backend `auth.py`, `users.py`,
`billing.py`, `terms.py`, `feedback.py`, `api/dependencies.py`, `main.py`, and
their schemas. None of these reference files were modified.

The reference authenticates using `feely_token` in localStorage. Login returns
`access_token`/`token_type`; authenticated requests send Bearer authorization.
There is no sessionStorage, cookie session or CSRF-token mechanism in the inspected
user API flow. Fetch leaves `credentials` unset, so same-origin cookies retain
the platform default and cross-origin cookies are not newly included. Backend
CORS `allow_credentials=True` does not mean the reference sends cross-origin
cookie credentials. JWT presence alone is not proof of a usable session.

The reference detects malformed/expired JWTs locally using `exp`, schedules
expiry, validates returned sessions at `/users/me`, and loads account data at
`/users/me/account`. Current authenticated 401s expire the session; public login
401s and stale requests cannot sign out a new account. 403/429/5xx retain tokens.
Backend account disabling/deletion/revocation and email-verification rules are
enforced by the existing dependencies. Terms use 423 for protected operations;
account, session, terms and subscription reads are exempt. Billing-derived
`my_map_access`/`journal_access` and `/feedback/config.enabled` control the UI.

| Responsibility                          | React implementation                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Legacy API-base resolution              | `services/config.ts`: query override, local default, public Vite setting replacing meta, stored base, origin fallback. Root backend `.env` stays private/unchanged.                        |
| Shared JSON HTTP behavior               | `services/apiClient.ts`: JSON headers, optional explicit Bearer auth, default credentials, GET-only network retry, FastAPI/HTML/rate-limit errors, before/after-body stale-session checks. |
| Account/subscription/terms/config reads | `services/sessionApi.ts` plus `types/api.ts`: original endpoints and typed responses. Temporary subscription failures preserve the existing free fallback; 401/403 propagate.              |
| Token and session lifecycle             | `services/sessionController.ts`: explicit loading/authenticated/unauthenticated/error states, expiry, protected 401 invalidation, stale generations, local sign-out and revalidation.      |
| React lifecycle integration             | `context/SessionContext.tsx`, `hooks/useSession.ts`: provider, cleanup, focus/visibility and same-origin storage changes. StrictMode and stopped-provider responses are covered by tests.  |
| Real shell identity/capabilities        | `services/shellSession.ts`: account display name/email, subscription access, real feedback flag and sign-out.                                                                              |
| Login reuse without migrating its UI    | Vite dev/preview `/reference/` proxy; `SessionNotice.tsx` links to unchanged reference login on the React origin and provides session retries.                                             |

Production no longer imports the preview-session module. It was moved to
`src/test/previewSession.ts` for the 23 historical layout tests. Their route slot
stubs isolate shell behavior; separate integration tests exercise production
Feedback/session routes. No runtime preview auth switch was introduced.

The app loads account, subscription and terms concurrently rather than running
the reference chat initialization. Chat/map/journal loading, polling and state
resets stay deferred. The API base is resolved once when the provider is created;
refresh after changing configuration. Sign-out clears the local token and feedback
state; there is no new backend logout endpoint.

## Historical Phase 3B Feedback mapping

This section records the Phase 3 boundary. Phase 4 below replaces its reference-only
Terms UI and gating notice; Feedback's form and session model remain intact.

`features/feedback/FeedbackPage.tsx`, `feedbackApi.ts`, `types.ts`, and
`FeedbackContext.tsx` replace the `/feedback` placeholder. Other requested
feature routes remain placeholders.

The page keeps the original heading, description, category labels/values, required
message field, six rows, 3–5000 character limits, placeholder and button copy.
`#feedback-dialog`, `.app-dialog`, original field IDs and responsive CSS preserve
the paper-panel styling. Inputs are controlled; native validation plus the raw
length guard prevent invalid/repeated submission. The original backend also
validates the trimmed message and can return a 422 for whitespace-only input.

POST `/feedback` sends only `{category, message: trimmedText}` with Bearer/JSON
headers. Pending state disables the submit button and shows `Saving feedback...`.
Success displays the exact backend `detail` and resets category/message. Failures
keep the draft; 429 includes `Retry-After`; writes never automatically retry.
404 hides the sidebar entry and form. 401 expires the session; 423 blocks further
submissions without clearing the token/draft. An accepted-terms/session recheck
restores the form. Public config failures hide navigation and expose a retry on
direct entry. Disabled config never permits submission.

The feature provider preserves the in-memory draft across route close/reopen,
like the legacy always-mounted dialog. It maintains pending-submit protection
across navigation, clears drafts on logout/account change (including reuse of a
JWT string), and ignores responses from another session. No feedback drafts are
written to localStorage, and no chat content is attached.

### Current differences and deferred work

- Feedback is an inline routed paper panel rather than the native modal. It has
  no modal backdrop/Escape dialog behavior; Close returns to the originating
  workspace. Generic dialog migration is explicitly deferred. A disabled feature
  displays a closure message on its URL instead of closing a modal.
- Login/registration, email PIN, reset flows and explicit terms acceptance still
  run in the read-only reference site. The proxy serves a full separate reference
  document; React never loads legacy views or executes legacy scripts.
- A static production host must supply a same-origin reference-login bridge or
  await the React auth UI migration. Vite proxy code is not part of `dist/`.
  Direct login at 5500 cannot establish a 5173 session. Tokens are not passed in URLs.
- Terms-required status is real and blocks Feedback, but its review/acceptance
  dialog is deferred. Use the reference review followed by **Check session again**;
  no acceptance is recorded automatically. Registration and email-verification
  errors continue through the reference flow.
- The shell and other feature placeholders remain usable when signed out; no
  protected feature data is rendered. Backend/session errors have explicit retry
  states instead of falling back to a fake identity.
- Browser screenshots and real desktop/mobile visual checks were unavailable.
  DOM tests and actual isolated backend contract checks do not establish complete
  visual or browser login-workflow parity.

### Phase 3 recommendation (completed in Phase 4)

Migrate the terms-review/acceptance UI next. Its status endpoint/types already
exist, it has fewer dependencies than account billing/security/deletion, and it
removes the external-reference step that currently blocks Feedback and future
protected features. Preserve exact version/hash consent and conflict handling.
Then migrate account/profile in small steps; keep billing, password changes and
deletion separate. No part of that future work is implemented in this phase.

## Historical Phase 4 implementation and verification mapping

This section records Phase 4. Phase 5 below supersedes its account-placeholder
assumption; Terms review, acceptance and gating remain unchanged.

`features/terms/TermsPage.tsx` now supports explicit/manual `/terms` entry and
required review. `/agb.html` aliases it. The account placeholder reuses its existing
legal-link semantics; main workspace navigation is unchanged. Public readers call
`GET /terms/config`; signed-in entry refreshes the existing controller and reads
its real `/terms/me` data. No policy HTML is loaded into React: the exact published
document URL is shown as the legacy Read/save link, with its version.

`TermsReview.tsx` preserves the mandatory form's copy, IDs, global classes,
unchecked consent, pending-disabled controls, explicit submit, sign-out and
management actions. `types.ts`/`termsApi.ts` preserve backend configuration and
acceptance record fields and send the exact legacy web payload. Shared API types
now type `acceptances` instead of leaving them as unknown entries.

`useTermsAcceptance.ts` coordinates the write and session refresh; it does not
set `termsRequired=false` or modify subscription capabilities itself. The existing
`SessionController.reload()` gained a small `force` option. Success/conflict use
`reload({force:true})`, guaranteeing a read after the write rather than coalescing
an older pending read. Revision checks prevent old read responses from undoing
the refreshed state. Successful acceptance leaves the JWT unchanged.

During refresh, session loading/error states keep Feedback unavailable. If fresh
state still requires terms (for example a publication changed during submission),
the current review remains and consent is reset. A 409 refreshes the document and
resets consent keyed by user token, version, hash and URL; ordinary failures retain
consent and show the backend error. There is no write replay or automatic consent.
Stale user/unmounted-view results cannot redirect to an old feature.

`TermsGate.tsx` uses only SessionContext and wraps the shell's feature outlet.
Required users receive the shared notice and internal `/terms` link instead of
gated feature content. Account and Terms are exempt; entry aliases/fallback routes
still resolve normally. `SessionNotice.tsx` preserves workspace/query context and
the originating feature for the return after acceptance. This is shared routing/
session behavior and does not couple Terms to Feedback's mutation/form logic.
The original 423 Feedback test remains covered, with its review-link expectation
updated from the obsolete reference link to the new React action.

### Phase 4 parity gaps and deferred work

- Required review is a routed paper panel, not the legacy undismissable native
  modal. There is no modal backdrop or focus containment; users may change URL,
  but the real session/backend gate still prevents protected feature access.
  The form remains separate from its routed wrapper for later modal presentation.
- Manual public reading is within the shared shell rather than the standalone
  public legal-page layout. It keeps the original title/version/document link;
  the published legal content itself stays unchanged at its backend-provided URL.
- Account and subscription controls link to the unchanged reference management
  screen instead of porting account dialogs or creating a Stripe portal here.
  Its existing terms prompt may require choosing the relevant management action.
- Reference login still runs its original terms check, so that tab may display
  its legacy prompt even when the user reviews/accepts from the React tab. No
  reference/auth code was changed to suppress it. React acceptance itself no
  longer requires reference UI.
- Registration consent, password reset, email PIN, login UI, account, billing,
  chat, map, journal and reflection remain deferred. No acceptance/history editor
  or new capability model was introduced.
- Real browser screenshot/responsive visual validation was unavailable. Session,
  routing, consent/conflict/gating interactions and actual backend contracts are
  verified independently; visual/modal parity is not claimed.

### Phase 4 recommendation (completed in Phase 5)

Migrate account/profile reading and editing next: the real account DTO/session
data and exempt `/users/me/account` endpoint are already available. Keep billing,
password changes, deletion and the broader login/verification UI as separate
increments because they require more lifecycle and confirmation behavior.

## Phase 5 implementation and account source of truth

`features/account/AccountPage.tsx` replaces the `/account` placeholder. It consumes
the existing authenticated SessionContext account/subscription DTOs, with loading,
error/retry and reference sign-in states. No extra account/subscription GET is
performed just to mount the feature. Other large features remain placeholders.
The existing account terms exemption is preserved; reading/saving a profile never
marks terms accepted or changes subscription permissions.

`ProfileForm.tsx`, `types.ts` and `useProfileForm.ts` own only local edit fields,
comparison baseline, dirty/saving/status state and pending guards. Native labels,
input types/limits, copy, grid and email-status display match the reference.
`accountApi.ts` uses the existing client to PATCH the exact five-field legacy
payload. Optional blanks are null, other values are trimmed; the returned DTO,
including normalized email and verification flags, is authoritative.

`SessionController.applyAccountResponse()` is a minimal guarded shared update,
not another account/auth model. It only applies a backend account response to the
current authenticated token and matching account ID; obsolete reads are invalidated.
Terms, subscription, expiry and JWT state are preserved. A concurrent loading state
uses the existing forced refresh fallback instead of a stale capability snapshot.
Successful saves update the form baseline and sidebar and show `Saved.` without
reloading the page or needlessly refetching unchanged capability data.

Failed saves keep all entered fields and dirty state. No navigation/unload prompt
was added: the legacy has none. Closing/reopening restores the verified shared
account and discards unsaved edits. Unchanged Save remains enabled, as in the
reference. Pending saves disable Save and serialize same-session writes across
route close/reopen, preventing overlapping responses from overwriting shared data.
Old-user and wrong-account responses cannot replace the current account.

`AccountSummary.tsx` reuses the header initial, plan/status/date labels, free-test
override, benefits and subscription note. This is read-only presentation of the
existing subscription DTO; no checkout, portal, resume/cancel or provider API was
migrated. `referenceActions.ts` supplies the same-origin reference account URL.
Password, deletion, billing and verification actions are links with an explicit
delegation note, not fake controls or automatic side effects.

Tests retain all previous shell/Feedback/Terms behavior checks. The shell fixture
uses an account route slot to isolate historical layout assertions, while real
account integration tests exercise the production route. The Terms exemption
assertion now expects the migrated profile UI rather than its obsolete placeholder.

### Phase 5 parity differences and deferred work

- Account is a routed card, not the legacy native modal. Original header/body/grid/
  section and responsive CSS remain; modal backdrop/focus behavior is deferred.
- The verified session DTO is reused on entry rather than refetched every time the
  legacy dialog opens. Direct React saves refresh shared data from the response.
  Changes made in the reference site require a React reload/session refresh;
  ordinary focus revalidation does not refresh account/subscription values.
- Pending duplicate-save protection is intentionally added under this phase's
  request. The legacy permitted duplicate saves. Dirty tracking adds no new
  warnings and does not disable unchanged Save.
- The subscription overview is real/read-only, but per-plan subscribe/resume/
  cancellation controls are consolidated into a reference billing entry. Password
  input forms and deletion dialogs are replaced by reference links. A user chooses
  and confirms the actual action there; opening a link does not execute it.
- Email verification is read-only status plus a reference link. A changed email's
  returned status is preserved, including any subsequent backend 403 verification
  requirement. No verification email/PIN, login/logout redesign, billing, password
  or deletion implementation was added.
- Metadata role/IDs/timestamps remain in the typed session DTO; no new metadata
  editors were invented. Avatar URLs are not fetched as images, matching legacy.
- Browser visual/responsive screenshots were unavailable. DOM/HTTP and actual
  isolated backend contracts were checked; full visual/modal parity is not claimed.

### Phase 5 recommendation (completed in Phase 6)

Migrate existing-user login/sign-in next as a focused step, reusing the established
JWT/session/Terms infrastructure. It has fewer dependencies than journal autosave,
map editing or chat streaming and reduces reliance on the reference bridge for
normal entry. Keep registration, CAPTCHA, verification and recovery as separate
increments; sensitive account/payment workflows remain reference-only for now.

## Phase 6 implementation and sign-in flow

`features/auth/LoginPage.tsx` sits outside AppShell, inside the original `.shell`
and `.auth-view` layout. `LoginForm.tsx` recreates the original story, brand, copy,
tabs, fields and status classes using controlled inputs. Shared appearance and
viewport hooks and ThemeToggle retain light/dark and mobile styling. The only
CSS addition centers the Register link exactly like its original button.

`authApi.ts` uses the existing public ApiClient POST `/auth/login`, without a
Bearer header or new cookie behavior. It validates `{access_token,token_type}`
before handing the unchanged JWT to `SessionController.establishSession()`.
That minimal method writes localStorage `feely_token` and invokes the existing
forced reload. No second token/session model or feature-level account fetch exists.
The controller still owns expiry, authenticated 401 clearing, account, subscription,
Terms, 423 gating and conservative capability fallback. Public login 401s show
credential errors without expiring an unrelated session.

`useLogin.ts` owns only transient credentials/errors, in-flight protection and the
legacy 1200 ms cooldown. Login POSTs are never automatically retried. Fields stay
on authentication failure; the password is cleared once authentication succeeds,
including storage/session-load failure. Credentials are never stored in URL,
storage, shared session or logs. Abort/unmount and expected-session checks prevent
late responses from signing in over a changed session. Blocked localStorage
shows an explicit error rather than creating a competing memory-only session.

`RequireSession.tsx` protects Chat/Map/Journal/Reflection placeholders and the real
Account/Feedback pages. It waits for validated shared state, exposes existing
session errors/retry, and routes signed-out users to `/login` with the requested
feature/workspace. Terms stays publicly readable. Historical shell test fixtures
alone can bypass this guard without production fake authentication.

`loginReturnPath()` accepts known local non-Terms feature paths only, defaulting
to `/chat`. It rejects login/external/unknown destinations and supports legacy
`view=` hints. Query overrides survive, while the consumed view hint is removed.
Authenticated `/login` navigates immediately to the destination or `/terms` when
the controller's existing `termsRequired` flag is true. Required Terms carries
the validated destination in `afterTerms`, so the existing acceptance hook's
forced reload restores access and returns there. It cannot return to login or
loop through Terms. Direct authenticated Account remains terms-exempt.

`SessionNotice` now links to React sign-in. Existing session sign-out methods
are unchanged. A temporary account/session-load failure retains the valid JWT
and stays on login with Retry session, without resubmitting credentials; invalid/
expired JWTs and authenticated 401s use the existing unauthenticated lifecycle.

`referenceAuth.ts` delegates Register (`mode=register`), recovery and activation
to full reference documents, carrying only the public API-base override. Public
`/auth/email/config` controls the activation link like the legacy; unavailable
config does not block login. A verification 403 also exposes activation. React
does not submit registration/CAPTCHA/verification/reset/password/billing/deletion
endpoints. Vite dev/preview still proxy the unchanged reference on the same origin.

### Phase 6 parity differences and deferred work

- The original HTML email constraint stays, even though the backend also accepts
  usernames. No new input validation or authentication protocol was invented.
- Register and recovery/PIN controls open reference tabs rather than switching
  mode or opening dialogs inline. Recovery/activation requires choosing the real
  control there; the legacy provides no direct-entry URL. Activation visibility
  follows public verification configuration, with a 403 recovery link as well.
- Passwords are cleared after successful authentication instead of remaining in
  a hidden legacy form. Authentication failures keep entered local fields.
- Default post-login Chat and remembered feature routing are preserved; chat
  creation/data, map/journal loading and polling remain intentionally deferred.
- React validates the full shared account/capability/Terms state before routing.
  The legacy checks Terms before loading its other feature data; React reuses
  its established parallel session load and the same backend Terms authority.
- The previous routed Account/Terms dialog differences still apply. No available
  Browser meant visual/responsive screenshot comparison remains unverified;
  shared CSS/assets, DOM/routing tests and live HTTP/contracts were checked.
- A static deployment still needs SPA fallback, approved API origin, and a
  separate same-origin reference bridge for remaining auth/sensitive actions.
  Existing-user React login no longer requires the reference proxy.

### Phase 6 recommendation (completed in Phase 7)

Migrate registration as its own increment, inspecting registration consent,
CAPTCHA and activation/PIN handoff first. Implement those real dependencies
explicitly or retain documented reference handoffs; do not combine recovery,
password changes, billing or deletion into that increment. Journal/Map/Reflection
remain later feature steps; Chat remains last. Keep all reference code intact.

## Phase 7 implementation and registration contract

`features/auth/registration/RegistrationPage.tsx` adds `/register`; Login's Register
action is now a Router link. `AuthLayout.tsx` extracts the already-migrated original
auth shell without changing login/session architecture. Register has the original
heading, fields, honeypot, CAPTCHA position, consent text, button/status copy and
responsive CSS. Legacy React `mode=register` entries are mapped to the new route;
authenticated visits reuse LoginPage's existing validated destination/Terms policy.

`registrationApi.ts` loads public CAPTCHA configuration, builds the exact payload
and POSTs `/auth/register` through ApiClient. Response validation expects a UserRead
with an explicit verification flag; no registration JWT/PIN is expected or stored.
Unpublished Terms omit their fields, disabled CAPTCHA sends null. Username/email
availability is handled only by backend. Required/email/minlength UI rules stay
as legacy; pattern/max-length rules stay server-authoritative. There is no password
confirmation field, display-name input or additional consent checkbox.

`useRegistration.ts` owns local fields, unchecked consent, transient challenge,
errors/loading, created-user result and request guards. It rereads public Terms
before every attempt; version/hash changes clear consent. Terms configuration and
registration consent are not borrowed from authenticated session acceptance.
The API records the registration acceptance as `client:"api"`; authenticated
Terms continues to use its separate exact web acceptance payload.

`CaptchaWidget.tsx` encapsulates the external Turnstile SDK: public backend sitekey,
action fallback `register`, flexible size, successful-token callback, expiry/error
clearing, failed-attempt reset, and remove/late-callback protection on unmount.
`turnstileLoader.ts` loads the official explicit script once per pending request,
reuses the loaded SDK and permits retry after failure. Its narrow `createElement`/
script callbacks/head append are needed because React component script tags do
not execute. This is solely dependency loading; no application querySelector,
innerHTML, manual addEventListener, view loading or navigation is introduced.
The external provider alone controls its widget container via a React ref.
[Cloudflare's explicit rendering documentation](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/)
was checked alongside the legacy integration; the original backend verification
contract remains authoritative. No secret is configured in frontend code, no
NODE_ENV/test CAPTCHA bypass exists, and passwords/challenge tokens are not logged.

On failure, fields remain and the challenge resets; POST is never automatically
replayed. Pending duplicate protection and the legacy 1200 ms cooldown apply.
Unknown/unavailable registration configuration blocks submission with Retry;
unsupported/unconfigured enabled CAPTCHA cannot produce a valid challenge.
Errors use the existing FastAPI detail/validation/network/429 handling.

201 unverified user: clear password, show original sent-PIN message and canonical
email, offer the real reference Activate account entry and React Login. No login,
verification endpoint or token write occurs. Reference flow receives only its
existing public API-base override, never credentials or an invented PIN parameter.
It has no direct-entry/prefill contract, so users choose its activation control and
enter the displayed email/PIN. No PIN UI migration was necessary for a safe handoff.

201 already-verified user: preserve legacy's immediate separate authApi login,
then establishSession and the existing shared account/capability/Terms flow. Only
the login JWT is stored. A failed login leaves a created-account Login handoff;
failed shared loading retains the token and offers existing session retry. There
is no new session store/controller logic. Stale/unmounted submissions cannot
establish a session. Backend post-commit email failure remains a 502 with an
activation/resend link, without automatic registration replay or a fake success.

### Phase 7 parity differences and known backend behavior

- PIN is still a reference dialog. React's successful unverified registration has
  an explicit handoff instead of opening it inline and prefilling email. Additional
  reference control selection/manual email entry is required; canonical email
  stays visible in React, and nothing sensitive is placed in URL/storage.
- Registration with verification disabled follows legacy auto-login. React clears
  successful-registration passwords and keeps a created-account result if that
  login fails, instead of allowing another registration POST for the new account.
- Legacy treated a CAPTCHA configuration network failure as disabled; React blocks
  until config is loaded, as required to avoid a protection bypass assumption.
  Failed SDK loading has a retry control; protection never silently disappears.
- Consent rechecks version/hash exactly like legacy. A changed URL alone updates
  the link without clearing consent; the backend records the current publication
  URL. No client `web` acceptance payload is sent by registration.
- Backend may commit a new account and then return 502 when email delivery fails.
  This preexisting behavior is preserved and exposed, not fixed in backend code.
  The created user must use reference activation/resend rather than retry blindly.
- Backend local settings can require verification while disabling its delivery:
  registration then marks new users verified because creation keys to enabled,
  so they can log in without PIN verification. React follows the actual returned
  flags. Production settings already reject that configuration; no backend fix.
- Browser discovery returned no browser. Real responsive/screenshot parity and
  an external Cloudflare challenge remain unverified. Ref/SDK lifecycle tests,
  HTTP/assets and real auth routes with a local Siteverify transport were checked.
- Recovery/reset/password changes, PIN confirmation/resend, billing/deletion and
  larger features remain deferred. Existing Account/Terms presentation gaps persist.

### Phase 7 recommendation (completed in Phase 8)

Migrate email activation/PIN confirmation and resend next as a focused feature.
Inspect the existing PIN rules, cooldowns and canonical-email state, then close
the remaining registration/Login handoff gap without combining recovery/reset,
password changes or billing. Preserve the reference frontend until full parity.

## Phase 8 implementation and activation source of truth

`features/auth/activation/{ActivationPage,ActivationForm,activationApi,useActivation,
types}` adds public `/activate`. `AuthLayout` reuses the original lake/story and
appearance/viewport hooks with an activation mode; Login/Register chrome is
omitted from the paper card to retain the dialog's sole Close control. Original
email-verification dialog/form/PIN IDs, labels, copy, native validation and mobile
CSS remain. The card is routed, without a native backdrop or focus trap.

`activationApi.ts` uses public ApiClient POSTs only: confirm exactly `{email,pin}`,
both trimmed, and resend exactly `{email}`, trimmed. Backend casing/validation/
privacy/attempt and quota rules remain unchanged. DTO validation rejects malformed
successful responses instead of creating authentication. Confirmation never
supplies a JWT and calls neither login nor establishSession.

`useActivation.ts` owns local email/PIN/message and a shared pending request guard
for confirmation and resend. Loading/status/error behavior and field retention
match legacy; successful confirmation/resend clears PIN. Requests are abortable
on unmount, cannot overwrite a changed token's session, and are never replayed.
No client cooldown/countdown exists; only in-flight protection was added. Shared
API parsing displays backend 429/Retry-After, generic 400, validation and network
errors without adding account-existence conclusions.

`authRouteState.ts` limits handoff state to email, whitelisted fixed notices and
validated feature/workspace destination. Registration unverified response now
navigates directly to `/activate` with canonical email and the original sent-PIN
message. Login activation/verification 403 and Account Verify email use the same
route with their current email. Registration email-delivery 502 recovery links
also point there. No passwords/PINs/challenge/JWTs or arbitrary extra route fields
are copied. No URL parameters or additional storage keys are introduced.

Signed-out confirmation returns to `/login` with email and the fixed original
activation-success message; session remains unauthenticated until the user enters
a password and makes the existing Login request. The Login hook accepts only the
safe email prefill and still owns its previous token/session mechanism. It then
uses the existing Terms-first redirect; no duplicate auth/session logic is added.

Existing-token confirmation uses SessionController's forced reload for fresh
account, capabilities and Terms, preserving the token. A refresh failure leaves
the successful verification explicit, disables another PIN confirmation/resend
and offers Retry session. If the existing token is revoked during refresh, normal
session clearing returns the already-verified user to Login without replaying PIN.
Authenticated verified Activate visits redirect through
the existing LoginPage destination/Terms policy; no activation/login/Terms loops.
Unverified or verification-denied saved sessions can still access public activation.

### Phase 8 parity differences and deferred compatibility

- Activation is a routed card in AuthLayout, using the original dialog styling.
  The native modal/backdrop/focus trap is deferred. Close returns to Login instead
  of revealing an underlying still-mounted dialog host; signed-in verification
  uses its validated originating feature destination after refresh.
- Handoff email is in the Router history entry, not a URL/global auth/localStorage
  or sessionStorage stash. Direct access without state requires email entry. PIN
  is never restored after refresh. Fixed handoff notices ignore arbitrary messages.
- Confirmation/resend are serialized so a pending resend cannot invalidate a PIN
  being confirmed. Legacy only disabled each button separately. No timer added.
- Signed-out activation never logs in automatically, matching legacy. Session-load
  recovery applies only to a token already present at confirmation time.
- Generated emails currently use PINs. Old `verify_email_token` high-entropy links
  keep working at the unchanged reference URLs/handlers; React implements PIN
  mode and does not migrate their automatic link-consumption branch in this phase.
- Backend resend with email-delivery failure propagates a sanitized transport error
  and leaves the previous persisted PIN until a successful request commits. UI
  preserves fields and does not infer account existence from the failed request.
- Full screenshots/responsive keyboard review remains unverified: Browser discovery
  returned no browser. Simulated DOM interactions, exact API contracts, real quota/
  lockout/expiry behavior and legacy asset integrity were checked.
- Recovery/reset/password changes, billing/deletion and unrelated features remain
  deferred; backend and every legacy file remain read-only.

### Phase 8 recommendation (completed in Phase 9)

Migrate password recovery request and reset as a focused increment. Inspect its
anti-enumeration, reset-token deep links, expiry/single-use, confirmation matching
and post-reset Login behavior first. Keep password changes, billing and deletion
separate and preserve the reference frontend until full parity.

## Phase 9 implementation and recovery/reset contract

`features/auth/recovery/{ForgotPasswordPage,ForgotPasswordForm,ResetPasswordPage,
ResetPasswordForm,recoveryApi,usePasswordRecovery,usePasswordReset,types,resetLink}`
adds public `/forgot-password` and `/reset-password`. Login's recovery action is
an internal link carrying only safe email/destination. AuthLayout's recovery paper
mode preserves the original dialog heading/sections/copy/form IDs, input labels,
button wording, appearance/viewport and responsive CSS without redesign.

`recoveryApi.ts` uses public ApiClient POSTs: request exactly `{email:trimmed}`;
confirm exactly `{token,new_password}` with unmodified password and existing token
semantics. Response shape validation prevents malformed success from becoming a
fake session. Known/unknown/disabled request accounts display the same backend
detail; no availability probe/account inference is added. Shared errors and 429/
Retry-After are preserved; no new timer or replay exists for recovery requests.

`resetLink.ts` uses the real `reset_password_token` parameter, validates only the
backend's token length bounds and whitelists public api_base/view for navigation.
App directly renders reset outside AppShell when that parameter is present, and
keeps the same ResetPasswordPage mounted as the hook replaces the URL with clean
`/reset-password`. It never transports a token via Router state or a global store.
Only the mounted ref and necessary request body retain it. All rendered links
are sanitized immediately, before the URL cleanup effect runs. New links abort
older pending work, replace the local token and clear passwords; close/unmount
abort requests and cancel delayed navigation. No manual DOM/URL switching occurs.

Password minimum is shared through `utils/passwordValidation.ts` with registration.
Both flows preserve native minimum eight and backend-only maximum 128, no new
strength/pattern/character policy. The original confirmation mismatch is checked
before POST. Missing/malformed token gets an actionable recovery request; backend
400 invalid/expired/used/replaced errors retain local inputs like the reference.
Passwords are never trimmed, persisted outside the form or logged.

Successful reset displays actual detail, clears local passwords/token, disables
repeated confirmation, waits the original 1200 ms and replaces history with Login
and a whitelisted fixed notice. No auto-login, credential reuse, token issuance or
session reload/sign-out is introduced. The unchanged backend does not revoke user
JWTs during reset; existing sessions stay authoritative and Login uses its normal
authenticated/Terms destination policy. Account password change remains delegated.

### Phase 9 email-link compatibility and remaining gaps

- Inspected runtime PUBLIC_APP_URL is `http://127.0.0.1:5500`. Real backend email
  construction stays `PUBLIC_APP_URL/?reset_password_token=...`, no email/user ID.
  Those existing reference links remain valid. React accepts compatible root,
  HTML-alias or `/reset-password` links at its own origin without changing backend.
- A later authorized deployment/config update to PUBLIC_APP_URL (React origin,
  SPA fallback and approved API origin) makes newly sent links use React. No such
  root config or backend change was made during this phase.
- Immediate URL cleanup intentionally differs from legacy's persistent query.
  Tokens are not saved in browser storage/history state to support refresh;
  refreshing the clean page requires reopening the original email link. Closing,
  success and all unrelated navigation stay token-free. Only public api_base/view
  query parameters survive recovery routes; fragments/unknown params are dropped.
- Recovery/reset are routed paper cards, not native dialogs/backdrops. Input/copy/
  responsive CSS remains the source of truth; real screenshots/mobile comparison
  was unavailable because Browser discovery returned no browser.
- Existing JWTs remain valid after password reset in this backend. This observed
  behavior is documented, preserved and verified by the contract; no proactive
  logout/revocation policy was invented in frontend code.
- Existing post-commit registration email failure and old high-entropy activation
  links keep their previously documented behavior. Authenticated password change,
  billing, deletion and unrelated product features remain deferred/reference-only.

### Phase 9 recommendation (completed in Phase 10)

Migrate authenticated Account password change as a separate increment, inspecting
current-password/provider rules, exact endpoint and session behavior first. Keep
billing/deletion separate. Product features can then proceed incrementally with
Journal before Map/Reflection and Chat last; preserve all legacy code until parity.

## Phase 10 implementation and Account password contract

`features/account/password/{ChangePasswordForm,changePasswordApi,useChangePassword,
types}` replaces the reference Update password link in Account's Security section.
Original section/grid/mobile CSS, advisory copy, Current/New labels and button
remain. Current input visibility/requirement follows the real has_password flag.
The requested Confirm new password input sits in the existing full-width grid;
it is a deliberate addition because the legacy had no confirmation.

`changePasswordApi.ts` uses exact authenticated PATCH `/users/me/password` with
only `{current_password:currentValue || null,new_password:newValue}`. Raw password
values are not trimmed; confirmation is never sent. Response must be a valid full
Account DTO with password/provider flags, not a new auth/success-detail shape.
401/403/422/429/network errors preserve shared semantics and writes never replay.

`useChangePassword.ts` keeps password values/pending/status only in the keyed form.
It reuses the shared minimum helper, preserves legacy blank/whitespace rejection,
and enforces requested client-only matching. No new strength/max/reuse rule exists;
backend current maximum 128/new 8–128 remains authoritative, and identical current/
new is allowed. Success clears local fields, uses the canonical Account response
through existing SessionController.applyAccountResponse, and shows Password updated.
Provider/passwordless setting updates from response; metadata never includes secrets.

No new JWT/session store or lifecycle exists. Current and other JWTs remain valid,
there is no replacement token/logout/re-login, and normal success stays in Account
without unnecessary reads. Existing forced-refresh fallback covers a concurrent
session load; actual authenticated 401 still uses shared expiry/Login routing.
Account/Password Terms exemption is maintained without marking acceptance or
changing subscription capabilities. Old/wrong-account responses cannot replace
the current session, and unmount removes the password inputs.

`accountWriteGuard.ts` extracts the prior Profile pending guard and coordinates
Profile/password writes for the same client/token across forms and route reopen.
This guard stores only operation identity, never password values or auth state.
It prevents stale full DTO responses from rolling back newer shared Account data;
busy writes show the existing appropriate pending message instead of issuing
another request. Profile validation/dirty/save behavior and payload are unchanged.

### Phase 10 parity differences and deferred Account actions

- Legacy had two password inputs, no confirmation. The third client-only input
  is explicitly requested for this phase; layout/style stays the existing grid.
- Password status is contained within Security instead of legacy's shared Profile
  status element. Pending duplicate/overlapping write protection is added.
- Canonical response applies without resetting an unsaved Profile draft. Legacy's
  generic Account rerender reset those fields; React preserves its established
  Profile dirty-draft behavior while coordinating writes.
- Existing Account remains a routed card rather than a native dialog. Browser
  discovery returned no browser; no screenshot/mobile/focus comparison was possible.
- Backend allows password reuse and preserves current/other JWTs after change.
  These observed semantics are documented and contract-tested; no frontend-only
  restriction/revocation policy or backend fix was introduced.
- Billing/checkout/subscription management and deletion stay actual reference
  links with clear delegation text. No payment/deletion mutation is added.
- Product features and old high-entropy activation-link consumption remain deferred;
  reference frontend/backend are unchanged.

### Phase 10 recommendation (completed in Phase 11)

Migrate Journal as the first product feature, inspecting autosave, date/history,
loading/errors, access/Terms gates and API persistence before editing. Keep billing
and deletion as separate later scopes; then Map/Reflection and Chat last. Preserve
the legacy reference until full feature parity is explicitly approved.

## Phase 11 implementation and Journal persistence

`features/journal/` replaces `/journal` with the original controlled editor, status,
sidebar date/history and optional analysis/review. Shell keeps two main tabs plus
secondary Journal; Header adds Find map insights and SidebarContext delegates its
Journal controls. Original paper/suggestion/radio/limit/copy/responsive styling stays.
No Map/Reflection/Chat page, billing or deletion implementation was added.

Types/date helpers/API preserve full entry/history/suggestion DTOs: GET list limit180,
GET/PUT date with raw `{content}`, POST date/analyse without body, POST date/suggestion
id with exact accept/dismiss edits, and narrow GET users/me/map for topic choices.
Missing days are empty without persistence; explicit empty PUT is stored. Server
timestamps/counts/source staleness/review stay authoritative. Local save history
omits empty/no-suggestion rows until a fresh server list restores them, like legacy.
Malformed/wrong-date DTOs are errors, not invented successful editable entries.

Local-calendar/noon shifting/Intl/whitespace counts are ported. First visit selects
today at visit time, even across app-start midnight; later visits retain selection.
Next stops at today, while existing future history records are still selectable.
No title/rich text/extra date picker/URL format is added to the editor.

JournalProvider creates a feature-owned controller instance, not module-global/
auth state. Session-memory cache/drafts match legacy's hidden-workspace persistence
and survive React route/Terms/loading unmounts. Header/sidebar/editor subscribe;
owner changes clear private state. No editor contents are persisted in browser
storage. Capability fallback is extracted from the existing shell and reused.

Each input resets 900ms and compares baseline. Per-date queues serialize PUT/analysis/
review. Dirty/edit revisions skip identical/stale queued work, preserve newer edits
on completion/failure and correctly persist a revert while an older write is pending.
Only confirmed latest saves clear dirty. Retry follows further edits or date/analysis/
navigation flush, plus explicit Retry save. No automatic replay or blur-save; saving
does not disable the editor, while unloaded/loading/inaccessible dates do.

Selection identity/abort rejects older dates. Mutation revisions protect same-date
GET metadata; history versions merge saves made after index reads start. Topic
request/version checks reject stale options after a newer review map response.
Date/route changes drain latest dirty text before proceeding, and failure retains
Journal/text/error. Authorization 403 is the recovery exception: text/JWT remain,
the editor becomes read-only, and navigation to Account/activation is permitted.
Check session again and the existing verification recovery link use the shared
session/auth implementation. Main uses the same routes in the data-router host required for
useBlocker. Feature lifecycle remains subscribed after workspace/Terms transitions;
Router unload and [document visibility hooks](https://github.com/react-hookz/web/blob/master/src/useDocumentVisibility/index.ts)
delegate browser subscriptions, without manual editor/navigation DOM binding.
The locked `@react-hookz/web` dependency supports current React; no cookie/auth
functionality is used. Keepalive retains dirty on failure and adds unload protection
instead of the legacy optimistic clean flag.

Journal-owned insights retain flush/loading labels and controlled topic/text/type/
category/target inputs, accepted/dismissed/readonly states and real persisted map
effects. Only Journal options consume returned map; graph/active-node rendering,
Reflection and Chat stay placeholders. View Premium opens actual reference Account.

### Phase 11 safety differences and remaining limits

- Overlapping PUTs, stale date loads, date-switch loss of newly typed text and
  optimistic keepalive clean flags are corrected under explicit phase requirements.
  Timing, payloads, date semantics, copy and styling stay original.
- In-app navigation now waits for save instead of fire-and-forget. Failure stays
  in Journal, except authorization recovery can navigate while retaining its draft.
  Retry save/unload protection are deliberate recoverability additions;
  no blur-save/replay policy is introduced.
- Feature/session memory survives same-owner gates/failures. Logout/expiry clears
  private drafts like legacy. Forced closure, offline and browser keepalive body
  limits can still prevent delivery; no storage protocol was invented.
- No backend version/ETag conflict policy exists. This migration serializes a
  single client's operations; concurrent tabs/clients retain last-writer-wins.
- Stored empty rows/future dates keep their unusual backend/legacy behavior.
- Journal map writes/options are real; graph selection/rendering is deferred. The
  checkout shortcut delegates to reference Account, without payment mutation.
- Browser discovery found no browser. Real screenshots/mobile/keyboard lifecycle
  parity remain unverified; DOM, timers/races, backend and assets were checked.

### Recommendation for Phase 12 (completed)

Migrate Map next: inspect topic/entry hierarchy, graph selection, dialogs, access
and unsaved mutations first, reusing verified Journal-link/topic contracts. Keep
Reflection and Chat separate, Chat last; keep billing/deletion/legacy removal out.

## Phase 12 implementation and Map contracts

Implementation follows the Phase 12A inspection above. New files:
`features/map/MapPage.tsx`, `MapCanvas.tsx`, `MapDetails.tsx`, `MapSidebar.tsx`,
`MapForms.tsx`, `MapDialogs.tsx`, `MapContext.tsx`, `MapController.ts`, `mapLayout.ts`,
`mapApi.ts`; shared `types/map.ts` and `services/mapResource.ts`.
`App.tsx` adds MapProvider/real Map route; AppShell/SidebarContext/Header delegate
Map controls. Original CSS is still imported, with small link-equivalent rules
for the deferred Chat/Reflection destinations. No visualization package was added.

Journal types/category helpers now re-export the shared DTO definitions. Its
review API uses the same Map write coordinator without changing payload/response
or existing Journal autosave. JournalPage accepts a validated date in Router state
from Map, so connected-date failures are visible in the real Journal route.
ApiClient adds only a read accessor for queued request ownership; auth behavior
and request handling remain unchanged. Existing capability extraction now includes
hasMapAccess reused by Map and shell. Historical shell tests explicitly inject the
Map placeholder; production never does.

MapContext owns one Map DTO and local UI state. Controlled forms remain mounted
outside the routed Terms gate while still on Map, hiding/inerting on same-owner
session/Terms gating so transient refresh does not lose draft fields. Route leave
closes forms/temporary connection choices; logout clears private state. Rendering
is declarative; refs support focus only, with no querySelector, innerHTML, manual
event listeners or fragment loading in the Map feature. Dialogs/confirmations use
original markup/classes, pending protection, Cancel/Escape/backdrop, focus return,
Tab boundaries and inert background. Native browser focus parity is unverified.

Reads use request/abort identity and write revisions; sidebar/details derive from
the same DTO with no per-node detail read. Graph layout/edges are memoized from
data/filter/breakpoint, not randomized/recreated graph instances. Map writes wait
for full backend responses, validate identifiers/DTO consistency and preserve newer
selection. Per-entity duplicate protection and per-client write serialization
coordinate entire-profile mutations with Journal review. Queued writes capture
their JWT owner and cannot send old data as a new account. Invalidation rejects
stale GETs; Map's own full responses avoid redundant refetch, while external review
refreshes visible Map or waits until its next visit. Failed writes are not replayed;
unrelated graph data is retained, with explicit errors/retry. Uncertain failed
writes can reread authoritative backend state without claiming mutation success.

Backend behavior remains exact: same-name creation can reuse a topic; parent
self/cycles and related self/missing links are rejected; symmetric backlinks and
deduplication come from backend. Deletes preserve entries in Overall/reparent
children, merge keeps target/references/source evidence, entry movement retains
Journal metadata. No independent edge CRUD, persisted positions, drag or viewport
API exists. All endpoint/payload details are in README's My Map table.

New `test/mapBackend.ts`, `mapController.test.ts`, `map.test.tsx` cover renderer,
forms, races and integration. `scripts/isolated-registration-server.py --map`
provides a disposable premium-gated fixture on 18014, and
`scripts/validate-map-contract.mjs` runs real unchanged Map/Journal routes. Earlier
fixture modes are unchanged. Validation results are in VALIDATION.md.

Remaining differences are deliberate scope boundaries: Reflection completion
routes with practice ID but makes no completed-status write; Chat routes with chat
ID but lacks conversation titles/content; manual creation has null active-chat
source until Chat migration. Premium delegates reference Account. Confirmations
use controlled React dialogs rather than native imperative dialogs. Same-route
gating retains form drafts, but actually navigating to Terms/another page closes
them like other explicit Map navigation. Browser screenshots/mobile/native history
and focus remain unverified; cross-tab/other-client profile races are still
last-writer-wins without a backend conflict/version protocol. Original files remain.

Recommendation for Phase 13: migrate Reflection's practice completion dialog,
including optional reflection text, exact `{status:"completed",reflection}` update,
pending/error/return behavior and real Map invalidation. Then migrate Chat, keeping
billing/deletion and legacy removal as separate scopes.

## Phase 13 implementation and Reflection completion

New `features/reflection/` contains ReflectionPage, ReflectionForm, ReflectionContext,
ReflectionController, reflectionApi and types/source helpers. The feature stores
only the current source ID, raw answer and UI/request state. Practice data derives
from the existing Map DTO, with no second model/store or SessionContext answers.
The API adapter delegates to MapController.practice; mapApi.updatePractice accepts
optional reflection (default null unchanged for existing pause/resume/reactivate).
Practice mutation responses validate requested status, nullable text and consistency
with the full Map before recognizing success. No backend/legacy changes occurred.

App adds real `/reflection` and its provider. Map Complete links keep Phase 12's
practiceId state, now opening the original app-dialog modal over real Map. AppShell
renders the Map heading/background/title; Map lifecycle resumes after Reflection
without resetting selected details. DialogFrame adds optional class/ID/backdrop/
focus-ready configuration with existing defaults preserved. Only refs handle focus;
there are no querySelector/innerHTML/manual listener/HTML-loading bindings in Reflection.
Original copy, textarea rows, optional/no client max, trim/null and button labels
stay unchanged. No standalone entity, history editor, steps, ratings or new prompts.

Source loading uses only the existing full Map GET; direct invalid/missing state
explains selecting a practice, missing/wrong-kind sources cannot submit, completed
sources show read-only saved reflection. Atomic PATCH saves status completed and
reflection together. Full canonical Map applies first, then form closes to fixed
Map with selected details intact. No success is fabricated and no follow-up read is
required for completion. Journal-generated practices retain their source dates;
completion does not alter Journal entry/analysis/history. Chat is not migrated.

Feature/controller source, submit, edit and owner identities protect stale responses,
source changes, navigation and new accounts. Old form data cannot be sent between
token change and provider effects. Private modal content is masked synchronously
on owner/auth change. Shared Map per-entity guard and profile write queue protect
doubles/overlap with other Map/Journal operations. Mutation failure retains raw
answers and never replays PATCH; explicit retry addresses the same entry. A
confirmed response remains saved even when a later GET fails. Newer typing during
an older success keeps the form open for explicit same-field resubmission, with
completion/unsaved wording tied to server status. Recoverable errors appear in
the modal, improving the legacy behind-modal error placement.

Same-owner session/Terms remounts retain answer memory. SessionNotice/TermsPage and
authenticated activation-return helpers carry only validated practice ID/resume
metadata, never answers; authentication requests/JWT/permission policies are
unchanged. Explicit close/new opening resets the buffer; Close/Escape remain allowed
during pending completion like legacy, with late persistence but no stale redirect.
No new unsaved prompt, autosave or offline storage exists. Native modal/history/
focus/touch differences are documented in README, with visual parity unverified
because browser discovery returned no browser. Cross-client last-writer-wins remains.

`reflectionController.test.ts` and `reflection.test.tsx` add source, UI, atomic
completion, normalized DTO, errors, races, gates and real Terms/activation return
coverage. Historical shell fixtures explicitly inject Reflection placeholder only
for old architecture tests. `vitest.config.ts` limits concurrent workers to four;
unrestricted cold DOM startup caused 5-second timeouts, while bounded concurrency
passes without raising timeouts or removing checks. The disposable fixture gains
`--reflection` (18015) and `validate-reflection-contract.mjs`, preserving earlier
modes. Validation includes existing backend/legacy tests and original asset bytes.

Recommendation for Phase 14: migrate Chat last. Inspect complete `views/chat.html`,
`js/chat.js`, streaming/polling/input/suggestion helpers and LLM routes before
editing. Reuse the established session/capability/Terms/API/Map/Journal contracts;
verify stream cancellation/retries/topic review and source handoffs separately.
Keep billing, deletion and legacy removal out of that migration scope.

## Per-feature comparison checklist

For each future migrated feature, compare the same account, data and theme in
the reference site and React. Check desktop/mobile layout, spacing, typography,
keyboard/focus behavior, navigation and browser history, payloads and headers,
loading/empty/error states, expired/revoked sessions, terms requirements,
Premium locks, and transient failures. Verify dialogs as dialogs rather than
silently changing them to pages. Document deliberate gaps before claiming parity.
