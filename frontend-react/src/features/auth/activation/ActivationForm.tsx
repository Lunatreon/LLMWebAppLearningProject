import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../../hooks/useSession';
import { authDestinationState } from '../authRouteState';
import { useActivation } from './useActivation';

export default function ActivationForm() {
  const activation = useActivation();
  const { session, controller } = useSession();
  const location = useLocation();
  const emailInput = useRef<HTMLInputElement>(null);
  const busy = activation.pending !== null || session.status === 'loading';
  return (
    <section
      id="email-verification-dialog"
      className="app-dialog activation-page"
      aria-labelledby="activation-heading"
    >
      <Link
        className="dialog-close"
        to={{ pathname: '/login', search: location.search }}
        state={{
          ...authDestinationState(location.state, location.search),
          email: activation.email,
        }}
        aria-label="Close"
      >
        ×
      </Link>
      <p className="eyebrow">Your private space</p>
      <h2 id="activation-heading">Activate your account</h2>
      <p>
        Enter the six-digit PIN from your FeelY email. You only need to activate your email once.
      </p>
      <form
        id="email-verification-form"
        aria-label="Activate your account"
        aria-busy={activation.pending !== null}
        onSubmit={(event) => {
          event.preventDefault();
          if (event.currentTarget.reportValidity()) void activation.confirm();
        }}
      >
        <label>
          <span>Email</span>
          <input
            aria-describedby="verification-status"
            id="verification-email"
            ref={emailInput}
            type="email"
            autoComplete="email"
            required
            autoFocus={!activation.email}
            value={activation.email}
            onChange={(event) => activation.setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Activation PIN</span>
          <input
            aria-describedby="verification-status"
            id="verification-pin"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            required
            autoFocus={Boolean(activation.email)}
            value={activation.pin}
            onChange={(event) => activation.setPin(event.target.value)}
          />
        </label>
        <button className="primary-button" type="submit" disabled={busy || activation.verified}>
          {activation.pending === 'confirm' ? 'Activating...' : 'Activate account'}
        </button>
        <button
          id="verification-resend"
          className="auth-link-button"
          type="button"
          disabled={busy || activation.verified}
          onClick={() => {
            if (emailInput.current?.reportValidity()) void activation.resend();
          }}
        >
          Send a new PIN
        </button>
      </form>
      <p id="verification-status" role={activation.failed ? 'alert' : 'status'}>
        {activation.message}
      </p>
      {session.status === 'loading' && <p role="status">Loading your session...</p>}
      {session.status === 'error' && (
        <div role="alert">
          <p>{session.error.message}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void controller.reload({ force: true })}
          >
            Retry session
          </button>
        </div>
      )}
    </section>
  );
}
