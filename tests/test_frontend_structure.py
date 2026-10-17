"""Compiled React routing and retained public tools, independent of a local build."""

from fastapi.testclient import TestClient
from app.website import app


def test_react_routes_and_assets_are_served_without_old_website(tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.routes.website.WEBSITE_ROOT", tmp_path)
    (tmp_path / "index.html").write_text('<div id="root"></div>')
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "app-hash.js").write_text("// compiled")
    (tmp_path / "assets" / "private.json").write_text("private")
    (tmp_path / "admin.html").write_text("admin")
    (tmp_path / "webmail.html").write_text("mail")
    with TestClient(app) as client:
        for route in (
            "/",
            "/chat",
            "/account",
            "/terms",
            "/reset-password",
            "/index.html",
            "/chat.html",
        ):
            response = client.get(route)
            assert response.status_code == 200
            assert response.text == '<div id="root"></div>'
            assert response.headers["cache-control"] == "no-store"
        assert client.head("/account").status_code == 200
        assert client.get("/assets/app-hash.js").text == "// compiled"
        assert client.get("/admin.html").text == "admin"
        assert client.get("/webmail.html").text == "mail"
        for route in (
            "/assets/private.json",
            "/assets/",
            "/reference/",
            "/app.js",
            "/src/main.tsx",
            "/.env",
            "/%2e%2e/.env",
        ):
            assert client.get(route).status_code == 404


def test_published_terms_and_editable_draft_stay_available(tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.routes.website.WEBSITE_ROOT", tmp_path)
    legal = tmp_path / "legal"
    (legal / "agb").mkdir(parents=True)
    (legal / "agb" / "v1.html").write_text("published")
    with TestClient(app) as client:
        assert client.get("/legal/agb/v1.html").text == "published"
        for content in ("Draft", "Updated draft"):
            (legal / "agb-draft.txt").write_text(content)
            response = client.get("/legal/agb-draft.txt")
            assert response.text == content
            assert response.headers["cache-control"] == "no-store"
        assert client.get("/legal/private.txt").status_code == 404


def test_missing_react_build_does_not_fall_back_to_source(tmp_path, monkeypatch):
    monkeypatch.setattr("app.api.routes.website.WEBSITE_ROOT", tmp_path / "missing")
    with TestClient(app) as client:
        assert client.get("/").status_code == 404
