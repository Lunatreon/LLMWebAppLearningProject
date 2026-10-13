import { Link, useLocation } from 'react-router-dom';
import { minimumPasswordLength } from '../../../utils/passwordValidation';
import { authDestinationState } from '../authRouteState';
import { recoverySearch } from './resetLink';
import { usePasswordReset } from './usePasswordReset';

export default function ResetPasswordForm() {
  const reset = usePasswordReset();
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
        state={authDestinationState(location.state, recoverySearch(location.search))}
      >
        ×
      </Link>
      <section id="password-reset-confirm-view">
        <p className="eyebrow">Choose a new password</p>
        <h2 id="recovery-heading">Reset your password</h2>
        <form
          id="password-reset-confirm-form"
          aria-label="Reset password"
          aria-busy={reset.pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) void reset.submit();
          }}
        >
          <label>
            <span>New password</span>
            <input
              aria-describedby="password-reset-status"
              id="password-reset-new"
              type="password"
              autoComplete="new-password"
              required
              minLength={minimumPasswordLength}
              autoFocus
              value={reset.password}
              onChange={(event) => reset.setPassword(event.target.value)}
            />
          </label>
          <label>
            <span>Confirm new password</span>
            <input
              aria-describedby="password-reset-status"
              id="password-reset-confirm"
              type="password"
              autoComplete="new-password"
              required
              minLength={minimumPasswordLength}
              value={reset.confirmation}
              onChange={(event) => reset.setConfirmation(event.target.value)}
            />
          </label>
          <button
            className="primary-button"
            type="submit"
            disabled={reset.pending || reset.done || Boolean(reset.problem)}
          >
            Save new password
          </button>
        </form>
      </section>
      <p
        id="password-reset-status"
        className="form-error"
        role={reset.failed || reset.problem ? 'alert' : 'status'}
      >
        {reset.message || reset.problem}
      </p>
      {reset.problem && (
        <p>
          <Link
            className="secondary-button"
            to={{ pathname: '/forgot-password', search: recoverySearch(location.search) }}
            state={authDestinationState(location.state, recoverySearch(location.search))}
          >
            Request a new reset link
          </Link>
        </p>
      )}
    </section>
  );
}
