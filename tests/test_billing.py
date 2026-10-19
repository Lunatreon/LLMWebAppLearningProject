from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.billing import BillingSubscription
from app.models.user import User
from app.schemas.billing import SubscriptionStatus
from app.services import billing as billing_service
from app.services.billing import (
    InvalidBillingPlanError,
    InvalidBillingReturnUrlError,
    has_premium_access,
    normalize_subscription,
    price_id_for_plan,
    remove_subscription_for_admin,
    resume_subscription,
    validated_portal_return_url,
)


def _register_and_authenticate(client) -> dict[str, str]:
    register_response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "billing@example.com",
            "username": "billing-user",
            "password": "secure-password",
        },
    )
    assert register_response.status_code == 201
    login_response = client.post(
        "/api/v1/auth/login",
        json={
            "email_or_username": "billing@example.com",
            "password": "secure-password",
        },
    )
    assert login_response.status_code == 200
    return {"Authorization": f"Bearer {login_response.json()['access_token']}"}


def test_subscription_status_normalizes_to_safe_free_state():
    normalized = normalize_subscription(None)

    assert normalized == {
        "status": SubscriptionStatus.NONE,
        "premium": False,
        "free_test_phase": False,
        "my_map_access": False,
        "chat_daily_limit": 10,
        "plan": "free",
        "cancel_at_period_end": False,
        "current_period_end": None,
        "billing_available": False,
        "available_plans": [],
        "management_available": False,
        "can_resume": False,
    }

    unknown = BillingSubscription(user_id=1, status="unexpected-provider-status")
    assert normalize_subscription(unknown)["status"] == SubscriptionStatus.NONE
    assert normalize_subscription(unknown)["premium"] is False


def test_local_development_can_explicitly_bypass_premium_features(monkeypatch):
    monkeypatch.setattr(settings, "premium_features_enabled", False)

    normalized = normalize_subscription(None)

    assert normalized["premium"] is False
    assert normalized["my_map_access"] is True
    assert normalized["chat_daily_limit"] == settings.rate_limit_llm_user_per_day


def test_premium_access_uses_only_local_subscription_state(database_engine):
    engine = database_engine
    TestingSession = sessionmaker(bind=engine)
    now = datetime.now(timezone.utc)

    with TestingSession() as db:
        user = User(
            email="local-state@example.com",
            username="local-state",
            hashed_password="not-used-in-this-test",
        )
        db.add(user)
        db.flush()
        subscription = BillingSubscription(
            user_id=user.id,
            status="active",
            current_period_end=now + timedelta(days=1),
        )
        db.add(subscription)
        db.commit()

        assert has_premium_access(db, user, now=now) is True

        subscription.status = "past_due"
        db.commit()
        assert has_premium_access(db, user, now=now) is False

        subscription.status = "active"
        subscription.current_period_end = now - timedelta(seconds=1)
        db.commit()
        assert has_premium_access(db, user, now=now) is False


def test_unknown_plan_is_rejected_before_configuration_is_considered():
    with pytest.raises(InvalidBillingPlanError, match="Unknown subscription plan"):
        price_id_for_plan("custom")


def test_monthly_only_checkout_configuration(monkeypatch):
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_example")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_monthly")
    monkeypatch.setattr(settings, "stripe_price_yearly", None)
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://example.com/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://example.com/cancel")

    assert settings.stripe_checkout_configured is True
    assert price_id_for_plan("monthly") == "price_monthly"
    assert normalize_subscription(None)["available_plans"] == ["monthly"]
    assert normalize_subscription(None)["billing_available"] is True
    with pytest.raises(InvalidBillingPlanError, match="not available"):
        price_id_for_plan("yearly")


def test_monthly_only_subscription_api_hides_yearly_plan(monkeypatch, client):
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_example")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_monthly")
    monkeypatch.setattr(settings, "stripe_price_yearly", None)
    monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://example.com/success")
    monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://example.com/cancel")
    headers = _register_and_authenticate(client)

    response = client.get("/api/v1/billing/subscription", headers=headers)

    assert response.status_code == 200
    assert response.json()["billing_available"] is True
    assert response.json()["available_plans"] == ["monthly"]

    unavailable_checkout = client.post(
        "/api/v1/billing/checkout",
        headers=headers,
        json={"plan": "yearly"},
    )
    assert unavailable_checkout.status_code == 422
    assert unavailable_checkout.json() == {"detail": "Subscription plan is not available."}


