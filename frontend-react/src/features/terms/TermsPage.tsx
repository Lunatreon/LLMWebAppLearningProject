import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import SessionNotice from '../../components/SessionNotice';
import { useSession } from '../../hooks/useSession';
import { termsReturnPath, workspaceFromRoute } from '../../utils/routes';
import { loadCurrentTerms } from './termsApi';
import TermsReview from './TermsReview';
import { isPublishedTerms } from './types';
import type { TermsConfiguration } from './types';
import { useTermsAcceptance } from './useTermsAcceptance';
import { reflectionPracticeId } from '../reflection/types';
import { legacySignInUrl } from '../../services/config';

type PublicState =
  | { status: 'loading' }
  | { status: 'ready'; current: TermsConfiguration }
  | { status: 'error'; message: string };

export default function TermsPage() {
  const { session, controller } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const workspace = workspaceFromRoute('terms', location.state);
  const returnTo = termsReturnPath(workspace, location.state);
  const returnState = {
    workspace,
    ...(returnTo === '/reflection' && reflectionPracticeId(location.state)
      ? { practiceId: reflectionPracticeId(location.state), reflectionResume: true }
      : {}),
  };
  const mutation = useTermsAcceptance();
  const [publicState, setPublicState] = useState<PublicState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Explicit/manual entry must check the latest publication, not a cached version.
  useEffect(() => {
    if (controller.getToken()) void controller.reload();
  }, [controller]);
  const unauthenticated = session.status === 'unauthenticated';
  useEffect(() => {
    if (!unauthenticated) return;
    let active = true;
    setPublicState({ status: 'loading' });
    loadCurrentTerms(controller.api)
      .then((current) => {
        if (active) setPublicState({ status: 'ready', current });
      })
      .catch((error) => {
        if (active)
          setPublicState({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      active = false;
    };
  }, [unauthenticated, controller, attempt]);

  let current: TermsConfiguration | null = null;
  if (session.status === 'authenticated') {
    current = session.terms.current;
  } else if (unauthenticated && publicState.status === 'ready') {
    current = publicState.current;
  }
  const needsReview = session.status === 'authenticated' && session.termsRequired;

  return (
    <div className="messages">
      <section id="terms-review" className="app-dialog terms-page" aria-labelledby="terms-heading">
        {needsReview && current && isPublishedTerms(current) ? (
          <TermsReview
            key={JSON.stringify([
              session.token,
              current.version,
              current.document_sha256,
              current.document_url,
            ])}
            current={current}
            pending={mutation.pending}
            error={mutation.error}
            onSignOut={() => controller.signOut()}
            onAccept={() => {
              void mutation.submit(current).then((accepted) => {
                if (accepted)
                  navigate(
                    { pathname: returnTo, search: location.search },
                    { replace: true, state: returnState },
                  );
              });
            }}
          />
        ) : (
          <div className="terms-review-form">
            <h2 id="terms-heading">FeelY terms of use (AGB)</h2>
            <SessionNotice />
            {mutation.error && <p role="alert">{mutation.error}</p>}
            {unauthenticated && publicState.status === 'loading' && (
              <p role="status">Loading current terms…</p>
            )}
            {unauthenticated && publicState.status === 'error' && (
              <div role="alert">
                <p>{publicState.message}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry terms
                </button>
              </div>
            )}
            {current && (
              <>
                <p role="status">
                  {isPublishedTerms(current)
                    ? `Current version: ${current.version}`
                    : 'The FeelY terms are being prepared and have not been published yet.'}
                </p>
                {isPublishedTerms(current) && (
                  <p>
                    <a href={current.document_url} target="_blank" rel="noopener noreferrer">
                      Read / save current terms
                    </a>
                  </p>
                )}
                {session.status === 'authenticated' && session.terms.accepted_current && (
                  <p>You have accepted the current terms.</p>
                )}
                {needsReview && !isPublishedTerms(current) && (
                  <p role="alert">The terms could not be loaded. Please try again.</p>
                )}
              </>
            )}
            {!needsReview && (
              <p>
                <Link
                  className="secondary-button"
                  to={{ pathname: returnTo, search: location.search }}
                  state={returnState}
                >
                  Return to FeelY
                </Link>
              </p>
            )}
          </div>
        )}
      </section>
      <p>
        <a
          href={new URL('legal/agb-draft.html', legacySignInUrl()).href}
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview updated German AGB draft (unfinished)
        </a>
      </p>
    </div>
  );
}
