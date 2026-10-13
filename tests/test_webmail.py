from email.message import EmailMessage

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.security import create_admin_access_token
from app.core.security import create_access_token
from app.models.mail_message import MailMessage
from app.services import webmail
from tests.test_email_and_feedback import database


@pytest.fixture
def mail_admin(monkeypatch):
    monkeypatch.setattr(settings, "webmail_enabled", True)
    monkeypatch.setattr(settings, "admin_username", "mail-admin")
    monkeypatch.setattr(settings, "admin_password_hash", "configured")
    return {"Authorization": f"Bearer {create_admin_access_token('mail-admin')}"}


def incoming(client):
    message = EmailMessage()
    message["From"] = "visitor@example.com"
    message["Reply-To"] = "reply@example.com"
    message["To"] = "info@feel-y.com"
    message["Subject"] = "Hello <script>bad()</script>"
    message["Message-ID"] = "<original@example.com>"
    message.set_content("Hello from a visitor")
    message.add_attachment(
        b"attachment content", maintype="application", subtype="octet-stream", filename="test.txt"
    )
    with database(client) as db:
        webmail.save_incoming(db, "mail/" + "a" * 36, message.as_bytes())
        webmail.save_incoming(db, "mail/" + "a" * 36, message.as_bytes())
        rows = list(db.scalars(select(MailMessage)))
        assert len(rows) == 1
        return rows[0].id


def test_inbox_protected_and_attachments_download(client, mail_admin):
    message_id = incoming(client)
    assert client.get("/api/v1/webmail/messages").status_code == 401
    assert (
        client.get(
            "/api/v1/webmail/messages",
            headers={"Authorization": f"Bearer {create_access_token('1')}"},
        ).status_code
        == 401
    )
    response = client.get(f"/api/v1/webmail/messages/{message_id}", headers=mail_admin)
    assert response.status_code == 200
    assert response.json()["reply_to"] == "reply@example.com"
    assert response.json()["is_read"] is True
    attachment = client.get(
        f"/api/v1/webmail/messages/{message_id}/attachments/0", headers=mail_admin
    )
    assert attachment.content == b"attachment content"
    assert attachment.headers["content-type"] == "application/octet-stream"
    assert (
        client.post(f"/api/v1/webmail/messages/{message_id}/trash", headers=mail_admin).status_code
        == 200
    )
    assert client.get("/api/v1/webmail/messages", headers=mail_admin).json() == []


@pytest.mark.parametrize("fails", [False, True])
def test_send_preserves_copy_and_uses_info_sender(client, mail_admin, monkeypatch, fails):
    from app.api.routes import webmail as routes

    message_id = incoming(client)

    def send(message, *, sender):
        assert sender == "info@feel-y.com"
        assert message["In-Reply-To"] == "<original@example.com>"
        if fails:
            raise RuntimeError("SMTP unavailable")

    monkeypatch.setattr(routes, "send_mail", send)
    result = client.post(
        "/api/v1/webmail/send",
        headers=mail_admin,
        json={
            "to": "reply@example.com",
            "subject": "Re: Hello",
            "body": "Thanks!",
            "reply_to_id": message_id,
        },
    )
    assert result.status_code == (502 if fails else 200)
    with database(client) as db:
        row = db.scalar(
            select(MailMessage).where(MailMessage.folder == ("uncertain" if fails else "sent"))
        )
        assert row.body == "Thanks!"
    assert (
        client.post(
            "/api/v1/webmail/send",
            headers=mail_admin,
            json={
                "to": "reply@example.com",
                "subject": "Oops\r\nBcc: bad@example.com",
                "body": "Test",
            },
        ).status_code
        == 422
    )


def test_html_becomes_text_without_remote_content():
    message = EmailMessage()
    message.set_content(
        '<p>Hello</p><script>bad()</script><img src="https://tracker.invalid">', subtype="html"
    )
    _, body = webmail.parse_mail(message.as_bytes())
    assert "Hello" in body
    assert "bad()" not in body
    assert "tracker" not in body


def test_puller_commits_before_ack_and_retries_ack(client, monkeypatch):
    from contextlib import contextmanager
    import httpx

    monkeypatch.setattr(settings, "webmail_worker_url", "https://bridge.example.com")
    monkeypatch.setattr(settings, "webmail_bridge_secret", "x" * 48)

    @contextmanager
    def session():
        with database(client) as db:
            yield db

    monkeypatch.setattr(webmail, "SessionLocal", session)
    key = "mail/" + "b" * 36
    calls = []

    def handler(request):
        if request.url.path == "/messages":
            return httpx.Response(200, json={"keys": [key]})
        if request.method == "GET":
            return httpx.Response(
                200, content=b"From: visitor@example.com\r\nSubject: Hi\r\n\r\nHello"
            )
        with database(client) as db:
            assert db.scalar(select(MailMessage).where(MailMessage.delivery_key == key)) is not None
        calls.append("ack")
        return httpx.Response(500 if len(calls) == 1 else 204)

    real_client = httpx.Client
    monkeypatch.setattr(
        webmail.httpx,
        "Client",
        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw),
    )
    webmail.pull_mail()
    assert webmail.sync_state["error"]
    webmail.pull_mail()
    assert webmail.sync_state["error"] is None
    with database(client) as db:
        assert len(list(db.scalars(select(MailMessage)))) == 1


def test_initializer_preserves_credentials_and_secret(tmp_path):
    from scripts.init_webmail import initialize

    config = tmp_path / "init.toml"
    config.write_text(
        '[webmail]\naddress="info@feel-y.com"\nauth_sender="noreply@feel-y.com"\nworker_url=""\n'
    )
    env = tmp_path / ".env"
    env.write_text('SMTP_PASSWORD="test-secret"\nADMIN_PASSWORD_HASH="hash"\n')
    initialize(config, env)
    once = env.read_text()
    initialize(config, env)
    assert once == env.read_text()
    assert 'SMTP_PASSWORD="test-secret"' in once
