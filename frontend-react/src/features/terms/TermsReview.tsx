import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { PublishedTerms } from './types';

interface Props {
  current: PublishedTerms;
  pending: boolean;
  error: string;
  onAccept: () => void;
  onSignOut: () => void;
}

// Presentation only: reusable later inside a modal, with no own capability model.
export default function TermsReview({ current, pending, error, onAccept, onSignOut }: Props) {
  const location = useLocation();
  const [checked, setChecked] = useState(false);
  return (
    <form
      className="terms-review-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (checked && !pending) onAccept();
      }}
    >
      <h2 id="terms-heading">FeelY terms of use (AGB)</h2>
      <p>Please read and accept the current terms before continuing.</p>
      <p>
        <a
          id="terms-document"
          href={current.document_url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Read / save the terms ({current.version})
        </a>
      </p>
      <label className="terms-consent-label">
        <input
          id="terms-consent"
          type="checkbox"
          required
          checked={checked}
          disabled={pending}
          onChange={(event) => setChecked(event.target.checked)}
        />
        <span>I accept this version of the FeelY terms of use (AGB).</span>
      </label>
      <p id="terms-error" role="alert">
        {error}
      </p>
      <button
        className="primary-button"
        id="terms-continue"
        type="submit"
        disabled={!checked || pending}
      >
        Accept and continue
      </button>
      <button className="secondary-button" id="terms-signout" type="button" onClick={onSignOut}>
        Sign out
      </button>
      <p>
        You can{' '}
        <Link
          id="terms-account"
          className="auth-link-button"
          to={{ pathname: '/account', search: location.search }}
        >
          manage or delete your account
        </Link>{' '}
        or{' '}
        <Link
          id="terms-billing"
          className="auth-link-button"
          to={{ pathname: '/account', search: location.search }}
        >
          manage your subscription
        </Link>{' '}
        without accepting.
      </p>
    </form>
  );
}
