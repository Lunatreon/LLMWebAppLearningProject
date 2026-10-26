from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import stripe
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.config import settings
from backend.models.billing import BillingSubscription, ProcessedStripeEvent
from backend.models.user import User
from backend.schemas.billing import SubscriptionStatus

PREMIUM_STATUSES = {
    SubscriptionStatus.ACTIVE,
    SubscriptionStatus.TRIALING,
}


class BillingError(RuntimeError):
    pass


class BillingNotConfiguredError(BillingError):
    pass


class InvalidBillingPlanError(BillingError):
    pass


class BillingProviderError(BillingError):
    pass


class BillingAccountUnavailableError(BillingError):
    pass


class InvalidBillingReturnUrlError(BillingError):
    pass


class InvalidStripeWebhookError(BillingError):
    pass


class StripeWebhookProcessingError(BillingError):
    pass


def _configured(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _url_origin(value: str | None) -> tuple[str, str, int | None] | None:
    """Return a normalized web origin, rejecting credentials and malformed ports."""
    configured = _configured(value)
    if not configured:
        return None
    try:
        parsed = urlsplit(configured)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme.lower() not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        return None
    default_port = 443 if parsed.scheme.lower() == "https" else 80
    return parsed.scheme.lower(), parsed.hostname.lower(), port or default_port


def validated_portal_return_url(requested_url: str | None = None) -> str:
    """Allow dynamic portal returns only to frontend origins trusted by the server."""
    default_url = _configured(settings.stripe_portal_return_url)
    candidate = _configured(requested_url) or default_url
    candidate_origin = _url_origin(candidate)
    if not candidate or candidate_origin is None:
        raise InvalidBillingReturnUrlError("The Stripe return URL is invalid.")

    trusted_values = [
        default_url,
        _configured(settings.public_app_url),
        *settings.cors_origins,
    ]
    trusted_origins = {
        origin for value in trusted_values if (origin := _url_origin(value)) is not None
    }
    if candidate_origin not in trusted_origins:
        raise InvalidBillingReturnUrlError("The Stripe return URL is not trusted.")
    return candidate


def get_stripe_client() -> stripe.StripeClient:
    secret_key = _configured(settings.stripe_secret_key)
    if not settings.stripe_enabled or not secret_key:
        raise BillingNotConfiguredError("Stripe billing is not configured.")
    return stripe.StripeClient(secret_key, max_network_retries=2)


def price_id_for_plan(plan: str) -> str:
    price_by_plan = {
        "monthly": _configured(settings.stripe_price_monthly),
        "yearly": _configured(settings.stripe_price_yearly),
    }
    if plan not in price_by_plan:
        raise InvalidBillingPlanError("Unknown subscription plan.")

    if not settings.stripe_enabled or not _configured(settings.stripe_secret_key):
        raise BillingNotConfiguredError("Stripe billing is not configured.")

    price_id = price_by_plan[plan]
    if not price_id:
        raise InvalidBillingPlanError("Subscription plan is not available.")
    return price_id


def available_plans() -> list[str]:
    if not settings.stripe_checkout_configured:
        return []

    plans: list[str] = []
    if _configured(settings.stripe_price_monthly):
        plans.append("monthly")
    if _configured(settings.stripe_price_yearly):
        plans.append("yearly")
    return plans


def get_subscription(db: Session, user: User) -> BillingSubscription | None:
    return db.scalar(select(BillingSubscription).where(BillingSubscription.user_id == user.id))


def normalized_status(value: str | None) -> SubscriptionStatus:
    try:
        return SubscriptionStatus(value or SubscriptionStatus.NONE.value)
    except ValueError:
        return SubscriptionStatus.NONE


def _utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def subscription_has_premium_access(
    subscription: BillingSubscription | None,
    *,
    now: datetime | None = None,
) -> bool:
    if subscription is None or normalized_status(subscription.status) not in PREMIUM_STATUSES:
        return False

    if subscription.current_period_end is None:
        return True

    checked_at = _utc_datetime(now or datetime.now(timezone.utc))
    return _utc_datetime(subscription.current_period_end) > checked_at


def has_premium_access(
    db: Session,
    user: User,
    *,
    now: datetime | None = None,
) -> bool:
    return subscription_has_premium_access(get_subscription(db, user), now=now)


def has_premium_feature_access(db: Session, user: User) -> bool:
    """Allow a development bypass while requiring a paid state in production."""

    return not settings.premium_features_enabled or has_premium_access(db, user)


def normalize_subscription(
    subscription: BillingSubscription | None,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    status = normalized_status(subscription.status if subscription else None)
    premium = subscription_has_premium_access(subscription, now=now)
    premium_feature_access = not settings.premium_features_enabled or premium
    plan = "free"
    if premium:
        monthly_price_id = _configured(settings.stripe_price_monthly)
        yearly_price_id = _configured(settings.stripe_price_yearly)
        if subscription and monthly_price_id and subscription.stripe_price_id == monthly_price_id:
            plan = "monthly"
        elif subscription and yearly_price_id and subscription.stripe_price_id == yearly_price_id:
            plan = "yearly"
        else:
            plan = "premium"

    configured_plans = available_plans() if settings.premium_features_enabled else []
    return {
        "status": status,
        "premium": premium,
        "free_test_phase": not settings.premium_features_enabled,
        "my_map_access": premium_feature_access,
        "chat_daily_limit": (
            settings.rate_limit_llm_user_per_day
            if premium_feature_access
            else settings.rate_limit_llm_free_user_per_day
        ),
        "plan": plan,
        "cancel_at_period_end": bool(subscription and subscription.cancel_at_period_end),
        "current_period_end": subscription.current_period_end if subscription else None,
        "billing_available": bool(configured_plans),
        "available_plans": configured_plans,
        "management_available": bool(
            settings.stripe_portal_configured and subscription and subscription.stripe_customer_id
        ),
        "can_resume": bool(
            settings.stripe_enabled
            and _configured(settings.stripe_secret_key)
            and subscription
            and subscription.stripe_subscription_id
            and subscription.cancel_at_period_end
        ),
    }


def create_checkout_session(db: Session, user: User, plan: str) -> str:
    price_id = price_id_for_plan(plan)
    success_url = _configured(settings.stripe_checkout_success_url)
    cancel_url = _configured(settings.stripe_checkout_cancel_url)
    if not success_url or not cancel_url:
        raise BillingNotConfiguredError("Stripe billing is not configured.")

    subscription = get_subscription(db, user)
    if "{CHECKOUT_SESSION_ID}" not in success_url:
        separator = "&" if "?" in success_url else "?"
        success_url = f"{success_url}{separator}session_id={{CHECKOUT_SESSION_ID}}"

    params: dict[str, Any] = {
        "mode": "subscription",
        "client_reference_id": str(user.id),
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": success_url,
        "cancel_url": cancel_url,
        "metadata": {"feely_user_id": str(user.id)},
        "subscription_data": {"metadata": {"feely_user_id": str(user.id)}},
    }
    if subscription and subscription.stripe_customer_id:
        params["customer"] = subscription.stripe_customer_id
    else:
        params["customer_email"] = user.email

    try:
        checkout_session = get_stripe_client().v1.checkout.sessions.create(params)
    except stripe.StripeError as exc:
        raise BillingProviderError("Stripe could not create a Checkout session.") from exc

    checkout_url = _configured(checkout_session.url)
    if not checkout_url:
        raise BillingProviderError("Stripe did not return a Checkout URL.")
    return checkout_url


def sync_checkout_session(
    db: Session,
    user: User,
    checkout_session_id: str,
) -> BillingSubscription:
    """Synchronize a completed Checkout session owned by the signed-in user."""

    stripe_client = get_stripe_client()
    try:
        checkout_session = stripe_client.v1.checkout.sessions.retrieve(checkout_session_id)
    except stripe.StripeError as exc:
        raise BillingProviderError("Stripe Checkout session synchronization failed.") from exc

    if (
        _value(checkout_session, "mode") != "subscription"
        or _value(checkout_session, "status") != "complete"
    ):
        raise StripeWebhookProcessingError("Stripe Checkout is not complete.")

    raw_user_id = _value(checkout_session, "client_reference_id")
    try:
        checkout_user_id = int(raw_user_id) if raw_user_id is not None else None
    except (TypeError, ValueError):
        checkout_user_id = None
    checkout_user_id = checkout_user_id or _metadata_user_id(checkout_session)
    if checkout_user_id != user.id:
        raise BillingAccountUnavailableError(
            "Stripe Checkout session does not belong to this account."
        )

    stripe_subscription_id = _stripe_id(_value(checkout_session, "subscription"))
    if not stripe_subscription_id:
        raise StripeWebhookProcessingError("Stripe Checkout has not created a subscription yet.")

    subscription = _sync_subscription_from_stripe(
        db,
        stripe_subscription_id,
        stripe_client,
        user_id=user.id,
    )
    customer_id = _stripe_id(_value(checkout_session, "customer"))
    if customer_id:
        subscription.stripe_customer_id = customer_id
    db.commit()
    db.refresh(subscription)
    return subscription


def create_customer_portal_session(
    db: Session,
    user: User,
    requested_return_url: str | None = None,
) -> str:
    subscription = get_subscription(db, user)
    if not settings.stripe_portal_configured:
        raise BillingNotConfiguredError("Stripe billing is not configured.")
    if subscription is None or not subscription.stripe_customer_id:
        raise BillingAccountUnavailableError("No Stripe customer is associated with this account.")

    return_url = validated_portal_return_url(requested_return_url)

    try:
        portal_session = get_stripe_client().v1.billing_portal.sessions.create(
            {
                "customer": subscription.stripe_customer_id,
                "return_url": return_url,
            }
        )
    except stripe.StripeError as exc:
        raise BillingProviderError("Stripe could not create a customer portal session.") from exc

    portal_url = _configured(portal_session.url)
    if not portal_url:
        raise BillingProviderError("Stripe did not return a customer portal URL.")
    return portal_url


def resume_subscription(db: Session, user: User) -> BillingSubscription:
    """Undo an end-of-period cancellation and refresh the local Stripe snapshot."""
    stripe_client = get_stripe_client()
    subscription = get_subscription(db, user)
    if subscription is None or not subscription.stripe_subscription_id:
        raise BillingAccountUnavailableError(
            "No Stripe subscription is associated with this account."
        )

    try:
        # Retrieve first because a webhook may have changed the state since the page loaded.
        stripe_subscription = stripe_client.v1.subscriptions.retrieve(
            subscription.stripe_subscription_id
        )
        if bool(_value(stripe_subscription, "cancel_at_period_end", False)):
            stripe_subscription = stripe_client.v1.subscriptions.update(
                subscription.stripe_subscription_id,
                {"cancel_at_period_end": False},
            )
    except stripe.StripeError as exc:
        raise BillingProviderError("Stripe could not resume the subscription.") from exc

    updated_subscription = _apply_subscription_object(
        db,
        stripe_subscription,
        user_id=user.id,
    )
    db.commit()
    return updated_subscription


def remove_subscription_for_admin(
    db: Session,
    user: User,
) -> BillingSubscription | None:
    """Cancel the associated Stripe subscription and revoke local Premium access."""

    subscription = get_subscription(db, user)
    if subscription is None:
        return None

    if subscription.stripe_subscription_id:
        try:
            stripe_subscription = get_stripe_client().v1.subscriptions.cancel(
                subscription.stripe_subscription_id,
                {"invoice_now": False, "prorate": False},
            )
        except stripe.StripeError as exc:
            raise BillingProviderError("Stripe subscription cancellation failed.") from exc
        subscription = _apply_subscription_object(
            db,
            stripe_subscription,
            user_id=user.id,
        )
    else:
        subscription.status = SubscriptionStatus.CANCELED.value
        subscription.cancel_at_period_end = False
        subscription.current_period_end = None

    db.commit()
    db.refresh(subscription)
    return subscription


def construct_stripe_event(payload: bytes, signature: str | None) -> Any:
    webhook_secret = _configured(settings.stripe_webhook_secret)
    if not settings.stripe_webhook_configured or not webhook_secret:
        raise BillingNotConfiguredError("Stripe billing is not configured.")
    if not signature:
        raise InvalidStripeWebhookError("Missing Stripe webhook signature.")

    try:
        return get_stripe_client().construct_event(payload, signature, webhook_secret)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        raise InvalidStripeWebhookError("Invalid Stripe webhook signature.") from exc


def _value(value: Any, key: str, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, Mapping):
        return value.get(key, default)
    getter = getattr(value, "get", None)
    if callable(getter):
        return getter(key, default)
    return getattr(value, key, default)


def _nested(value: Any, *keys: str) -> Any:
    current = value
    for key in keys:
        current = _value(current, key)
        if current is None:
            return None
    return current


def _stripe_id(value: Any) -> str | None:
    if isinstance(value, str):
        return _configured(value)
    return _configured(_value(value, "id"))


def _timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return _utc_datetime(value)
    if isinstance(value, str) and value.isdigit():
        value = int(value)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def _metadata_user_id(stripe_object: Any) -> int | None:
    raw_user_id = _nested(stripe_object, "metadata", "feely_user_id")
    try:
        return int(raw_user_id) if raw_user_id is not None else None
    except (TypeError, ValueError):
        return None


def _find_or_create_subscription(
    db: Session,
    stripe_object: Any,
    *,
    user_id: int | None = None,
) -> BillingSubscription:
    stripe_subscription_id = _stripe_id(_value(stripe_object, "id"))
    stripe_customer_id = _stripe_id(_value(stripe_object, "customer"))

    subscription = None
    if stripe_subscription_id:
        subscription = db.scalar(
            select(BillingSubscription).where(
                BillingSubscription.stripe_subscription_id == stripe_subscription_id
            )
        )
    if subscription is None and stripe_customer_id:
        subscription = db.scalar(
            select(BillingSubscription).where(
                BillingSubscription.stripe_customer_id == stripe_customer_id
            )
        )

    resolved_user_id = user_id or _metadata_user_id(stripe_object)
    if subscription is None and resolved_user_id is not None:
        subscription = db.scalar(
            select(BillingSubscription).where(BillingSubscription.user_id == resolved_user_id)
        )
    if subscription is not None:
        return subscription

    if resolved_user_id is None or db.get(User, resolved_user_id) is None:
        raise StripeWebhookProcessingError(
            "Stripe subscription could not be associated with a FeelY user."
        )

    subscription = BillingSubscription(user_id=resolved_user_id)
    db.add(subscription)
    db.flush()
    return subscription


def _apply_subscription_object(
    db: Session,
    stripe_subscription: Any,
    *,
    user_id: int | None = None,
) -> BillingSubscription:
    subscription = _find_or_create_subscription(db, stripe_subscription, user_id=user_id)
    subscription_id = _stripe_id(_value(stripe_subscription, "id"))
    customer_id = _stripe_id(_value(stripe_subscription, "customer"))
    if subscription_id:
        subscription.stripe_subscription_id = subscription_id
    if customer_id:
        subscription.stripe_customer_id = customer_id

    items = _nested(stripe_subscription, "items", "data") or []
    first_item = items[0] if items else None
    price_id = _stripe_id(_value(first_item, "price")) or _stripe_id(_value(first_item, "plan"))
    if price_id:
        subscription.stripe_price_id = price_id

    raw_status = _value(stripe_subscription, "status")
    subscription.status = normalized_status(raw_status).value
    subscription.cancel_at_period_end = bool(
        _value(stripe_subscription, "cancel_at_period_end", False)
    )
    period_end = _value(first_item, "current_period_end") or _value(
        stripe_subscription,
        "current_period_end",
    )
    subscription.current_period_end = _timestamp(period_end)
    return subscription


def _sync_subscription_from_stripe(
    db: Session,
    stripe_subscription_id: str,
    stripe_client: stripe.StripeClient,
    *,
    user_id: int | None = None,
) -> BillingSubscription:
    try:
        stripe_subscription = stripe_client.v1.subscriptions.retrieve(stripe_subscription_id)
    except stripe.StripeError as exc:
        raise BillingProviderError("Stripe subscription synchronization failed.") from exc
    return _apply_subscription_object(db, stripe_subscription, user_id=user_id)


def _handle_checkout_completed(
    db: Session,
    checkout_session: Any,
    stripe_client: stripe.StripeClient,
) -> None:
    if _value(checkout_session, "mode") != "subscription":
        return

    raw_user_id = _value(checkout_session, "client_reference_id")
    try:
        user_id = int(raw_user_id) if raw_user_id is not None else None
    except (TypeError, ValueError):
        user_id = None
    user_id = user_id or _metadata_user_id(checkout_session)
    if user_id is None or db.get(User, user_id) is None:
        raise StripeWebhookProcessingError(
            "Stripe Checkout session could not be associated with a FeelY user."
        )

    subscription = db.scalar(
        select(BillingSubscription).where(BillingSubscription.user_id == user_id)
    )
    if subscription is None:
        subscription = BillingSubscription(user_id=user_id)
        db.add(subscription)

    customer_id = _stripe_id(_value(checkout_session, "customer"))
    stripe_subscription_id = _stripe_id(_value(checkout_session, "subscription"))
    if customer_id:
        subscription.stripe_customer_id = customer_id
    if stripe_subscription_id:
        subscription.stripe_subscription_id = stripe_subscription_id
        db.flush()
        _sync_subscription_from_stripe(
            db,
            stripe_subscription_id,
            stripe_client,
            user_id=user_id,
        )


def _invoice_subscription_id(invoice: Any) -> str | None:
    if _value(_value(invoice, "parent"), "type") == "subscription_details":
        subscription_id = _stripe_id(
            _nested(invoice, "parent", "subscription_details", "subscription")
        )
        if subscription_id:
            return subscription_id
    return _stripe_id(_value(invoice, "subscription"))


def _handle_invoice_event(
    db: Session,
    invoice: Any,
    stripe_client: stripe.StripeClient,
) -> None:
    stripe_subscription_id = _invoice_subscription_id(invoice)
    if stripe_subscription_id:
        _sync_subscription_from_stripe(db, stripe_subscription_id, stripe_client)


def process_stripe_webhook(
    db: Session,
    event: Any,
    *,
    stripe_client: stripe.StripeClient,
) -> bool:
    event_id = _configured(_value(event, "id"))
    event_type = _configured(_value(event, "type"))
    stripe_object = _nested(event, "data", "object")
    if not event_id or not event_type or stripe_object is None:
        raise StripeWebhookProcessingError("Stripe webhook event is incomplete.")

    existing = db.scalar(
        select(ProcessedStripeEvent).where(ProcessedStripeEvent.stripe_event_id == event_id)
    )
    if existing is not None:
        return False

    try:
        if event_type == "checkout.session.completed":
            _handle_checkout_completed(db, stripe_object, stripe_client)
        elif event_type in {
            "customer.subscription.created",
            "customer.subscription.updated",
            "customer.subscription.deleted",
        }:
            stripe_subscription_id = _stripe_id(_value(stripe_object, "id"))
            if not stripe_subscription_id:
                raise StripeWebhookProcessingError(
                    "Stripe subscription event is missing its subscription ID."
                )
            # Fetch current state so out-of-order webhook delivery cannot restore stale access.
            _sync_subscription_from_stripe(
                db,
                stripe_subscription_id,
                stripe_client,
                user_id=_metadata_user_id(stripe_object),
            )
        elif event_type in {"invoice.paid", "invoice.payment_failed"}:
            _handle_invoice_event(db, stripe_object, stripe_client)

        db.add(ProcessedStripeEvent(stripe_event_id=event_id, event_type=event_type))
        db.commit()
    except IntegrityError:
        db.rollback()
        duplicate = db.scalar(
            select(ProcessedStripeEvent).where(ProcessedStripeEvent.stripe_event_id == event_id)
        )
        if duplicate is not None:
            return False
        raise
    except Exception:
        db.rollback()
        raise
    return True
