import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SessionNotice from '../../components/SessionNotice';
import { useSession } from '../../hooks/useSession';
import { workspaceReturnPath, workspaceFromRoute } from '../../utils/routes';
import { useFeedback } from './FeedbackContext';
import type { FeedbackCategory } from './types';

export default function FeedbackPage() {
  const { session, feedback, controller } = useSession();
  const draft = useFeedback();
  const location = useLocation();
  const workspace = workspaceFromRoute('feedback', location.state);
  useEffect(() => {
    draft.clearStatus();
  }, [draft.clearStatus]);
  const authenticated = session.status === 'authenticated';
  const allowed =
    authenticated && !session.termsRequired && feedback.status === 'ready' && feedback.enabled;

  return (
    <div className="messages">
      <section
        id="feedback-dialog"
        className="app-dialog feedback-page"
        aria-labelledby="feedback-heading"
      >
        <Link
          className="dialog-close"
          to={{
            pathname: workspaceReturnPath(workspace, location.state),
            search: location.search,
          }}
          aria-label="Close"
        >
          ×
        </Link>
        <p className="eyebrow">Help shape FeelY</p>
        <h2 id="feedback-heading">Share test feedback</h2>
        <p>
          Your feedback and account email are shared with the FeelY team. Chat messages are not
          attached.
        </p>
        <SessionNotice />
        {authenticated && !session.termsRequired && feedback.status === 'loading' && (
          <p role="status">Checking feedback availability...</p>
        )}
        {authenticated && !session.termsRequired && feedback.status === 'error' && (
          <div role="alert">
            <p>{feedback.error?.message}</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void controller.refreshFeedbackConfig()}
            >
              Retry feedback availability
            </button>
          </div>
        )}
        {allowed && (
          <form
            id="feedback-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (event.currentTarget.reportValidity()) void draft.submit();
            }}
          >
            <label>
              <span>What would you like to share?</span>
              <select
                aria-describedby="feedback-status"
                id="feedback-category"
                value={draft.category}
                onChange={(event) => draft.setCategory(event.target.value as FeedbackCategory)}
              >
                <option value="general">General feedback</option>
                <option value="bug">Something is not working</option>
                <option value="idea">An idea</option>
              </select>
            </label>
            <label>
              <span>Your feedback</span>
              <textarea
                aria-describedby="feedback-status"
                id="feedback-message"
                rows={6}
                minLength={3}
                maxLength={5000}
                required
                autoFocus
                placeholder="Tell us what happened or what could be better..."
                value={draft.message}
                onChange={(event) => draft.setMessage(event.target.value)}
              />
            </label>
            <button
              id="feedback-submit"
              className="primary-button"
              type="submit"
              disabled={draft.submitting}
            >
              Send feedback
            </button>
          </form>
        )}
        <p id="feedback-status" role="status">
          {draft.status ||
            (authenticated && feedback.status === 'ready' && !feedback.enabled
              ? 'Test feedback is currently closed.'
              : '')}
        </p>
      </section>
    </div>
  );
}