def test_checkout_return_securely_synchronizes_subscription(monkeypatch, client):
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_example")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_monthly")
    monkeypatch.setattr(settings, "stripe_price_yearly", None)
    monkeypatch.setattr(
        settings,
        "stripe_checkout_success_url",
        "https://app.feel-y.com/chat.html?checkout=success",
    )
    monkeypatch.setattr(
        settings,
        "stripe_checkout_cancel_url",
        "https://app.feel-y.com/chat.html?checkout=cancelled",
    )
    headers = _register_and_authenticate(client)
    period_end = datetime.now(timezone.utc) + timedelta(days=30)
    checkout_params = []

    checkout_session = {
        "id": "cs_test_feely",
        "mode": "subscription",
        "status": "complete",
        "client_reference_id": "1",
        "customer": "cus_feely",
        "subscription": "sub_feely",
    }
    subscription = {
        "id": "sub_feely",
        "customer": "cus_feely",
        "status": "active",
        "cancel_at_period_end": False,
        "items": {
            "data": [
                {
                    "price": {"id": "price_monthly"},
                    "current_period_end": int(period_end.timestamp()),
                }
            ]
        },
    }
    sessions = SimpleNamespace(
        create=lambda params: (
            checkout_params.append(params)
            or SimpleNamespace(url="https://checkout.stripe.com/c/pay/test")
        ),
        retrieve=lambda session_id: checkout_session,
    )
    stripe_client = SimpleNamespace(
        v1=SimpleNamespace(
            checkout=SimpleNamespace(sessions=sessions),
            subscriptions=SimpleNamespace(retrieve=lambda subscription_id: subscription),
        )
    )
    monkeypatch.setattr(billing_service, "get_stripe_client", lambda: stripe_client)

    checkout_response = client.post(
        "/api/v1/billing/checkout",
        headers=headers,
        json={"plan": "monthly"},
    )
    assert checkout_response.status_code == 200
    assert checkout_params[0]["success_url"].endswith("&session_id={CHECKOUT_SESSION_ID}")

    sync_response = client.post(
        "/api/v1/billing/checkout/sync",
        headers=headers,
        json={"session_id": "cs_test_feely"},
    )
    assert sync_response.status_code == 200
    assert sync_response.json()["premium"] is True
    assert sync_response.json()["plan"] == "monthly"

    checkout_session["client_reference_id"] = "999"
    forbidden_response = client.post(
        "/api/v1/billing/checkout/sync",
        headers=headers,
        json={"session_id": "cs_test_other"},
    )
    assert forbidden_response.status_code == 403


def test_billing_routes_require_authentication(client):
    assert client.get("/api/v1/billing/subscription").status_code == 401
    assert client.post("/api/v1/billing/checkout", json={"plan": "monthly"}).status_code == 401
    assert client.post("/api/v1/billing/portal").status_code == 401
    assert client.post("/api/v1/billing/subscription/resume").status_code == 401


def test_disabled_billing_returns_free_state_and_safe_error(client):
    headers = _register_and_authenticate(client)

    subscription_response = client.get(
        "/api/v1/billing/subscription",
        headers=headers,
    )
    assert subscription_response.status_code == 200
    assert subscription_response.json() == {
        "status": "none",
        "premium": False,
        "free_test_phase": False,
        "my_map_access": False,
        "chat_daily_limit": 10,
        "plan": "free",
        "cancel_at_period_end": False,
        "current_period_end": None,
        "billing_available": False,
        "available_plans": [],
        "management_available": False,
        "can_resume": False,
    }

    checkout_response = client.post(
        "/api/v1/billing/checkout",
        headers=headers,
        json={"plan": "monthly"},
    )
    assert checkout_response.status_code == 503
    assert checkout_response.json() == {"detail": "Stripe billing is not configured."}

    portal_response = client.post("/api/v1/billing/portal", headers=headers)
    assert portal_response.status_code == 503
    assert portal_response.json() == {"detail": "Stripe billing is not configured."}

    resume_response = client.post(
        "/api/v1/billing/subscription/resume",
        headers=headers,
    )
    assert resume_response.status_code == 503
    assert resume_response.json() == {"detail": "Stripe billing is not configured."}


