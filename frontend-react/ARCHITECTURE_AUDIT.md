# Phase 15 architecture audit

Baseline inspected before refactoring on 2026-10-12: all source/config/test module
boundaries and imports, controllers, feature API/DTO modules, form lifecycles,
routing/gates, CSS, dependency build metadata and remaining reference links.
532 tests passed before this phase. A separate pre-phase file/hash snapshot was
saved for integrity and before/after comparisons.

## Size and dependency findings

| Largest source    | Lines | Largest tests       | Lines |
| ----------------- | ----: | ------------------- | ----: |
| ChatController    |   709 | chatController.test |   782 |
| ChatReviews       |   478 | map.test            |   665 |
| JournalController |   443 | chat.test           |   592 |
| MapForms          |   392 | registration.test   |   552 |
| MapController     |   365 | activation.test     |   536 |
| MapDetails        |   350 | mapController.test  |   525 |
| sessionController |   239 | reflection.test     |   507 |

The built entry is **504.36 kB**, **146.83 kB gzip**; CSS is **81.72 kB**.
Build metadata attributes approximately 537 kB before minification to React DOM,
214 kB to React Router, 17 kB to React, 9 kB to scheduler, 4 kB to hookz and 339 kB
to application modules. These are pre-minification attribution sizes, not chunk
download sizes: libraries represent about 70% of that total. Largest application
contributors are ChatController/reviews, Map forms/details and JournalController.
The entry currently imports every feature page and provider-owned dialog eagerly.

## HIGH VALUE

- **Provider/view cycles:** MapContext -> MapForms -> MapContext; ChatContext ->
  ChatReviews -> ChatContext; ReflectionContext -> ReflectionForm -> ReflectionContext.
  Keep persistent providers state-only and compose dialog renderers separately.
- **Independent UI responsibilities:** topic/note/delete reviews and Map topic/entry
  forms live in aggregate files. Split substantive forms, preserving state keys,
  focus/Terms lifetime and feature-local ownership. Map entry preview is independent
  of topic details. Keep cohesive controllers rather than distributing their
  request identities among many helper classes.
- **Shared dialog boundary:** MapDialogs supplies Map, Chat and Reflection, with no
  Map dependencies. Move it to `components/shared`, retaining one implementation.
- **Migration residue:** App's placeholder route loop selects zero routes but
  imports production placeholder code. Historical shell tests still need the
  fixture: move it to test fixtures and retain all test cases. Reference-auth
  helpers have no importers and can be removed; billing/deletion helpers are live.
- **Transport boundary:** NDJSON reader/UTF-8 buffering/cleanup is independent of
  JSON HTTP and session handling. Extract a small stream reader; keep event/domain
  validation in Chat and authentication/error semantics in ApiClient.
- **Accessibility:** forms have labels but errors often lack `aria-describedby`;
  Reflection focus changes between heading/input can escape a registered-controls
  trap. Validate keyboard boundaries and association of real error messages.
- **Meaningful rendering cost:** every ChatMessage subscribes to the full Chat
  context, so saved history rerenders on each phrase and draft edit. Isolate saved
  history behind a memoized presentation boundary with explicit reaction props.
- **Bundle loading:** lazy route pages and conditional dialogs can defer unused UI.
  Keep controllers/providers mounted so Chat generation, Journal drafts and Terms
  restoration retain their existing lifetime. Preserve eager reset-token handling.

## MEDIUM VALUE

- Rename migration-oriented return-helper names to reflect safe workspace routing.
  Route/source IDs and API meanings should stay explicit, not a generic framework.
- Chat's `chat_info` type is broader than its validated DTO and forces double
  assertions. Use the existing conversation shape with an optional embedded ID.
  CAPTCHA SDK types should belong to its feature types rather than its component.
- Review immediate owner projections in Map/Journal providers, matching Chat and
  Reflection; private data must not be exposed between session changes and effects.
- Large tests already separate controller/API and routed UI behavior. Group the
  largest files by behavior where practical; avoid hiding important setup in layers.
  Repeated session setup is mostly feature-specific and inexpensive to read.
- Document explicit dependencies: Journal/Chat review -> Map write queue;
  Reflection -> Map practice mutation; Map -> Chat IDs/Journal dates. Document
  feature extension and mobile platform limits instead of inventing future APIs.
- Local CSS has no repeated identical selector blocks. Some comments still say
  features are deferred. Preserve cascade-sensitive rules and imported legacy CSS.

## LOW VALUE / NOT WORTH CHANGING

- Repeated `current(owner)`, request counters and pending guards encode different
  lifetimes. A generic concurrency/form framework would hide important semantics.
- Journal baseline/inflight/local text, Map commit revision and Chat tombstones are
  deliberate concurrency state, not unnecessary mirrored domain stores.
- Session owns account/capabilities/Terms; persistent feature providers own feature
  state. WeakMap write coordinators own no copied domain data and are appropriately
  scoped per API client. Turnstile's single shared script-load promise is necessary.
- Map domain/layout/mutations are already separated, deterministic, with no drag,
  zoom or pan. Do not replace them with graph abstractions or add blanket memo hooks.
- Historical shell session/route overrides are useful test seams. Keep them test-only;
  do not remove tests merely to shrink files. No broad `any` or unsafe HTML renderer
  was found. Compatibility for legacy root/query/email links remains necessary.

## Constraints and verification limits

Legacy CSS/lake/favicon, reference billing/account deletion, reference fallback
links, Vite reference proxy and old email-origin deployment still depend on the
reference stack. Inventory their destinations and migration blockers before any
removal. Native browser discovery returned no available browser; desktop 1440,
tablet 768 and mobile 390 screenshots/focus/touch comparisons cannot be claimed.
Capacitor is not being installed. Tests, builds, source checks and asset-byte checks
can establish contracts/integrity, but not native visual or Android parity.
