from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
CHAT_HTML = ROOT_DIR / "website" / "chat.html"
APP_JS = ROOT_DIR / "website" / "app.js"


def test_website_root_redirects_to_chat_without_an_external_target():
    index_html = (ROOT_DIR / "website" / "index.html").read_text(encoding="utf-8")

    assert 'content="0; url=chat.html"' in index_html
    assert 'window.location.replace(`chat.html${window.location.search}${window.location.hash}`)' in index_html
    assert "http://" not in index_html
    assert "https://" not in index_html


def test_auth_form_cannot_fall_back_to_credentials_in_query_string():
    html = CHAT_HTML.read_text(encoding="utf-8")

    assert '<form id="auth-form" class="auth-form" method="post">' in html
    assert 'name="email"' not in html
    assert 'name="username"' not in html
    assert 'name="password"' not in html
    assert '<meta name="referrer" content="no-referrer" />' in html


def test_sensitive_auth_query_parameters_are_scrubbed_on_load():
    javascript = APP_JS.read_text(encoding="utf-8")

    assert "scrubSensitiveAuthParams();" in javascript
    for name in ("email", "email_or_username", "username", "password", "current_password"):
        assert f'"{name}"' in javascript


def test_stripe_portal_returns_to_account_and_supports_resuming():
    html = CHAT_HTML.read_text(encoding="utf-8")
    javascript = APP_JS.read_text(encoding="utf-8")

    assert 'id="resume-subscription-button"' in html
    assert 'returnUrl.searchParams.set("view", "account")' in javascript
    assert 'returnUrl.searchParams.set("billing_return", "portal")' in javascript
    assert 'api("/billing/subscription/resume"' in javascript
    assert "await handleAccountReturn(requestedView);" in javascript


def test_temporary_api_failures_do_not_clear_the_saved_session():
    javascript = APP_JS.read_text(encoding="utf-8")

    assert "[401, 403].includes(error.status)" in javascript


def test_admin_page_is_server_authorized_and_prompts_use_admin_api():
    html = CHAT_HTML.read_text(encoding="utf-8")
    javascript = APP_JS.read_text(encoding="utf-8")
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
    html = CHAT_HTML.read_text(encoding="utf-8")
    javascript = APP_JS.read_text(encoding="utf-8")

    assert 'id="map-workspace-button"' in html
    assert 'id="map-plan-badge"' in html
    assert 'id="chat-plan-note"' in html
    assert "function hasMyMapAccess()" in javascript
    assert "function renderMapPaywall()" in javascript
    assert 'if (!hasMyMapAccess()) {' in javascript
    assert 'startSubscriptionCheckout("monthly")' in javascript


def test_topic_suggestions_are_not_hidden_by_the_map_paywall():
    javascript = APP_JS.read_text(encoding="utf-8")

    assert "function renderTopic(topic) {\n  state.pendingTopic = topic;" in javascript
    assert "if (hasMyMapAccess()) await loadMap();" in javascript