def test_checkout_rejects_unknown_plan_and_client_price(client):
    headers = _register_and_authenticate(client)

    unknown_plan = client.post(
        "/api/v1/billing/checkout",
        headers=headers,
        json={"plan": "weekly"},
    )
    assert unknown_plan.status_code == 422

    arbitrary_price = client.post(
        "/api/v1/billing/checkout",
        headers=headers,
        json={"plan": "monthly", "price_id": "client-controlled-value"},
    )
    assert arbitrary_price.status_code == 422


def test_stripe_webhook_bypasses_feely_basic_auth(monkeypatch, client):
    monkeypatch.setattr(settings, "basic_auth_enabled", True)
    monkeypatch.setattr(settings, "basic_auth_username", "preview")
    monkeypatch.setattr(settings, "basic_auth_password", "protected")

    response = client.post("/api/v1/billing/webhook", content=b"{}")

    assert response.status_code == 503
    assert response.json() == {"detail": "Stripe billing is not configured."}


def test_portal_return_url_accepts_only_trusted_web_origins(monkeypatch):
    monkeypatch.setattr(
        settings,
        "stripe_portal_return_url",
        "https://app.feel-y.com/chat.html",
    )
    monkeypatch.setattr(settings, "public_app_url", "https://app.feel-y.com")
    monkeypatch.setattr(settings, "cors_origins", ["http://127.0.0.1:5500"])

    local_return = "http://127.0.0.1:5500/chat.html?view=account&billing_return=portal"
    assert validated_portal_return_url(local_return) == local_return
    assert validated_portal_return_url(None) == "https://app.feel-y.com/chat.html"

    with pytest.raises(InvalidBillingReturnUrlError, match="not trusted"):
        validated_portal_return_url("https://attacker.example/collect")
    with pytest.raises(InvalidBillingReturnUrlError, match="invalid"):
        validated_portal_return_url("https://user:password@app.feel-y.com/chat.html")


def test_resume_subscription_clears_scheduled_cancellation(monkeypatch, database_engine):
    engine = database_engine
    TestingSession = sessionmaker(bind=engine)
    period_end = datetime.now(timezone.utc) + timedelta(days=20)
    update_calls = []

    def stripe_snapshot(cancel_at_period_end: bool) -> dict:
        return {
            "id": "sub_resume",
            "customer": "cus_resume",
            "status": "active",
            "cancel_at_period_end": cancel_at_period_end,
            "items": {
                "data": [
                    {
                        "price": {"id": "price_monthly"},
                        "current_period_end": int(period_end.timestamp()),
                    }
                ]
            },
        }

    subscriptions = SimpleNamespace(
        retrieve=lambda subscription_id: stripe_snapshot(True),
        update=lambda subscription_id, params: (
            update_calls.append((subscription_id, params)) or stripe_snapshot(False)
        ),
    )
    stripe_client = SimpleNamespace(v1=SimpleNamespace(subscriptions=subscriptions))
    monkeypatch.setattr(billing_service, "get_stripe_client", lambda: stripe_client)
    monkeypatch.setattr(settings, "stripe_enabled", True)
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_example")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_monthly")

    with TestingSession() as db:
        user = User(
            email="resume@example.com",
            username="resume-user",
            hashed_password="not-used-in-this-test",
        )
        db.add(user)
        db.flush()
        db.add(
            BillingSubscription(
                user_id=user.id,
                stripe_customer_id="cus_resume",
                stripe_subscription_id="sub_resume",
                stripe_price_id="price_monthly",
                status="active",
                cancel_at_period_end=True,
                current_period_end=period_end,
            )
        )
        db.commit()

        resumed = resume_subscription(db, user)

        assert resumed.cancel_at_period_end is False
        assert normalize_subscription(resumed)["can_resume"] is False
        assert update_calls == [("sub_resume", {"cancel_at_period_end": False})]


