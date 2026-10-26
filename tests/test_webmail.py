from email.message import EmailMessage

import pytest
from sqlalchemy import select

from backend.core.config import settings
from backend.core.security import create_admin_access_token
from backend.core.security import create_access_token
from backend.models.mail_message import MailMessage
from backend.services import webmail
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
    from backend.api.routes import webmail as routes

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

    monkeypatch.setattr(settings, "webmail_provider", "cloudflare")
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



@pytest.mark.parametrize("use_ssl", [True, False])
@pytest.mark.parametrize("failure", [None, "fetch", "commit", "size", "select", "search"])
def test_imap_import_readonly_retry_and_uidvalidity(client, monkeypatch, use_ssl, failure):
    from contextlib import contextmanager

    for name, value in {
        "webmail_provider": "imap", "webmail_imap_host": "mail.example.com",
        "webmail_imap_username": "info@example.com", "webmail_imap_password": "private-password",
        "webmail_imap_folder": "INBOX", "webmail_imap_use_ssl": use_ssl,
    }.items():
        monkeypatch.setattr(settings, name, value)
    state = {"failure": failure, "validity": b"1", "fetches": 0, "tls": use_ssl}
    raw = b"From: visitor@example.com\r\nSubject: Hi\r\n\r\nHello"

    class Mailbox:
        def __init__(self, *args, **kwargs):
            assert kwargs["timeout"] == 30
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self, *, ssl_context):
            assert ssl_context.verify_mode == webmail.ssl.CERT_REQUIRED
            state["tls"] = True
        def login(self, username, password):
            assert state["tls"]
            assert password == "private-password"
        def select(self, folder, *, readonly):
            assert readonly is True
            return ("NO" if state["failure"] == "select" else "OK"), []
        def response(self, name):
            assert name == "UIDVALIDITY"
            return name, [state["validity"]]
        def uid(self, command, *args):
            if command == "search":
                return ("NO" if state["failure"] == "search" else "OK"), [b"7"]
            assert command == "fetch"
            if args[1] == "(RFC822.SIZE)":
                size = webmail.MAX_MAIL_BYTES + 1 if state["failure"] == "size" else len(raw)
                return "OK", [f"1 (RFC822.SIZE {size})".encode()]
            assert args[1] == "(BODY.PEEK[])"
            state["fetches"] += 1
            if state["failure"] == "fetch": return "NO", []
            return "OK", [(b"1 BODY[]", raw)]

    @contextmanager
    def session():
        with database(client) as db:
            if state["failure"] == "commit":
                def fail(): raise RuntimeError("database unavailable")
                monkeypatch.setattr(db, "commit", fail)
            yield db

    monkeypatch.setattr(webmail.imaplib, "IMAP4_SSL", Mailbox)
    monkeypatch.setattr(webmail.imaplib, "IMAP4", Mailbox)
    monkeypatch.setattr(webmail, "SessionLocal", session)
    webmail.pull_mail()
    assert bool(webmail.sync_state["error"]) == bool(failure)
    if failure:
        with database(client) as db:
            assert list(db.scalars(select(MailMessage))) == []
    state["failure"] = None
    webmail.pull_mail()
    assert webmail.sync_state["error"] is None
    fetches = state["fetches"]
    webmail.pull_mail()
    assert state["fetches"] == fetches
    with database(client) as db:
        assert len(list(db.scalars(select(MailMessage)))) == 1
    state["validity"] = b"2"
    webmail.pull_mail()
    with database(client) as db:
        assert len(list(db.scalars(select(MailMessage)))) == 2


def test_legacy_bridge_selection():
    from backend.core.config import Settings
    config = Settings(_env_file=None, webmail_worker_url="https://bridge.example.com")
    assert config.incoming_mail_provider == "cloudflare"
    assert config.model_copy(update={"webmail_provider": "imap"}).incoming_mail_provider == "imap"
