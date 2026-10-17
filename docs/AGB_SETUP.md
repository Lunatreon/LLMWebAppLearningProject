# Edit and publish FeelY's AGB

## Updated working draft (17 October 2026)

The working document now uses the operator's complete German template with
Selina Juliana Bernard, Meller Straße 31, 49082 Osnabrück, Germany, and
feely@selinabernard.com. FeelY primarily offers AI chat using OpenAI for individuals
and businesses in Europe. Accounts are required and can be deleted; subscriptions
can be cancelled. The proposed minimum age is 12. Guardian consent and age-related
product workflows remain undecided. The supplied English text ends in section 18;
the working document currently contains the complete German text only.

Still needed: effective date, legal form/additional provider details if applicable,
launch features/limits, minor/guardian workflows, contract confirmation, pricing/VAT,
subscription terms/cancellation procedure, withdrawal instructions, privacy URL,
chat retention, training/opt-in/opt-out policy, other providers, optional use/B2B
clauses, B2B venue and dispute resolution details. Bracketed fields remain visible.
This draft has not been published as a new mandatory acceptance version.

Both the legacy AGB page and React `/terms` link to the same draft preview.
Locally React uses `/reference/`; keep the legacy website server on port 5500.
Production serves `/legal/` from the reference copy for versioned document URLs.

## Active test version

At the operator's request, `test-2026-10-05-v2` contains unfinished test terms.
Its immutable snapshot is `website/legal/agb/test-2026-10-05-v2.html`.
New email/password accounts must explicitly accept it at registration; existing
accounts use the acceptance screen before app use. The signup screen
labels this as unfinished test text. This applies to everyone using this deployment,
not only accounts with the `test` role. Acceptance tests the workflow, not legal adequacy.

Continue editing `website/legal/agb-draft.txt`, not the published snapshot.
Publish finished terms under a new version without `--allow-draft`; all users will
need to accept that version separately. For another explicitly intended draft test,
`scripts/publish_terms.py --version test-YYYY-MM-DD-v2 --allow-draft` is available.

## Working document

Edit **`website/legal/agb-draft.txt`** in any text editor and save it as UTF-8.
The draft viewer loads this file directly on every page load, preserving line
breaks and displaying all text literally. No HTML editing or conversion is needed.
Refresh the draft preview linked from either website to see saved changes:
`http://localhost:5500/legal/agb-draft.html` (legacy) or
`http://localhost:5173/reference/legal/agb-draft.html` (React development).
Both local servers must be running for the React reference bridge.
Use the download link in the viewer to save the current text; if loading fails,
the viewer shows an error and the direct text link remains available.

Local edits update the local preview. Hosted sites need the updated text file
deployed to their server; the production Docker image includes a copy, so rebuild
and redeploy it to update that copy. No backend restart is needed for text edits
once the legal file routes are installed.
The German working draft contains the confirmed operator details and visible
placeholders for the remaining decisions listed above.

The user-facing `/agb.html` page links to the published version. Before publication,
it says the terms are being prepared. Only an explicitly published test snapshot is offered for draft acceptance.

## Publish a finished version

After completing all open fields and removing the draft warning:

```powershell
.\.venv\Scripts\python.exe scripts/publish_terms.py --version 2026-10-04-v1
```

By default this reads `website/legal/agb-draft.txt` and freezes the escaped text
into standalone HTML at `website/legal/agb/2026-10-04-v1.html`. It computes the
snapshot's SHA-256 hash and updates only the three `TERMS_*` settings in `.env`.
Published snapshots never load the editable text file, so later edits cannot
silently change the version a user accepted. Explicit HTML inputs remain supported;
the live viewer itself cannot be published.
It refuses to overwrite a version or publish a document still carrying the draft
markers. It does not assess legal completeness. Serve the published file and
verify its public URL before restarting the backend. Use `--public-url` for
another HTTPS website origin and `--document` for another finished HTML file.

**On backend restart, configured terms are mandatory.** Until a document is
configured, acceptance remains inactive. For the explicitly authorized test deployment, use a test- snapshot as described above.

All sign-in methods and restored sessions check acceptance. Users receive an
unchecked checkbox and a link to read/save the exact version. Without acceptance,
the backend returns HTTP 423 for authenticated app features, including native/API
clients. Terms review, sign-out, account management/deletion and the billing portal
remain available. Email/password registration also requires an unchecked checkbox
before account creation when terms are published. The API requires `terms_accepted: true`,
`terms_version`, and `terms_document_sha256` and records acceptance in the same
transaction as the account. Until publication, signup remains available and the draft
checkbox is disabled; no draft acceptance is recorded. This is not a full legal checkout flow.

Acceptance records include account ID, version, document URL, document hash,
timestamp and client. Existing accounts are not automatically marked as accepted.
Keep published files unchanged. For a revision, edit the working file and publish
under a **new version**; users will be prompted again. Do not change a published
document in place. The backend trusts the configured document hash and does not
download the static document to verify it.

Relevant code: `app/services/terms.py`, `app/api/routes/terms.py`,
`app/api/dependencies.py`, `website/js/terms.js`, and `website/agb.html`.
Refresh the website after changing frontend JS or views; no HTML build is needed.

AGB acceptance is separate from privacy and marketing consent. For German consumer
contracts, review the notice, access and agreement requirements in
[BGB Â§305](https://www.gesetze-im-internet.de/bgb/__305.html) with legal counsel.
