import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../../../hooks/useSession';
import { authDestinationState } from '../authRouteState';
import CaptchaWidget from './CaptchaWidget';
import { useRegistration } from './useRegistration';
import { minimumPasswordLength } from '../../../utils/passwordValidation';

export default function RegistrationForm() {
  const registration = useRegistration();
  const { session, controller } = useSession();
  const location = useLocation();
  const { fields, config, created, pending } = registration;
  const change = (field: keyof typeof fields, value: string) =>
    registration.setFields((previous) => ({ ...previous, [field]: value }));
  const terms = config.status === 'ready' ? config.terms : null;
  if (created && !created.is_email_verified)
    return (
      <Navigate
        replace
        to={{ pathname: '/activate', search: location.search }}
        state={{
          ...authDestinationState(location.state, location.search),
          email: created.email,
          notice: 'registered',
        }}
      />
    );
  let termsStatus = 'Loading current terms...';
  if (terms) {
    if (!terms.configured) {
      termsStatus = 'Terms are still being prepared. No acceptance is recorded for the draft.';
    } else if (terms.version?.startsWith('test-')) {
      termsStatus = `Unfinished test terms (${terms.version}). You will need to accept the finished release terms separately.`;
    } else {
      termsStatus = `Version ${terms.version}. Please read the terms and check the box yourself.`;
    }
  }
  return (
    <>
      {created ? (
        <div className="auth-form" aria-label="Registration result">
          <p id="auth-status" className="auth-status" role="status">
            {created.is_email_verified
              ? 'Your account was created. You can now log in.'
              : 'We sent your activation PIN. Check your inbox and spam folder.'}
          </p>
          <p>{created.email}</p>
          <Link
            className="primary-button"
            to={{ pathname: '/login', search: location.search }}
            state={location.state}
          >
            Login
          </Link>
        </div>
      ) : (
        <form
          id="auth-form"
          className="auth-form"
          method="post"
          aria-label="Register"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (event.currentTarget.reportValidity()) void registration.submit();
          }}
        >
          <label>
            <span>Email</span>
            <input
              aria-describedby="auth-error"
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
              value={fields.email}
              onChange={(event) => change('email', event.target.value)}
            />
          </label>
          <label id="username-field">
            <span>Username</span>
            <input
              aria-describedby="auth-error"
              id="username"
              autoComplete="username"
              minLength={3}
              placeholder="How should FeelY call you?"
              required
              value={fields.username}
              onChange={(event) => change('username', event.target.value)}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              aria-describedby="auth-error"
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={minimumPasswordLength}
              placeholder="At least 8 characters"
              required
              value={fields.password}
              onChange={(event) => change('password', event.target.value)}
            />
          </label>
          <label className="bot-field" aria-hidden="true">
            <span>Website</span>
            <input
              aria-describedby="auth-error"
              id="website"
              type="text"
              autoComplete="off"
              tabIndex={-1}
              value={fields.website}
              onChange={(event) => change('website', event.target.value)}
            />
          </label>
          {config.status === 'ready' && (
            <CaptchaWidget
              config={config.captcha}
              resetKey={registration.resetKey}
              onToken={registration.onCaptchaToken}
            />
          )}
          <div id="registration-terms">
            <label className="terms-consent-label">
              <input
                aria-describedby="auth-error"
                id="registration-terms-accepted"
                type="checkbox"
                checked={registration.consent}
                disabled={!terms?.configured || pending}
                required={Boolean(terms?.configured)}
                onChange={(event) => registration.setConsent(event.target.checked)}
              />
              <span>
                I accept the{' '}
                <a
                  id="registration-terms-link"
                  href={terms?.document_url || `/terms${location.search}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  FeelY terms of use (AGB)
                </a>
                .
              </span>
            </label>
            <p id="registration-terms-status" role="status">
              {termsStatus}
            </p>
          </div>
          <button
            id="auth-submit"
            className="primary-button"
            type="submit"
            disabled={pending || config.status !== 'ready' || session.status !== 'unauthenticated'}
          >
            {pending ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      )}
      <p id="auth-error" className="form-error" role="alert">
        {registration.error}
      </p>
      {config.status === 'error' && (
        <div role="alert">
          <p>{config.message}</p>
          <button className="secondary-button" type="button" onClick={registration.retryConfig}>
            Retry registration configuration
          </button>
        </div>
      )}
      {session.status === 'loading' && <p role="status">Loading your session...</p>}
      {session.status === 'error' && (
        <div role="alert">
          <p>{session.error.message}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void controller.reload()}
          >
            Retry session
          </button>
        </div>
      )}
      {registration.error.includes('activation email could not be sent') && (
        <Link
          className="auth-link-button"
          to={{ pathname: '/activate', search: location.search }}
          state={{ ...authDestinationState(location.state, location.search), email: fields.email }}
        >
          Activate account / enter email PIN
        </Link>
      )}
      <p className="privacy-note">Your conversations remain connected to your private account.</p>
      <p className="privacy-note">
        <Link to={{ pathname: '/terms', search: location.search }}>FeelY terms of use (AGB)</Link>.
        Published terms must be accepted before using FeelY.
      </p>
    </>
  );
}
