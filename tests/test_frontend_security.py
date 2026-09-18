from frontend_helpers import assembled_chat_html, application_scripts
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
CHAT_HTML = ROOT_DIR / "website" / "index.html"
def read_frontend_javascript():
    html = assembled_chat_html()
    sources = application_scripts(html)
    return "\n".join((ROOT_DIR / "website" / name).read_text(encoding="utf-8") for name in sources)


def test_website_root_is_the_shell():
    index_html = (ROOT_DIR / "website" / "index.html").read_text(encoding="utf-8")
    assert 'id="conversation-view"' in index_html
    assert 'data-view=' not in index_html
    assert 'window.location.replace' not in index_html


def test_feely_favicon_is_used_by_every_browser_tab():
    favicon = ROOT_DIR / "website" / "assets" / "feely-favicon.png"
    favicon_reference = (
        'rel="icon" type="image/png" sizes="64x64" '
        'href="assets/feely-favicon.png?v=20260902-2"'
    )

    assert favicon.is_file()
    assert favicon.stat().st_size > 0
    assert favicon.read_bytes()[25] == 6  # PNG RGBA color type, including transparency.
    for page_name in ("index.html", "admin.html"):
        page = (ROOT_DIR / "website" / page_name).read_text(encoding="utf-8")
        assert favicon_reference in page


def test_auth_form_cannot_fall_back_to_credentials_in_query_string():
    html = assembled_chat_html()

    assert '<form id="auth-form" class="auth-form" method="post">' in html
    assert 'name="email"' not in html
    assert 'name="username"' not in html
    assert 'name="password"' not in html
    assert '<meta name="referrer" content="no-referrer" />' in html


def test_sensitive_auth_query_parameters_are_scrubbed_on_load():
    javascript = read_frontend_javascript()

    assert "scrubSensitiveAuthParams();" in javascript
    for name in ("email", "email_or_username", "username", "password", "current_password"):
        assert f'"{name}"' in javascript


def test_stripe_portal_returns_to_account_and_supports_resuming():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()

    assert 'id="resume-subscription-button"' in html
    assert 'returnUrl.searchParams.set("view", "account")' in javascript
    assert 'returnUrl.searchParams.set("billing_return", "portal")' in javascript
    assert 'api("/billing/subscription/resume"' in javascript
    assert "await handleAccountReturn(requestedView);" in javascript


def test_temporary_api_failures_do_not_clear_the_saved_session():
    javascript = read_frontend_javascript()

    assert "[401, 403].includes(error.status)" in javascript


def test_new_chat_is_only_listed_after_its_first_saved_message():
    javascript = read_frontend_javascript()

    assert "function startNewChat()" in javascript
    assert "state.activeChatId = null;" in javascript
    assert "async function showChat({ startFreshChat = false } = {})" in javascript
    assert javascript.count("await showChat({ startFreshChat: true });") == 3
    assert 'data-app-source="app.js"' in assembled_chat_html()
    assert "await createChat();" not in javascript
    assert "chat_id: state.activeChatId" in javascript
    assert "upsertChat(updatedChat);" in javascript


def test_admin_page_is_server_authorized_and_prompts_use_admin_api():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()
    admin_html = (CHAT_HTML.parent / "admin.html").read_text(encoding="utf-8")
    admin_javascript = (CHAT_HTML.parent / "admin.js").read_text(encoding="utf-8")

    assert 'id="admin-button"' not in html
    assert 'api("/admin/status"' not in javascript
    assert 'api("/admin/status"' in admin_javascript
    assert 'api("/admin/login"' in admin_javascript
    assert "feely_admin_token" in admin_javascript
    assert "feely_token" not in admin_javascript
    assert 'id="admin-login-form"' in admin_html
    assert '"/admin/prompts"' in admin_javascript
    assert "System prompts" in admin_html
    assert "REMOVE_SUBSCRIPTION" in admin_javascript
    assert "showChat().catch(() => logout())" not in javascript


def test_my_map_is_visible_but_guarded_by_the_premium_entitlement():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()

    assert 'id="map-workspace-button"' in html
    assert 'id="map-plan-badge"' in html
    assert 'id="chat-plan-note"' in html
    assert "function hasMyMapAccess()" in javascript
    assert "function renderMapPaywall()" in javascript
    assert 'if (!hasMyMapAccess()) {' in javascript
    assert 'startSubscriptionCheckout("monthly")' in javascript


def test_topic_suggestions_are_not_hidden_by_the_map_paywall():
    javascript = read_frontend_javascript()

    assert "function renderTopic(topic) {\n  state.pendingTopic = topic;" in javascript
    assert "if (hasMyMapAccess()) await loadMap();" in javascript


