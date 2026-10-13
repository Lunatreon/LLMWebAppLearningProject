import re
import smtplib
from contextlib import contextmanager
from datetime import timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from sqlalchemy import select

from app.api.dependencies import get_db
from app.integrations import email as mail
from app.core.config import settings
from app.services.email_verification import hash_email_verification_pin
from app.core.rate_limit import rate_limiter
from app.core.security import create_access_token, create_admin_access_token, hash_password
from app.models.user import User, utc_now


@contextmanager
def database(client):
    generator = client.app.dependency_overrides[get_db]()
    try:
        yield next(generator)
    finally:
        generator.close()


@pytest.fixture
def outbox(monkeypatch):
    messages = []
    monkeypatch.setattr(settings, "email_verification_enabled", True)
    monkeypatch.setattr(settings, "password_reset_enabled", True)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_username", "info@feel-y.com")
    monkeypatch.setattr(settings, "smtp_password", "test-only")
    monkeypatch.setattr(settings, "smtp_from_email", "noreply@feel-y.com")
    monkeypatch.setattr(settings, "smtp_use_tls", True)
    monkeypatch.setattr(settings, "smtp_use_ssl", False)
    monkeypatch.setattr(settings, "public_app_url", "https://app.feel-y.com")

    class SMTP:
        def __init__(self, host, port, **kwargs):
            assert host == "smtp.example.com"
            self.secure = "context" in kwargs

        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def starttls(self, *, context):
            assert context.check_hostname
            self.secure = True

        def login(self, username, password):
            assert self.secure
            assert username == "info@feel-y.com" and password == "test-only"

        def send_message(self, message):
            assert self.secure
            assert message["From"] == "noreply@feel-y.com"
            messages.append(message)

    monkeypatch.setattr(mail.smtplib, "SMTP", SMTP)
    monkeypatch.setattr(mail.smtplib, "SMTP_SSL", SMTP)
    return messages


def register(client, email="tester@example.com", username="tester"):
    return client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "username": username,
            "password": "original-password",
        },
    )


def pin_from(message):
    return re.search(r"PIN is: ([0-9]{6})", message.get_content()).group(1)


def confirm(client, pin, email="tester@example.com"):
    return client.post("/api/v1/auth/email-verification/confirm", json={"email": email, "pin": pin})


def test_pin_activation_is_required_scoped_and_single_use(client, outbox):
    response = register(client)
    assert response.status_code == 201
    assert not response.json()["is_email_verified"]
    pin = pin_from(outbox[-1])
    with database(client) as db:
        user = db.scalar(select(User))
        assert user.email_verification_token_hash == hash_email_verification_pin(user.email, pin)
        assert user.email_verification_token_hash != pin
        token = create_access_token(str(user.id))
    credentials = {"email_or_username": "tester", "password": "original-password"}
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 403
    assert (
        client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 403
    )
    assert confirm(client, pin, "someone-else@example.com").status_code == 400
    assert confirm(client, pin).status_code == 200
    assert confirm(client, pin).status_code == 400
    assert client.post("/api/v1/auth/login", json=credentials).status_code == 200


def test_pin_lockout_survives_rate_limiter_reset_and_resend_replaces_pin(client, outbox):
    register(client)
    original = pin_from(outbox[-1])
    wrong = "000000" if original != "000000" else "999999"
    for _ in range(settings.email_verification_max_attempts):
        assert confirm(client, wrong).status_code == 400
    rate_limiter.reset()
    assert confirm(client, original).status_code == 400
    assert (
        client.post(
            "/api/v1/auth/email-verification/request", json={"email": "tester@example.com"}
        ).status_code
        == 200
    )
    assert confirm(client, pin_from(outbox[-1])).status_code == 200


def test_expired_pin_and_disabled_accounts_cannot_activate(client, outbox):
    register(client)
    pin = pin_from(outbox[-1])
    with database(client) as db:
        user = db.scalar(select(User))
        user.email_verification_sent_at = utc_now() - timedelta(hours=1)
        db.commit()
    assert confirm(client, pin).status_code == 400
    with database(client) as db:
        user = db.scalar(select(User))
        user.email_verification_sent_at = utc_now()
        user.is_active = False
        db.commit()
    assert confirm(client, pin).status_code == 400


def test_duplicate_pins_are_safe_for_different_addresses(client, outbox, monkeypatch):
    monkeypatch.setattr("app.services.email_verification.secrets.randbelow", lambda _: 123)
    assert register(client).status_code == 201
    assert register(client, "second@example.com", "second").status_code == 201
    assert pin_from(outbox[-1]) == "000123"
    assert confirm(client, "000123").status_code == 200
    with database(client) as db:
        assert not db.scalar(
            select(User).where(User.email == "second@example.com")
        ).is_email_verified


