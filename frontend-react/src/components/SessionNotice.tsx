import { useContext } from 'react';
import { SessionContext } from '../context/SessionContext';
import { Link, useLocation } from 'react-router-dom';
import { featureFromPath, termsReturnPath, workspaceFromRoute } from '../utils/routes';
import { reflectionPracticeId } from '../features/reflection/types';

export default function SessionNotice() {
  const location = useLocation();
  const context = useContext(SessionContext);
  if (!context) return null; // Layout-only tests inject a shell fixture.
  const { session, controller } = context;
  const workspace = workspaceFromRoute(featureFromPath(location.pathname), location.state);
  if (session.status === 'authenticated' && !session.termsRequired) return null;
  if (session.status === 'loading') return <p role="status">Loading your session...</p>;
  if (session.status === 'error')
    return (
      <div role="alert">
        <p>{session.error.message}</p>
        <button className="secondary-button" type="button" onClick={() => void controller.reload()}>
          Retry session
        </button>
      </div>
    );
  return (
    <div>
      <p role="status">
        {session.status === 'unauthenticated'
          ? session.message || 'Sign in to use your FeelY account.'
          : 'Please accept the current FeelY AGB before continuing.'}
      </p>
      <p>
        {session.status === 'authenticated' ? (
          <Link
            className="secondary-button"
            to={{ pathname: '/terms', search: location.search }}
            state={{
              workspace: workspaceFromRoute(featureFromPath(location.pathname), location.state),
              afterTerms: location.pathname,
              ...(location.pathname === '/reflection' && reflectionPracticeId(location.state)
                ? { practiceId: reflectionPracticeId(location.state), reflectionResume: true }
                : {}),
            }}
          >
            Review terms
          </Link>
        ) : (
          <Link
            className="secondary-button"
            to={{ pathname: '/login', search: location.search }}
            state={{
              afterLogin:
                location.pathname === '/terms'
                  ? termsReturnPath(workspace, location.state)
                  : location.pathname,
              workspace,
            }}
          >
            Sign in
          </Link>
        )}
      </p>
      <button className="secondary-button" type="button" onClick={() => void controller.reload()}>
        Check session again
      </button>
    </div>
  );
}
