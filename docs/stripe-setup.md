# Stripe subscription setup

Stripe billing powers FeelY's Premium entitlement. With premium features enabled, free accounts
receive the configured free chat allowance and see a locked My Map preview. Active and trialing
subscriptions unlock the larger chat allowance, map-informed reflection, and all
My Map API operations.
Topic suggestions and chat-title confirmation remain available without a subscription.

## Architecture

```text
browser -> authenticated FeelY billing API -> Stripe-hosted Checkout / Customer Portal
Stripe  -> signed webhook                  -> FeelY subscription tables
success redirect -> authenticated sync     -> verified Stripe Checkout Session
FeelY features -> has_premium_access()     -> local subscription state
```

The database is the application access authority. Verified Stripe webhooks synchronize the local
subscription row. For immediate access when a webhook is delayed, the success redirect supplies a
Checkout Session ID to an authenticated endpoint; the backend retrieves that session from Stripe,
verifies it belongs to the signed-in FeelY user, and saves the current Subscription. Authenticated
subscription actions also save the fresh object returned by Stripe. FeelY does not collect or
store payment-card data.

## Already prepared

- `billing_subscriptions` stores one nullable Stripe association per FeelY user, normalized status,
  cancellation state, current period end, and timestamps.
- `processed_stripe_events` makes webhook processing idempotent by recording Stripe event IDs in the
  same database transaction as subscription changes.
- State-changing handlers retrieve the current Subscription from Stripe before saving it, so an
  older webhook delivered out of order cannot restore stale access.
- The billing service centralizes subscription reads, Premium checks, plan-to-Price-ID mapping,
  Checkout, Customer Portal, signature verification, and webhook processing.
- Authenticated API endpoints are available at:
  - `GET /api/v1/billing/subscription`
  - `POST /api/v1/billing/checkout`
  - `POST /api/v1/billing/checkout/sync`
  - `POST /api/v1/billing/portal`
  - `POST /api/v1/billing/subscription/resume`
- `POST /api/v1/billing/webhook` is not protected by FeelY bearer/basic authentication. It reads the
  raw body and requires a valid Stripe signature instead.
- Webhook dispatch is prepared for `checkout.session.completed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`.
- The account dialog shows normalized subscription status and the current-period end date.
  Subscription changes and cancellation redirect to Stripe's Customer Portal, where Stripe owns
  the confirmation flow. A scheduled cancellation can be reversed directly in FeelY. Checkout
  and Portal controls stay hidden while unavailable.
- My Map is protected in the backend as well as the browser. Free responses redact map/topic data,
  all `/users/me/map` operations require Premium, and a scheduled cancellation retains access only
  until the paid period ends.
- The official Stripe Python SDK is installed as a backend dependency. Its client is created only
  after billing has been enabled with a server-side secret key.
- Tests cover free-state normalization, local Premium decisions, authentication, disabled behavior,
  plan validation, arbitrary client price rejection, and webhook/basic-auth separation.

The current project does not use a migration framework. Its existing `Base.metadata.create_all()`
startup convention creates the two new tables. Add a real migration (for example, Alembic) before
production schema changes need to be deployed or rolled back predictably.

## Server environment variables

```env
STRIPE_ENABLED=false
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
# Configure at least one recurring Price ID. Monthly and yearly are independently optional.
STRIPE_PRICE_MONTHLY=""
STRIPE_PRICE_YEARLY=""
STRIPE_CHECKOUT_SUCCESS_URL=""
STRIPE_CHECKOUT_CANCEL_URL=""
STRIPE_PORTAL_RETURN_URL=""
PREMIUM_FEATURES_ENABLED=true
RATE_LIMIT_LLM_FREE_USER_PER_DAY=10
RATE_LIMIT_LLM_USER_PER_DAY=400
```

Set `PREMIUM_FEATURES_ENABLED=false` only for a local environment where the paywall should be
bypassed. Do not use that bypass on a public deployment.

Checkout return URLs should identify the result so the frontend can show immediate feedback while
the webhook confirms access. For local development, use:

```env
STRIPE_CHECKOUT_SUCCESS_URL="http://127.0.0.1:5500/chat.html?checkout=success&session_id={CHECKOUT_SESSION_ID}"
STRIPE_CHECKOUT_CANCEL_URL="http://127.0.0.1:5500/chat.html?checkout=cancelled"
STRIPE_PORTAL_RETURN_URL="http://127.0.0.1:5500/chat.html"
```

`{CHECKOUT_SESSION_ID}` must remain literal; Stripe replaces it after Checkout. FeelY appends the
placeholder automatically when it is omitted, but including it explicitly makes the configuration
clear.

`STRIPE_PORTAL_RETURN_URL` is the safe fallback. When the browser opens the Customer Portal, it
sends its exact current page as the requested return URL. The backend accepts that URL only when
its origin is present in `CORS_ORIGINS`, matches `PUBLIC_APP_URL`, or matches the fallback URL.
This lets `localhost`, `127.0.0.1`, and embedded production sites return to the same browser origin,
preserve the login session, and reopen Account settings.

`STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` must never be sent to the frontend, embedded in
JavaScript, committed to Git, or written to logs. All variables above belong to the backend
environment. The frontend learns only normalized availability and subscription state from FeelY.

## Required once the Stripe account exists

1. Create the Stripe business account.
2. Invite the developer through Stripe Team settings with the minimum necessary role.
3. Create the FeelY subscription product.
4. Create one or both recurring Prices after pricing decisions are approved.
5. Copy each configured Price ID into `STRIPE_PRICE_MONTHLY` or `STRIPE_PRICE_YEARLY` on the
   server. At least one is required; the frontend shows only the configured plans.
6. Obtain a restricted test/sandbox server-side secret key and set `STRIPE_SECRET_KEY`.
7. Configure the production webhook URL as `/api/v1/billing/webhook` on the public API origin and
   subscribe it to the prepared event types.
8. Copy that endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
9. Configure the Stripe Customer Portal and its allowed subscription-management behavior.
10. Set the Checkout success/cancel URLs and fallback Portal return URL in the server environment.
11. Test Checkout, webhook retries/signature failures, renewals, failed payments, cancellation,
    account deletion, and Portal flows in Stripe's test/sandbox environment.
12. Set `STRIPE_ENABLED=true` only after the end-to-end test flow succeeds.

Use HTTPS in production. Do not enable Stripe debug logging in production, and do not log webhook
bodies or payment details.

## Decisions intentionally left open

The code does not choose prices, free trials, VAT/tax handling, gross versus net display, refunds,
grace periods, or cancellation policy. Those decisions must be made with the business and tax
advisor, then configured in Stripe and reflected in product requirements. If access policy changes
(for example, allowing `past_due` access for a grace period), change the single
`has_premium_access()` policy rather than scattering checks through features.

## Account-blocked TODOs

- Create the product and real recurring Price objects, then add their IDs.
- Add the real server secret and webhook signing secret using the deployment secret store.
- Register and test the public webhook endpoint in Stripe.
- Configure Customer Portal capabilities and redirect URLs.
- Confirm the selected Stripe API version and webhook payload shapes in the account's Workbench,
  then run signed test events against every prepared handler.
- Decide business/tax/cancellation/trial policy and configure it outside the current code.
- Enable billing and expose payment controls only after sandbox acceptance testing.
