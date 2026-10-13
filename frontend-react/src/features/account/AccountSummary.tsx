import type { AccountResponse, SubscriptionResponse } from '../../types/api';
import { referenceAccountUrl } from '../../services/referenceFrontend';

export function AccountHeader({ account }: { account?: AccountResponse }) {
  const avatar =
    (account?.display_name || account?.username || account?.email || 'Y')
      .trim()
      .charAt(0)
      .toUpperCase() || 'Y';
  return (
    <header className="account-dialog-header">
      <span id="account-dialog-avatar" className="account-dialog-avatar" aria-hidden="true">
        {avatar}
      </span>
      <div>
        <p className="eyebrow eyebrow-light">Account settings</p>
        <h2>Your FeelY space</h2>
        <p>Manage your profile, security, and subscription in one place.</p>
      </div>
    </header>
  );
}

function billingDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export default function AccountSummary({ subscription }: { subscription: SubscriptionResponse }) {
  const plans: Record<string, string> = {
    free: 'Free',
    monthly: 'Premium monthly',
    yearly: 'Premium yearly',
    premium: 'Premium',
  };
  const statuses: Record<string, string> = {
    none: 'No subscription',
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Payment past due',
    unpaid: 'Unpaid',
    canceled: 'Canceled',
    incomplete: 'Incomplete',
    incomplete_expired: 'Expired',
    paused: 'Paused',
  };
  const periodEnd = billingDate(subscription.current_period_end);
  let periodLabel = 'Current period ends';
  if (subscription.cancel_at_period_end) {
    periodLabel = 'Premium access ends';
  } else if (subscription.status === 'canceled') {
    periodLabel = 'Subscription ended';
  }
  const status = subscription.cancel_at_period_end
    ? 'Cancellation scheduled'
    : statuses[subscription.status] || 'Unknown';
  let note: string;
  if (subscription.free_test_phase) {
    note =
      'All features are free during the test phase. Existing subscriptions can still be managed below.';
  } else if (subscription.premium && subscription.cancel_at_period_end) {
    note = periodEnd
      ? `Your subscription is scheduled to cancel. Premium remains active until ${periodEnd}.`
      : 'Your subscription is scheduled to cancel after the paid period ends.';
  } else if (subscription.status === 'canceled') {
    note = 'Your subscription has ended and will not renew.';
  } else if (['past_due', 'unpaid'].includes(subscription.status)) {
    note = 'Your latest payment needs attention. Open billing to update it.';
  } else if (subscription.premium) {
    note = 'Your Premium subscription is active.';
  } else if (!subscription.billing_available) {
    note = 'Premium subscriptions are not available yet.';
  } else {
    note = 'You are currently using the Free plan.';
  }
  return (
    <section className="account-section account-billing" aria-labelledby="billing-heading">
      <div className="account-section-heading">
        <div>
          <p className="eyebrow">Subscription</p>
          <h3 id="billing-heading">
            Current plan:{' '}
            <span id="billing-plan">
              {subscription.free_test_phase ? 'Now for free' : plans[subscription.plan] || 'Free'}
            </span>
          </h3>
        </div>
        <p>Stripe securely handles payment details and cancellation.</p>
      </div>
      <p id="billing-status" className="billing-status" role="status">
        {note}
      </p>
      <ul className="premium-benefits">
        <li>Extended daily chat access</li>
        <li>Reflection informed by your saved insights</li>
        <li>Full access to My Map, topics, and practices</li>
      </ul>
      <dl className="billing-details">
        <div className="billing-detail">
          <dt>Status</dt>
          <dd id="billing-subscription-status">{status}</dd>
        </div>
        {periodEnd && (
          <div className="billing-detail">
            <dt>{periodLabel}</dt>
            <dd>{periodEnd}</dd>
          </div>
        )}
      </dl>
      <div className="billing-actions">
        <a
          className="secondary-button"
          href={referenceAccountUrl()}
          target="_blank"
          rel="noopener noreferrer"
        >
          {subscription.management_available
            ? 'Manage billing in Stripe'
            : 'Billing / Subscription'}
        </a>
      </div>
    </section>
  );
}
