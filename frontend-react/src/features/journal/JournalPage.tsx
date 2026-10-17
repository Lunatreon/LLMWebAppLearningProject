import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';
import { hasJournalAccess } from '../../services/capabilities';
import { useJournal } from './JournalContext';
import { useJournalAutosave } from './useJournalAutosave';
import JournalEditor from './JournalEditor';
import { validDateKey } from './dates';

export default function JournalPage() {
  const { session, controller: sessionController } = useSession();
  const { controller, snapshot } = useJournal();
  const location = useLocation();
  const requestedDate =
    typeof location.state?.journalDate === 'string' && validDateKey(location.state.journalDate)
      ? location.state.journalDate
      : null;
  useJournalAutosave();
  useEffect(() => {
    if (!snapshot.enabled) return;
    if (requestedDate) {
      void controller.loadHistory();
      void controller.open(requestedDate);
    } else void controller.visit();
  }, [controller, snapshot.enabled, requestedDate]);
  const allowed =
    session.status === 'authenticated' &&
    hasJournalAccess(session.subscription) &&
    !snapshot.denied;
  if (!allowed)
    return (
      <div id="journal-paywall" className="journal-paywall">
        <div className="map-paywall">
          <span className="map-paywall-badge">Premium</span>
          <h3>A private page for every day</h3>
          <p>
            Write freely, return to earlier entries, and choose which AI suggestions belong in My
            Map.
          </p>
          <ul>
            <li>Automatic saving while you write</li>
            <li>One clear page per day</li>
            <li>User-confirmed topics, practices, and observations</li>
          </ul>
          <div className="map-paywall-actions">
            <a id="journal-upgrade-button" className="primary-button" href="/account">
              View Premium
            </a>
            <Link
              id="journal-return-chat"
              className="secondary-button"
              to={{ pathname: '/chat', search: location.search }}
            >
              Continue with chat
            </Link>
          </div>
          {snapshot.denied && (
            <button
              className="secondary-button"
              type="button"
              onClick={() => void sessionController.reload({ force: true })}
            >
              Check access again
            </button>
          )}
        </div>
      </div>
    );
  return <JournalEditor />;
}
