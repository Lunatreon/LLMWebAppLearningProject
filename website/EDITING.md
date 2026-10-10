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
`index.html` is the editable entry page and shared layout. It references each view:

```html
<template data-view="views/chat.html"></template>
```

The browser replaces that placeholder with the view's markup. The view is never
copied into `index.html` on disk. There is no duplicate shell or generated page.
Map bubbles and forms are created in `js/map.js`.

`styles.css` holds shared and feature styling; `admin.css` holds admin styling.
Keep styling in CSS and behavior in JS. View files contain only HTML: no scripts,
style blocks, inline event handlers, or nested view placeholders. Keep element IDs
in sync with the JavaScript that uses them.

## Apply an edit

Edit `index.html` for the shared layout, `views/` for feature markup, `styles.css`
for styling, and the matching JS file for behavior. Refresh the browser after any
edit. There is no build step and no generated HTML to commit.

Serve the entire `website/` directory over HTTP using the FeelY website server,
VS Code Live Server, or another static server. The website opens at `/`; the
FeelY server redirects old `/chat.html` links there while preserving URL parameters.

## How the page loads

1. `index.html` loads `styles.css` and the deferred `js/load-views.js` bootstrap.
2. The loader fetches the referenced `views/*.html` files in parallel.
3. After all views succeed, it inserts their markup and loads application scripts
   in the `APP_SCRIPTS` order defined in `js/load-views.js`.
4. `app.js` binds shared state and DOM references; feature scripts define behavior;
   `js/start.js` registers event handlers and starts the app.

The app stays hidden behind a loading message until its views and scripts have
loaded. A failed view or script download shows a retry button that reloads the
page, rather than starting a partially loaded app. Requests have a 15-second
loading timeout. Temporary view network failures and HTTP 408/502/503/504 responses
are retried up to three attempts with a short delay. Failed script downloads are
also retried; script timeouts are not retried because execution may already have
started. Missing or invalid views fail immediately. CSS, JS, and HTML remain
separate network resources.

Keep `app.js` first and `js/start.js` last in `APP_SCRIPTS`. These are classic
scripts that currently share state and functions. Do not convert individual
files to modules without introducing their explicit imports and exports.

## Future Node.js migration

A Node.js static server or development tool can serve the same `website/`
directory without any Python HTML processing. Asset and view references are
relative URLs; backend requests still use the configured API URL.

For a later JavaScript module migration, export shared state and HTTP helpers
from `app.js`, import them into each feature, and use one module entry point after
view loading. No npm dependency or backend migration is required for this layout.

## Serving assets

When adding a view or asset, add its exact path to `PUBLIC_FILES` in
`app/website.py`. Keep `.env`, databases, and backend source outside the static
root. A backend or internet outage does not erase a valid saved session.

## Account roles

Sign into `admin.html` with the configured administrator credentials or an account
whose role is Admin. Create an account, or select an existing account and change
its **Account role**:

- **Member:** normal account.
- **Test:** test account; no access to administration.
- **Admin:** administration access.

Map access still requires Premium. Roles do not create subscriptions or bypass
billing. Role changes take effect on the next API request; refresh the user's
page to update the visible controls. Demotion or disabling an account revokes
its existing admin token. The configured administrator login remains available.

Restart the backend after installing these changes: existing SQLite databases
receive the role column automatically, with existing users defaulting to Member.

## Checks

```powershell
.venv\Scripts\python.exe -m pytest
node --test tests/map_node_render.test.cjs
node --test tests/frontend_startup.test.cjs tests/session_expiry.test.cjs
```

The login landscape is `assets/feely-lake.png`; its generation prompt is recorded
in `assets/feely-lake.md`. The existing dark overlay keeps the white text readable.


### Chat and background map analysis

- `prompts/chat_system.txt`: conversation only. The chat still receives a small read-only selection of confirmed observations from topics linked to the chat.
- `prompts/topic_system.txt`: background topic and observation proposals. An observation can be suggested without creating a new topic. All map changes still require review.
- `app/services/llm/types.py`: model contracts; `app/services/llm/context.py`: bounded context; `app/services/conversation_summary.py`: extractive chat memory.
- `app/api/routes/llm.py`: scheduling, access checks, suggestion storage and confirmation. Suggestion cooldown rules live in `app/services/map_suggestions.py`.
- `website/js/chat.js`: polls for both kinds of suggestion after a reply and displays the Review buttons.

`OLLAMA_TOPIC_MAX_TOKENS` now defaults to 768 to fit topics plus an observation. Restart the backend after changing environment settings. This split reduces the chat output contract; actual response latency depends on the models and hardware.
