# Edit and publish FeelY's AGB

## Active test version

At the operator's request, `test-2026-10-05-v2` contains unfinished test terms.
Its immutable snapshot is `website/legal/agb/test-2026-10-05-v2.html`.
New email/password accounts must explicitly accept it at registration; existing
accounts use the acceptance screen before app use. The signup screen
labels this as unfinished test text. This applies to everyone using this deployment,
not only accounts with the `test` role. Acceptance tests the workflow, not legal adequacy.

Continue editing `website/legal/agb-draft.html`, not the published snapshot.
Publish finished terms under a new version without `--allow-draft`; all users will
need to accept that version separately. For another explicitly intended draft test,
`scripts/publish_terms.py --version test-YYYY-MM-DD-v2 --allow-draft` is available.

## Working document

Edit **`website/legal/agb-draft.html`**. Open it in a browser to preview it, or visit
`http://localhost:5500/legal/agb-draft.html` with the website server running.
This German pseudo text contains FeelY (company in formation), Meller StraÃŸe 31,
and explicit placeholders. It is not finished legal text. Complete the legal
operator name, postal code, city, country, intended age group, subscription rules,
privacy link and other marked sections before publication. Arrange appropriate
legal review for the actual service and jurisdiction.

The user-facing `/agb.html` page links to the published version. Before publication,
it says the terms are being prepared. Only an explicitly published test snapshot is offered for draft acceptance.

## Publish a finished version

After replacing the pseudo text and removing the draft warning:

```powershell
.\.venv\Scripts\python.exe scripts/publish_terms.py --version 2026-10-04-v1
```

This copies the exact HTML bytes to `website/legal/agb/2026-10-04-v1.html`, computes
their SHA-256 hash, and updates only the three `TERMS_*` settings in `.env`.
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
Run `python scripts/build_frontend.py` after changing frontend JS or views.

AGB acceptance is separate from privacy and marketing consent. For German consumer
contracts, review the notice, access and agreement requirements in
[BGB Â§305](https://www.gesetze-im-internet.de/bgb/__305.html) with legal counsel.
