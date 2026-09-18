# Editing FeelY

The site still uses plain HTML, CSS, and JavaScript. No npm install or JavaScript
framework is needed. Chat and Map are the main tabs; Journal is a secondary link
near the bottom of the sidebar.

## Where to make changes

| Area | HTML | JavaScript |
| --- | --- | --- |
| Login and registration | `views/auth.html` | `js/auth.js` |
| Conversations and topic suggestions | `views/chat.html` | `js/chat.js` |
| Map | `views/map.html` | `js/map.js` |
| Journal | `views/journal.html` | `js/journal.js` |
| Account and billing | `views/account.html` | `js/account.js` |
| Sidebar and workspace switching | `views/sidebar.html` | `js/navigation.js` |
| Admin page and account roles | `admin.html` | `admin.js` |

Smaller dialogs each have their own HTML file in `views/`.
`shell.html` is the small editable outer shell. Each `<template data-view="views/...html">`
marks where that view is loaded into the page.
Map bubbles, forms, and debug previews are created in `js/map.js`; edit their
labels there rather than looking for them in the static HTML.

`styles.css` holds the shared cozy appearance and feature styles. `admin.css`
holds admin styling. Existing element IDs connect HTML to JavaScript; keep them
unless you update their references too.

## Apply an edit

1. Edit the matching file in `website/views/`, its JavaScript file, or the stylesheet.
2. With the FeelY website server (`app.website:app`), simply refresh: it assembles
   the complete page from your source files on every request.
3. For a basic static server or VS Code Live Server, rebuild the ready-to-serve
   `index.html` after editing:

   ```powershell
   .venv\Scripts\python.exe scripts/build_frontend.py
   ```

The launcher and the website startup block in `STARTUP.md` run this build
before starting. The assembled `index.html` stays on disk and works immediately
after restarting any static server. Commit it together with source changes.

Edit `views/chat.html`, `views/map.html`, and `views/journal.html` for their layouts.
Edit `shell.html` for the shared layout and script order. Do not edit the generated
`index.html` directly. The website opens at `/`; the FeelY server redirects old
`/chat.html` links there, preserving URL parameters.

## How the page loads

`app/frontend.py` assembles the separate views, stylesheet, and application
scripts into **one HTML response**. The browser does not download individual
views, CSS, or application scripts during startup. A 502 for a dialog or Journal
file can no longer block the page. The landscape and fonts are optional visual
assets; the page layout and login form are already present in the main response.

The dynamic FeelY server assembles the response live. Static servers serve the
preassembled `index.html`. Both use the same assembly function and script order.
The old runtime view loader is no longer part of the page; its legacy URL only
redirects old cached shells to the complete page.

`app.js` holds shared state, DOM references, theme handling, and HTTP helpers.
`js/start.js` connects the event handlers and starts the app. Keep `app.js` first
and `js/start.js` last in the script list in `shell.html`. The source files stay
separate; only the browser response combines them.

When adding a directly served asset, add its exact path to `PUBLIC_FILES` in
`app/website.py`. Backend requests remain normal authenticated API requests.
A backend or internet outage does not erase a valid saved session.

## Account roles

Sign into `admin.html` with the configured administrator credentials or an account
whose role is Admin. Create an account, or select an existing account and change
its **Account role**:

- **Member:** normal account; no map debug tool.
- **Test:** map debug tool; no access to administration.
- **Admin:** map debug tool and administration access.

Map access still requires Premium. Roles do not create subscriptions or bypass
billing. Role changes take effect on the next API request; refresh the user's
page to update the visible controls. Demotion or disabling an account revokes
its existing admin token. The configured administrator login remains available.

Restart the backend after installing these changes: existing SQLite databases
receive the role column automatically, with existing users defaulting to Member.

## Checks

```powershell
.venv\Scripts\python.exe scripts/build_frontend.py --check
.venv\Scripts\python.exe -m pytest
node --test tests/map_node_render.test.cjs
node --test tests/frontend_startup.test.cjs tests/session_expiry.test.cjs
```

The login landscape is `assets/feely-lake.png`; its generation prompt is recorded
in `assets/feely-lake.md`. The existing dark overlay keeps the white text readable.


### Chat and background map analysis

- `prompts/chat_system.txt`: conversation only. The chat still receives a small read-only selection of confirmed observations from topics linked to the chat.
- `prompts/topic_system.txt`: background topic and observation proposals. An observation can be suggested without creating a new topic. All map changes still require review.
- `app/services/llm.py`: model contracts and bounded context; `app/api/routes/llm.py`: scheduling, access checks, suggestion storage and confirmation.
- `website/js/chat.js`: polls for both kinds of suggestion after a reply and displays the Review buttons.

`OLLAMA_TOPIC_MAX_TOKENS` now defaults to 768 to fit topics plus an observation. Restart the backend after changing environment settings. This split reduces the chat output contract; actual response latency depends on the models and hardware.