def test_admin_subscription_removal_cancels_stripe_and_local_access(monkeypatch, database_engine):
    engine = database_engine
    TestingSession = sessionmaker(bind=engine)
    cancel_calls = []
    canceled_snapshot = {
        "id": "sub_admin_cancel",
        "customer": "cus_admin_cancel",
        "status": "canceled",
        "cancel_at_period_end": False,
        "items": {"data": [{"price": {"id": "price_monthly"}}]},
    }
    stripe_client = SimpleNamespace(
        v1=SimpleNamespace(
            subscriptions=SimpleNamespace(
                cancel=lambda subscription_id, params: (
                    cancel_calls.append((subscription_id, params)) or canceled_snapshot
                )
            )
        )
    )
    monkeypatch.setattr(billing_service, "get_stripe_client", lambda: stripe_client)

    with TestingSession() as db:
        user = User(
            email="admin-cancel@example.com",
            username="admin-cancel",
            hashed_password="not-used-in-this-test",
        )
        db.add(user)
        db.flush()
        db.add(
            BillingSubscription(
                user_id=user.id,
                stripe_customer_id="cus_admin_cancel",
                stripe_subscription_id="sub_admin_cancel",
                stripe_price_id="price_monthly",
                status="active",
            )
        )
        db.commit()

        removed = remove_subscription_for_admin(db, user)

        assert removed.status == "canceled"
        assert has_premium_access(db, user) is False
        assert cancel_calls == [("sub_admin_cancel", {"invoice_now": False, "prorate": False})]


def test_free_test_phase_unlocks_features_and_blocks_checkout(client, monkeypatch):
    headers = _register_and_authenticate(client)
    monkeypatch.setattr(settings, "premium_features_enabled", False)
    response = client.get("/api/v1/billing/subscription", headers=headers).json()
    assert response["free_test_phase"] is True
    assert response["my_map_access"] is True
    assert response["premium"] is False
    assert response["available_plans"] == []
    assert (
        client.post(
            "/api/v1/billing/checkout", headers=headers, json={"plan": "monthly"}
        ).status_code
        == 409
    )
    monkeypatch.setattr(settings, "premium_features_enabled", True)
    response = client.get("/api/v1/billing/subscription", headers=headers).json()
    assert response["free_test_phase"] is False
    assert response["my_map_access"] is False


def test_reply_reactions_persist_toggle_and_require_chat_owner(client):
    headers = _register_and_authenticate(client)
    reply = client.post(
        "/api/v1/llm/message", headers=headers, json={"context": "I feel uncertain about work."}
    )
    assert reply.status_code == 200
    result = reply.json()
    url = f"/api/v1/llm/chats/{result['chat_id']}"
    stamp = result["chat_info"]["messages"][-1]["created_at"]
    for reaction in ("like", "dislike", None):
        response = client.put(
            url + "/reaction", headers=headers, json={"created_at": stamp, "reaction": reaction}
        )
        assert response.status_code == 200
        assert client.get(url, headers=headers).json()["messages"][-1]["reaction"] == reaction
    assert (
        client.put(
            url + "/reaction", headers=headers, json={"created_at": stamp, "reaction": "invalid"}
        ).status_code
        == 422
    )
    assert (
        client.put(
            url + "/reaction", headers=headers, json={"created_at": "missing", "reaction": "like"}
        ).status_code
        == 404
    )
    client.post(
        "/api/v1/auth/register",
        json={"email": "other@example.com", "username": "other", "password": "secure-password"},
    )
    token = client.post(
        "/api/v1/auth/login",
        json={"email_or_username": "other@example.com", "password": "secure-password"},
    ).json()["access_token"]
    assert (
        client.put(
            url + "/reaction",
            headers={"Authorization": f"Bearer {token}"},
            json={"created_at": stamp, "reaction": "like"},
        ).status_code
        == 404
    )


def test_cancelled_generation_releases_reserved_daily_quota(client, monkeypatch):
    import asyncio
    from fastapi import BackgroundTasks
    from app.api.dependencies import get_db
    from app.api.routes import llm as routes
    from app.models.user import DailyLLMUsage
    from app.schemas.llm import LLMRequest
    from sqlalchemy import select

    _register_and_authenticate(client)

    async def cancel(**kwargs):
        raise asyncio.CancelledError()

    monkeypatch.setattr(routes, "get_chat_llm_client", lambda: SimpleNamespace(respond=cancel))
    generator = client.app.dependency_overrides[get_db]()
    db = next(generator)
    try:
        user = db.scalar(select(User).where(User.email == "billing@example.com"))
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(
                routes.process_llm_message(LLMRequest(context="hello"), BackgroundTasks(), db, user)
            )
        usage = db.scalar(select(DailyLLMUsage).where(DailyLLMUsage.user_id == user.id))
        assert usage.message_count == 0
    finally:
        generator.close()
