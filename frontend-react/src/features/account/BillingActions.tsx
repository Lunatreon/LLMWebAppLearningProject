import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import type { SubscriptionResponse } from '../../types/api';

export default function BillingActions({ subscription }: { subscription: SubscriptionResponse }) {
  const { controller } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const request = useRef(false);
  const alive = useRef(false);
  const returnHandled = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function run(
    action: 'monthly' | 'yearly' | 'portal' | 'resume' | 'sync',
    sessionId?: string,
  ) {
    const token = controller.getToken();
    if (request.current || !token) return;
    request.current = true;
    setPending(true);
    setFailed(false);
    setMessage(action === 'sync' ? 'Confirming your payment...' : 'Connecting to billing...');
    const isPlan = action === 'monthly' || action === 'yearly';
    const path = isPlan
      ? '/checkout'
      : action === 'resume'
        ? '/subscription/resume'
        : action === 'sync'
          ? '/checkout/sync'
          : '/portal';
    const returnUrl = new URL('/account', window.location.origin);
    const apiBase = new URLSearchParams(location.search).get('api_base');
    if (!import.meta.env.PROD && apiBase) returnUrl.searchParams.set('api_base', apiBase);
    const body = isPlan
      ? { plan: action }
      : action === 'sync'
        ? { session_id: sessionId }
        : action === 'portal'
          ? { return_url: returnUrl.href }
          : {};
    try {
      const result = await controller.api.request<SubscriptionResponse | { url: string }>(
        `/billing${path}`,
        {
          authenticated: true,
          method: 'POST',
          body: JSON.stringify(body),
        },
      );
      if (!alive.current || controller.getToken() !== token) return;
      if ('url' in result) {
        const url = new URL(result.url);
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error('Billing returned an invalid payment link.');
        window.location.assign(url.href);
      } else {
        if (
          typeof result?.premium !== 'boolean' ||
          typeof result.my_map_access !== 'boolean' ||
          !Array.isArray(result.available_plans)
        )
          throw new Error(
            'Billing returned an invalid subscription. Refresh your account to check its status.',
          );
        controller.applySubscriptionResponse(result, token);
        setMessage(
          action === 'resume'
            ? 'Subscription updated.'
            : result.premium
              ? 'Your Premium subscription is active.'
              : 'Payment received. Subscription confirmation may take a moment; refresh your account to check again.',
        );
      }
    } catch (failure) {
      if (alive.current && controller.getToken() === token) {
        setFailed(true);
        setMessage(
          failure instanceof Error ? failure.message : 'Billing is temporarily unavailable.',
        );
      }
    } finally {
      request.current = false;
      if (alive.current) setPending(false);
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const checkout = params.get('checkout');
    if (!checkout || returnHandled.current) return;
    returnHandled.current = true;
    const sessionId = params.get('session_id');
    params.delete('checkout');
    params.delete('session_id');
    navigate(
      { pathname: '/account', search: params.size ? `?${params}` : '', hash: location.hash },
      { replace: true },
    );
    if (checkout === 'success' && sessionId && /^cs_[A-Za-z0-9_]+$/.test(sessionId))
      void run('sync', sessionId);
    else
      setMessage(
        checkout === 'success'
          ? 'Payment completed. Refresh your account to check your subscription.'
          : 'Checkout was canceled. You were not charged.',
      );
  }, [location.search, location.hash, navigate]);

  return (
    <>
      <div className="billing-actions">
        {!subscription.free_test_phase &&
          !subscription.premium &&
          subscription.billing_available &&
          subscription.available_plans.map((plan) => (
            <button
              key={plan}
              className="primary-button"
              type="button"
              disabled={pending}
              onClick={() => void run(plan)}
            >
              Subscribe {plan}
            </button>
          ))}
        {subscription.management_available && (
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => void run('portal')}
          >
            Manage billing in Stripe
          </button>
        )}
        {subscription.can_resume && (
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => void run('resume')}
          >
            Keep subscription active
          </button>
        )}
      </div>
      {message && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    </>
  );
}