def test_topic_confirmation_can_edit_and_reuse_a_recommended_thread():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()

    assert 'id="topic-title" type="text"' in html
    assert 'id="topic-description"' in html
    assert 'id="topic-route-hint"' in html
    assert 'id="topic-match-badge"' in html
    assert 'id="topic-queue-status"' in html
    assert "function updateTopicRoutePresentation()" in javascript
    assert 'topicAccept.textContent = "Connect chat"' in javascript
    assert "payload.suggestions?.[0]" in javascript
    assert '"The same chat can also belong to other topics."' in javascript
    assert "topic: editedTopic" in javascript
    assert "description: editedDescription" in javascript
    assert 'mergeButton.textContent = "Merge into selected topic"' in javascript
    assert "async function mergeMapTopic(" in javascript
    assert "async function disconnectMapTopicConnection(" in javascript
    assert 'disconnectButton.className = "map-topic-connection-remove"' in javascript
    assert "Both topics and their contents will be kept." in javascript


def test_overall_map_thread_is_permanent_and_available_as_a_destination():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()
    stylesheet = (CHAT_HTML.parent / "styles.css").read_text(encoding="utf-8")

    assert 'const OVERALL_MAP_TITLE = "Overall";' in javascript
    assert "function overallMapNode(" in javascript
    assert "appendMapSidebarTopic(overallMapNode(), 0, { overall: true });" in javascript
    assert "const nodes = [\n    overallMapNode(map)," in javascript
    assert "unassigned.textContent = OVERALL_MAP_TITLE;" in javascript
    assert ".map-node.overall" in stylesheet
    assert '<style data-source="styles.css">' in html


def test_dark_and_pink_light_appearance_can_be_switched_and_saved():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()
    stylesheet = (CHAT_HTML.parent / "styles.css").read_text(encoding="utf-8")

    assert len(re.findall(r"<button\b[^>]*\bdata-theme-toggle\b", html)) == 4
    assert html.count('class="workspace-header-actions"') == 2
    assert 'role="switch"' in html
    assert 'class="theme-toggle header-theme-toggle"' in html
    assert 'id="refresh-button"' not in html
    assert "refreshButton" not in javascript
    assert 'const THEME_STORAGE_KEY = "feely_theme";' in javascript
    assert 'return "dark";' in javascript
    assert "localStorage.setItem(THEME_STORAGE_KEY, selectedTheme)" in javascript
    assert 'document.documentElement.dataset.theme = selectedTheme;' in javascript
    assert 'html[data-theme="light"]' in stylesheet
    assert "--lavender: #f2789c;" in stylesheet
    assert "--scrollbar-thumb: rgba(197, 181, 255, 0.48);" in stylesheet
    assert "--scrollbar-thumb: rgba(217, 85, 125, 0.44);" in stylesheet
    assert "::-webkit-scrollbar-thumb:hover" in stylesheet


def test_sidebar_lists_scroll_without_scrolling_the_page():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()
    stylesheet = (CHAT_HTML.parent / "styles.css").read_text(encoding="utf-8")

    assert 'data-app-source="app.js"' in html
    assert '<style data-source="styles.css">' in html
    assert "function syncViewportHeight()" in javascript
    assert 'style.setProperty("--app-height"' in javascript
    assert "window.visualViewport?.addEventListener(\"resize\", syncViewportHeight);" in javascript
    assert ".sidebar-context" in stylesheet
    assert ".map-topic-list" in stylesheet
    assert ".journal-entry-list" in stylesheet
    for selector in (".chat-list", ".map-topic-list", ".journal-entry-list"):
        rule = stylesheet.split(f"{selector} {{", 1)[1].split("}", 1)[0]
        assert "overflow-y: auto;" in rule
        assert "overscroll-behavior: contain;" in rule
        assert "-webkit-overflow-scrolling: touch;" in rule


def test_workspace_headers_use_consistent_compact_titles():
    html = assembled_chat_html()
    javascript = read_frontend_javascript()
    stylesheet = (CHAT_HTML.parent / "styles.css").read_text(encoding="utf-8")

    assert '<p class="eyebrow">Private journal</p>' in html
    assert "<h2>Write and reflect</h2>" in html
    assert "journal-date-heading" not in html
    assert "journalDateHeading" not in javascript
    assert html.count(' workspace-header">') == 3
    header_rule = stylesheet.split(".workspace-header {", 1)[1].split("}", 1)[0]
    title_rule = stylesheet.split(".workspace-header h2 {", 1)[1].split("}", 1)[0]
    assert "height: 76px;" in header_rule
    assert "min-height: 76px;" in header_rule
    assert "max-height: 76px;" in header_rule
    assert "font-size: 19px;" in title_rule
    assert "white-space: nowrap;" in title_rule


def test_dark_theme_uses_violet_instead_of_green_text_accents():
    stylesheet = (CHAT_HTML.parent / "styles.css").read_text(encoding="utf-8")

    assert "\n  color: var(--mint);" not in stylesheet
    for selector in (
        ".conversation-header .eyebrow",
        ".map-suggestion-card .eyebrow",
        ".journal-sidebar-heading .eyebrow",
        ".journal-private-mark",
        ".journal-header .eyebrow",
    ):
        rule = stylesheet.split(f"{selector} {{", 1)[1].split("}", 1)[0]
        assert "color: var(--lavender);" in rule
