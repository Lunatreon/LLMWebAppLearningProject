import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { useLogin } from './useLogin';
import { authDestinationState, handoffEmail, handoffNotice } from './authRouteState';

export default function LoginForm() {
  const location = useLocation();
  const login = useLogin(handoffEmail(location.state));
  const { session, controller } = useSession();
  const disabled = login.pending || session.status !== 'unauthenticated';
  let statusMessage = '';
  if (session.status === 'loading') {
    statusMessage = 'Loading your session...';
  } else if (session.status === 'unauthenticated') {
    statusMessage = session.message || handoffNotice(location.state);
  }
  return (
    <>
      <form
        id="auth-form"
        className="auth-form"
        method="post"
        aria-label="Login"
        aria-busy={login.pending}
        onSubmit={(event) => {
          event.preventDefault();
          if (event.currentTarget.reportValidity()) void login.submit();
        }}
      >
        <label>
          <span>Email</span>
          <input
            aria-describedby="auth-error auth-status"
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            value={login.email}
            onChange={(event) => login.setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Password</span>
          <input
            aria-describedby="auth-error auth-status"
            id="password"
            type="password"
            autoComplete="current-password"
            minLength={8}
            placeholder="At least 8 characters"
            required
            autoFocus={Boolean(handoffEmail(location.state))}
            value={login.password}
            onChange={(event) => login.setPassword(event.target.value)}
          />
        </label>
        <Link
          id="forgot-password-button"
          className="auth-link-button"
          to={{ pathname: '/forgot-password', search: location.search }}
          state={{ ...authDestinationState(location.state, location.search), email: login.email }}
        >
          Forgot your password?
        </Link>
        <button id="auth-submit" className="primary-button" type="submit" disabled={disabled}>
          {login.pending ? 'Logging in...' : 'Login'}
        </button>
        <p id="auth-error" className="form-error" role="alert">
          {login.error}
        </p>
      </form>
      <p id="auth-status" className="auth-status" role="status">
        {statusMessage}
      </p>
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
      {login.verificationRequired && (
        <p role="status">Enter your PIN or request a new one to activate your account.</p>
      )}
      {(login.canActivate || login.verificationRequired) && (
        <Link
          id="activate-account-button"
          className="auth-link-button"
          to={{ pathname: '/activate', search: location.search }}
          state={{
            ...authDestinationState(location.state, location.search),
            email: login.email,
            ...(login.verificationRequired ? { notice: 'verification-required' } : {}),
          }}
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
