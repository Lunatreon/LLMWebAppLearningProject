import re
from pathlib import Path
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from urllib.request import urlopen


from fastapi.testclient import TestClient

from app.website import PUBLIC_FILES, app
from frontend_helpers import assembled_chat_html, application_scripts

ROOT = Path(__file__).resolve().parents[1]
WEBSITE = ROOT / "website"


def test_root_serves_shell_and_legacy_urls_redirect_with_query_intact():
    with TestClient(app) as client:
        root = client.get("/", follow_redirects=False)
        assert root.status_code == 200
        assert root.content == (WEBSITE / "index.html").read_bytes()
        assert 'data-view=' in root.text
        assert 'data-view="views/auth.html"' in root.text
        assert 'data-view="views/journal.html"' in root.text
        for page in ("chat.html", "index.html"):
            for query in ("", "?reset_password_token=a%2Bb&mode=login", "?checkout=success&session_id=abc", "?view=account&billing_return=portal"):
                for method in ("GET", "HEAD"):
                    response = client.request(method, f"/{page}{query}", follow_redirects=False)
                    assert response.status_code == 307
                    assert response.headers["location"] == f"/{query}"
        assert client.get("/views/chat.html", follow_redirects=False).status_code == 200


def test_shell_views_and_scripts_are_public():
    html = (WEBSITE / "index.html").read_text(encoding="utf-8")
    sources = application_scripts(html)
    assert sources[0] == "app.js"
    assert sources[-1] == "js/start.js"
    assert {"js/chat.js", "js/map.js", "js/journal.js", "js/account.js"} <= set(sources)
    with TestClient(app) as client:
        views = re.findall(r'data-view="([^"]+)"', (WEBSITE / "index.html").read_text(encoding="utf-8"))
        assert {"views/chat.html", "views/map.html", "views/journal.html"} <= set(views)
        for source in [*sources, *views, "styles.css", "js/load-views.js"]:
            assert source in PUBLIC_FILES
            response = client.get(f"/{source}")
            assert response.status_code == 200
            assert response.content == (WEBSITE / source).read_bytes()
        assert client.get("/templates/partials/auth.html").status_code == 404
        assert client.get("/EDITING.md").status_code == 404
        assert client.get("/shell.html").status_code == 404


def test_html_ids_are_unique_and_journal_is_outside_main_tabs():
    html = assembled_chat_html()
    ids = re.findall(r'\bid="([^"]+)"', html)
    assert len(ids) == len(set(ids))
    tabs = html.split('class="workspace-switch"', 1)[1].split("</div>", 1)[0]
    assert "chat-workspace-button" in tabs and "map-workspace-button" in tabs
    assert "journal-workspace-button" not in tabs
    assert 'id="journal-workspace-button" class="sidebar-journal-link"' in html


def test_all_direct_dom_bindings_exist_in_the_assembled_page():
    html = assembled_chat_html()
    ids = set(re.findall(r'\bid="([^"]+)"', html))
    core = (WEBSITE / "app.js").read_text(encoding="utf-8")
    bindings = re.findall(r'document.querySelector\("#([\w-]+)"\)', core)
    assert set(bindings) <= ids


def test_index_references_views_and_separate_assets():
    html = (WEBSITE / "index.html").read_text(encoding="utf-8")
    assert application_scripts(html)
    assert all(
        re.fullmatch(r'<script src="[^"]+" defer></script>', script)
        for script in re.findall(r'<script\b[^>]*>.*?</script>', html, re.DOTALL)
    )
    assert '<style' not in html
    assert not re.search(r'\s(?:style|on\w+)\s*=', html)
    assert 'type="text/plain"' not in html
    assert 'data-view=' in html
    assert '<link rel="stylesheet" href="styles.css" />' in html
    assert '<main class="shell" data-app-shell hidden>' in html
    assert 'A page file could not load' not in html
    assert 'fetchFeelYView' not in html
    assert 'loadFeelYViews' not in html


def test_static_server_serves_the_entry_page_views_and_assets():
    class StaticAssets(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    port = 0
    for _ in range(2):
        server = ThreadingHTTPServer(("127.0.0.1", port), partial(StaticAssets, directory=str(WEBSITE)))
        port = server.server_port
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with urlopen(f"http://127.0.0.1:{port}/", timeout=3) as response:
                html = response.read().decode("utf-8").replace("\r\n", "\n")
            assert html == (WEBSITE / "index.html").read_text(encoding="utf-8")
            assert 'data-view="views/auth.html"' in html
            assert 'data-view=' in html
            assert '<style' not in html
            assert '<link rel="stylesheet" href="styles.css" />' in html
            views = re.findall(r'data-view="([^"]+)"', html)
            for name in ["styles.css", "js/load-views.js", *views, *application_scripts(html)]:
                with urlopen(f"http://127.0.0.1:{port}/{name}", timeout=3) as response:
                    assert response.status == 200
                    assert response.read() == (WEBSITE / name).read_bytes()
                    expected_types = ({"text/html"} if name.endswith(".html") else
                                      {"text/css"} if name.endswith(".css") else
                                      {"text/javascript", "application/javascript"})
                    assert response.headers.get_content_type() in expected_types
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


def test_views_contain_markup_without_scripts_or_styles():
    index = (WEBSITE / "index.html").read_text(encoding="utf-8")
    for name in re.findall(r'data-view="([^"]+)"', index):
        view = (WEBSITE / name).read_text(encoding="utf-8")
        assert not re.search(r"<(?:script|style|html)\b", view, re.IGNORECASE)
        assert not re.search(r"\s(?:style|on\w+)\s*=", view)
