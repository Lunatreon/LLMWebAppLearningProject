from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user, get_db
from app.models.user import User
from app.schemas.billing import (
    BillingSessionResponse,
    CheckoutRequest,
    CheckoutSyncRequest,
    PortalSessionRequest,
    SubscriptionResponse,
    WebhookResponse,
)
from app.services.billing import (
    BillingAccountUnavailableError,
    BillingNotConfiguredError,
    BillingProviderError,
    InvalidBillingPlanError,
    InvalidBillingReturnUrlError,
    InvalidStripeWebhookError,
    StripeWebhookProcessingError,
    construct_stripe_event,
    create_checkout_session,
    create_customer_portal_session,
    get_stripe_client,
    get_subscription,
    normalize_subscription,
    process_stripe_webhook,
    resume_subscription,
    sync_checkout_session,
)

router = APIRouter()


def _configuration_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Stripe billing is not configured.",
    )


@router.get("/subscription", response_model=SubscriptionResponse)
def read_subscription(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    return SubscriptionResponse(**normalize_subscription(get_subscription(db, current_user)))


@router.post("/checkout", response_model=BillingSessionResponse)
def start_checkout(
    payload: CheckoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BillingSessionResponse:
    try:
        checkout_url = create_checkout_session(db, current_user, payload.plan)
    except BillingNotConfiguredError:
        raise _configuration_error() from None
    except InvalidBillingPlanError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from None
    except BillingProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe could not create a Checkout session.",
        ) from None
    return BillingSessionResponse(url=checkout_url)


@router.post("/checkout/sync", response_model=SubscriptionResponse)
def sync_checkout_return(
    payload: CheckoutSyncRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    try:
        subscription = sync_checkout_session(db, current_user, payload.session_id)
    except BillingNotConfiguredError:
        raise _configuration_error() from None
    except BillingAccountUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Checkout session is not available for this account.",
        ) from None
    except StripeWebhookProcessingError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from None
    except BillingProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe could not confirm this Checkout session.",
        ) from None
    return SubscriptionResponse(**normalize_subscription(subscription))


@router.post("/portal", response_model=BillingSessionResponse)
def start_customer_portal(
    payload: PortalSessionRequest | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BillingSessionResponse:
    try:
        portal_url = create_customer_portal_session(
            db,
            current_user,
            payload.return_url if payload else None,
        )
    except BillingNotConfiguredError:
        raise _configuration_error() from None
    except InvalidBillingReturnUrlError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from None
    except BillingAccountUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Subscription management is not available for this account.",
        ) from None
    except BillingProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe could not create a Customer Portal session.",
        ) from None
    return BillingSessionResponse(url=portal_url)


@router.post("/subscription/resume", response_model=SubscriptionResponse)
def keep_subscription_active(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SubscriptionResponse:
    try:
        subscription = resume_subscription(db, current_user)
    except BillingNotConfiguredError:
        raise _configuration_error() from None
    except BillingAccountUnavailableError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="There is no subscription cancellation to reverse.",
        ) from None
    except BillingProviderError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe could not keep the subscription active.",
        ) from None
    return SubscriptionResponse(**normalize_subscription(subscription))


@router.post("/webhook", response_model=WebhookResponse)
async def receive_stripe_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> WebhookResponse:
    payload = await request.body()
    signature = request.headers.get("Stripe-Signature")
    try:
        event = construct_stripe_event(payload, signature)
        processed = process_stripe_webhook(
            db,
            event,
            stripe_client=get_stripe_client(),
        )
    except BillingNotConfiguredError:
        raise _configuration_error() from None
    except InvalidStripeWebhookError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook signature.",
        ) from None
    except (BillingProviderError, StripeWebhookProcessingError):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe webhook processing failed.",
        ) from None
    return WebhookResponse(duplicate=not processed)