@pytest.mark.parametrize("use_ssl", [False, True])
def test_reset_email_sender_link_and_single_use(client, outbox, monkeypatch, use_ssl):
    monkeypatch.setattr(settings, "smtp_use_ssl", use_ssl)
    monkeypatch.setattr(settings, "smtp_port", 465 if use_ssl else 587)
    register(client)
    assert confirm(client, pin_from(outbox[-1])).status_code == 200
    result = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "tester@example.com"}
    )
    assert result.status_code == 200
    content = outbox[-1].get_content()
    link = re.search(r"https://app.feel-y.com/\?reset_password_token=\S+", content).group(0)
    token = parse_qs(urlparse(link).query)["reset_password_token"][0]
    payload = {"token": token, "new_password": "replacement-password"}
    assert client.post("/api/v1/auth/password-reset/confirm", json=payload).status_code == 200
    assert client.post("/api/v1/auth/password-reset/confirm", json=payload).status_code == 400
    assert (
        client.post(
            "/api/v1/auth/login",
            json={"email_or_username": "tester", "password": "replacement-password"},
        ).status_code
        == 200
    )
    before = len(outbox)
    absent = client.post(
        "/api/v1/auth/password-reset/request", json={"email": "absent@example.com"}
    )
    assert absent.json() == result.json()
    assert len(outbox) == before


def test_registration_mail_failure_can_be_recovered_with_resend(client, outbox, monkeypatch):
    smtp = mail.smtplib.SMTP

    def broken(*args, **kwargs):
        raise smtplib.SMTPAuthenticationError(535, "provider-private-error")

    monkeypatch.setattr(mail.smtplib, "SMTP", broken)
    response = register(client)
    assert response.status_code == 502
    assert "account was created" in response.json()["detail"]
    assert "provider-private-error" not in response.text
    monkeypatch.setattr(mail.smtplib, "SMTP", smtp)
    assert (
        client.post(
            "/api/v1/auth/email-verification/request", json={"email": "tester@example.com"}
        ).status_code
        == 200
    )
    assert confirm(client, pin_from(outbox[-1])).status_code == 200


def test_feedback_flag_storage_admin_access_and_account_deletion(client, monkeypatch):
    monkeypatch.setattr(settings, "feedback_enabled", True)
    register(client)
    token = client.post(
        "/api/v1/auth/login", json={"email_or_username": "tester", "password": "original-password"}
    ).json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"category": "bug", "message": "  The map did not open.  "}
    assert client.post("/api/v1/feedback", json=payload).status_code == 401
    assert (
        client.post("/api/v1/feedback", headers=headers, json={"message": "   "}).status_code == 422
    )
    result = client.post("/api/v1/feedback", headers=headers, json=payload)
    assert result.status_code == 201
    assert client.get("/api/v1/admin/feedback", headers=headers).status_code == 401
    monkeypatch.setattr(settings, "admin_username", "feedback-admin")
    monkeypatch.setattr(settings, "admin_password_hash", hash_password("admin-password"))
    admin = {"Authorization": f"Bearer {create_admin_access_token('feedback-admin')}"}
    entries = client.get("/api/v1/admin/feedback", headers=admin).json()
    assert entries[0]["message"] == "The map did not open."
    assert entries[0]["email"] == "tester@example.com"
    assert (
        client.get(f"/api/v1/admin/feedback?before_id={entries[0]['id']}", headers=admin).json()
        == []
    )
    monkeypatch.setattr(settings, "feedback_enabled", False)
    assert client.get("/api/v1/feedback/config").json() == {"enabled": False}
    assert client.post("/api/v1/feedback", headers=headers, json=payload).status_code == 404
    assert len(client.get("/api/v1/admin/feedback", headers=admin).json()) == 1
    assert (
        client.request(
            "DELETE",
            "/api/v1/users/me/account",
            headers=headers,
            json={"password": "original-password"},
        ).status_code
        == 204
    )
    assert client.get("/api/v1/admin/feedback", headers=admin).json() == []


@pytest.mark.parametrize("delivery_fails", [False, True])
def test_feedback_notification_preserves_saved_submission(client, monkeypatch, delivery_fails):
    from app.services import feedback_notifications as feedback_mail
    from app.models.feedback import Feedback

    monkeypatch.setattr(settings, "feedback_enabled", True)
    monkeypatch.setattr(settings, "feedback_email_to", "info@feel-y.com")
    messages = []

    def deliver(message):
        messages.append(message)
        if delivery_fails:
            raise RuntimeError("Simulated SMTP outage")

    monkeypatch.setattr(feedback_mail, "send_mail", deliver)
    register(client)
    token = client.post(
        "/api/v1/auth/login",
        json={
            "email_or_username": "tester",
            "password": "original-password",
        },
    ).json()["access_token"]
    result = client.post(
        "/api/v1/feedback",
        headers={"Authorization": f"Bearer {token}"},
        json={"category": "idea", "message": "Please add a calendar."},
    )
    assert result.status_code == 201
    assert len(messages) == 1
    assert messages[0]["To"] == "info@feel-y.com"
    assert messages[0]["Reply-To"] == "tester@example.com"
    assert "Please add a calendar." in messages[0].get_content()
    with database(client) as db:
        assert db.get(Feedback, result.json()["id"]).message == "Please add a calendar."
