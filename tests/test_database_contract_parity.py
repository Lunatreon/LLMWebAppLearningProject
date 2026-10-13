"""Compare real HTTP transcripts with deterministic clocks and integration doubles."""

from datetime import datetime, timezone
from itertools import count
from types import SimpleNamespace
from uuid import UUID

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import get_db
from app.api.routes import auth, billing, journal, llm, webmail as mail_routes
from app.core.config import settings
from app.core.rate_limit import rate_limiter
from app.core.security import create_admin_access_token
from app.db.base import Base
from app.db.session import create_database_engine
from app.db.types import LegacyDateTime
from app.main import create_app
from app.services import email_verification, password_reset, self_authorship, webmail

FIXED_TIME = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)


def workflow_transcript(engine, monkeypatch):
    transcript = []
    delivered_pins = []
    reset_tokens = []
    identifiers = count(1)
    rate_limiter.reset()
    with monkeypatch.context() as patch:
        for name, value in {
            "terms_version": "parity-v1",
            "terms_document_url": "https://example.com/terms.pdf",
            "terms_document_sha256": "a" * 64,
            "email_verification_enabled": True,
            "email_verification_required": True,
            "password_reset_enabled": True,
            "smtp_host": "synthetic.invalid",
            "smtp_from_email": "synthetic@example.com",
            "smtp_username": None,
            "smtp_password": None,
            "webmail_enabled": True,
            "admin_username": "parity-admin",
            "admin_password_hash": "synthetic",
            "premium_features_enabled": False,
        }.items():
            patch.setattr(settings, name, value)
        patch.setattr(auth, "utc_now", lambda: FIXED_TIME)
        patch.setattr(journal, "utc_now", lambda: FIXED_TIME)
        for module in (email_verification, password_reset):
            patch.setattr(module, "current_timestamp", lambda: FIXED_TIME)
        for module in (llm, self_authorship):
            patch.setattr(module, "current_timestamp", lambda: FIXED_TIME.isoformat())
        for module in (llm, journal, self_authorship):
            patch.setattr(module, "uuid4", lambda: UUID(int=next(identifiers)))
        for table in Base.metadata.tables.values():
            for column in table.columns:
                if isinstance(column.type, LegacyDateTime):
                    for default, cached_description in (
                        (column.default, "_default_description_tuple"),
                        (column.onupdate, "_onupdate_description_tuple"),
                    ):
                        if default is not None:
                            patch.setattr(default, "arg", lambda context: FIXED_TIME)
                            # SQLAlchemy caches these callables after first use; freeze both
                            # representations so prior tests cannot change transcript clocks.
                            patch.setattr(
                                column,
                                cached_description,
                                (lambda context: FIXED_TIME, False, True, False),
                            )
        patch.setattr(
            auth, "send_email_verification_message", lambda user, pin: delivered_pins.append(pin)
        )
        patch.setattr(
            auth, "send_password_reset_message", lambda user, token: reset_tokens.append(token)
        )
        app = create_app(init_database=False)

        def database():
            with Session(engine, autoflush=False) as db:
                yield db

        app.dependency_overrides[get_db] = database
        with TestClient(app) as client:

            def request(method, path, status=200, **kwargs):
                response = client.request(method, "/api/v1" + path, **kwargs)
                assert response.status_code == status, (path, response.text)
                payload = response.json()
                if isinstance(payload, dict) and "access_token" in payload:
                    assert isinstance(payload["access_token"], str) and payload["access_token"]
                    transcript.append((path, status, {**payload, "access_token": "<issued JWT>"}))
                else:
                    transcript.append((path, status, payload))
                return payload

            request(
                "POST",
                "/auth/register",
                status=201,
                json={
                    "email": "parity@example.com",
                    "username": "parity-user",
                    "password": "original-password",
                    "terms_accepted": True,
                    "terms_version": "parity-v1",
                    "terms_document_sha256": "a" * 64,
                },
            )
            request(
                "POST",
                "/auth/login",
                status=403,
                json={"email_or_username": "parity-user", "password": "original-password"},
            )
            request(
                "POST",
                "/auth/email-verification/confirm",
                json={"email": "parity@example.com", "pin": delivered_pins[0]},
            )
            login = request(
                "POST",
                "/auth/login",
                json={"email_or_username": "PARITY-USER", "password": "original-password"},
            )
            headers = {"Authorization": f"Bearer {login['access_token']}"}
            request("GET", "/users/me/account", headers=headers)
            request(
                "PATCH",
                "/users/me/account",
                headers=headers,
                json={"display_name": "Parity", "bio": "Same behavior."},
            )
            request("GET", "/terms/me", headers=headers)
            patch.setattr(settings, "terms_version", "parity-v2")
            request(
                "POST",
                "/terms/accept",
                headers=headers,
                json={"accepted": True, "version": "parity-v2", "client": "web"},
            )
            request("POST", "/auth/password-reset/request", json={"email": "parity@example.com"})
            request(
                "POST",
                "/auth/password-reset/confirm",
                json={"token": reset_tokens[0], "new_password": "replacement-password"},
            )
            request(
                "POST",
                "/auth/password-reset/confirm",
                status=400,
                json={"token": reset_tokens[0], "new_password": "another-password"},
            )
            request(
                "POST",
                "/auth/login",
                json={"email_or_username": "parity-user", "password": "replacement-password"},
            )
            request(
                "PUT",
                "/journal/entries/2026-03-29",
                headers=headers,
                json={"content": "A local calendar date across the daylight saving boundary."},
            )
            request("GET", "/journal/entries/2026-03-29", headers=headers)
            topic = request(
                "POST",
                "/users/me/map/topics",
                headers=headers,
                json={
                    "title": "Walking",
                    "description": "A useful practice.",
                    "category": "experience",
                },
            )
            practice = request(
                "POST",
                "/users/me/map/entries",
                headers=headers,
                json={
                    "category": "practice",
                    "text": "Take a walk.",
                    "topic_space_id": topic["topic"]["id"],
                },
            )
            request(
                "PATCH",
                f"/users/me/map/practices/{practice['entry']['id']}",
                headers=headers,
                json={"status": "completed", "reflection": "I felt calmer."},
            )
            request("GET", "/users/me/map", headers=headers)
            stream = client.post(
                "/api/v1/llm/message/stream",
                headers=headers,
                json={"chat_id": "parity-chat", "message": "I went for a walk today."},
            )
            assert stream.status_code == 200
            import json

            events = [json.loads(line) for line in stream.text.splitlines()]
            assert any(event["type"] == "result" for event in events)
            # Heartbeat timing depends on scheduler speed; saved result/data must be identical.
            transcript.append(
                ("/llm/message/stream", 200, [e for e in events if e["type"] != "status"])
            )
            request("GET", "/llm/chats/parity-chat", headers=headers)
            request("GET", "/llm/chats", headers=headers)
            request("GET", "/users/me/profile", headers=headers)

            stripe_subscription = {
                "id": "sub_synthetic",
                "customer": "cus_synthetic",
                "status": "active",
                "metadata": {"feely_user_id": "1"},
                "items": {"data": []},
            }
            stripe_double = SimpleNamespace(
                v1=SimpleNamespace(
                    subscriptions=SimpleNamespace(
                        retrieve=lambda identifier: stripe_subscription,
                    )
                )
            )
            event = {
                "id": "evt_synthetic",
                "type": "customer.subscription.updated",
                "data": {"object": stripe_subscription},
            }
            patch.setattr(billing, "construct_stripe_event", lambda payload, signature: event)
            patch.setattr(billing, "get_stripe_client", lambda: stripe_double)
            request("POST", "/billing/webhook", content=b"synthetic")
            request("POST", "/billing/webhook", content=b"synthetic")
            request("GET", "/billing/subscription", headers=headers)
            with Session(engine) as db:
                webmail.save_incoming(
                    db, "mail/parity", b"From: sender@example.com\r\nSubject: Hello\r\n\r\nHello"
                )
            admin_headers = {"Authorization": f"Bearer {create_admin_access_token('parity-admin')}"}
            mail = request("GET", "/webmail/messages", headers=admin_headers)
            request("GET", f"/webmail/messages/{mail[0]['id']}", headers=admin_headers)
            request("POST", f"/webmail/messages/{mail[0]['id']}/trash", headers=admin_headers)
    return transcript


def test_sqlite_and_selected_database_have_identical_critical_http_contracts(
    database_engine, tmp_path, monkeypatch
):
    reference = create_database_engine(f"sqlite:///{tmp_path / 'reference.db'}")
    Base.metadata.create_all(reference)
    try:
        sqlite_transcript = workflow_transcript(reference, monkeypatch)
        selected_transcript = workflow_transcript(database_engine, monkeypatch)
        assert selected_transcript == sqlite_transcript
    finally:
        reference.dispose()
