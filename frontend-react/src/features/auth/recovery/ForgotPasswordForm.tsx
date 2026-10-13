import { Link, useLocation } from 'react-router-dom';
import { authDestinationState } from '../authRouteState';
import { recoverySearch } from './resetLink';
import { usePasswordRecovery } from './usePasswordRecovery';

export default function ForgotPasswordForm() {
  const recovery = usePasswordRecovery();
  const location = useLocation();
  return (
    <section
      id="password-reset-dialog"
      className="app-dialog password-reset-dialog recovery-page"
      aria-labelledby="recovery-heading"
    >
      <Link
        className="dialog-close"
        aria-label="Close"
        to={{ pathname: '/login', search: recoverySearch(location.search) }}
        state={{
          ...authDestinationState(location.state, recoverySearch(location.search)),
          email: recovery.email,
        }}
      >
        ×
      </Link>
      <section id="password-reset-request-view">
        <p className="eyebrow">Account recovery</p>
        <h2 id="recovery-heading">Reset your password</h2>
        <p>Enter the email address connected to your FeelY account.</p>
        <form
          id="password-reset-request-form"
          aria-label="Request password reset"
          aria-busy={recovery.pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) void recovery.submit();
          }}
        >
          <label>
            <span>Email</span>
            <input
              aria-describedby="password-reset-status"
              id="password-reset-email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={recovery.email}
              onChange={(event) => recovery.setEmail(event.target.value)}
            />
          </label>
          <button className="primary-button" type="submit" disabled={recovery.pending}>
            Send reset link
          </button>
        </form>
      </section>
      <p
        id="password-reset-status"
        className="form-error"
        role={recovery.failed ? 'alert' : 'status'}
      >
        {recovery.message}
      </p>
    </section>
  );
}
