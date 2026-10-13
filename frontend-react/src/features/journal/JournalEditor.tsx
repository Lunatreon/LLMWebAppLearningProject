import { useJournal } from './JournalContext';
import { formattedJournalDate, journalWordTotal } from './dates';
import JournalStatus from './JournalStatus';
import JournalSuggestions from './JournalSuggestions';
import { Link, useLocation } from 'react-router-dom';
import { useSession } from '../../hooks/useSession';

export default function JournalEditor() {
  const { controller, snapshot } = useJournal();
  const { controller: sessionController, session } = useSession();
  const location = useLocation();
  const words = journalWordTotal(snapshot.draft.text);
  return (
    <div id="journal-workspace" className="journal-workspace">
      <div className="journal-paper">
        <div className="journal-paper-heading">
          <div>
            <p id="journal-full-date" className="eyebrow">
              {formattedJournalDate(snapshot.selected)}
            </p>
            <h3>What is on your mind?</h3>
          </div>
          <JournalStatus />
        </div>
        <textarea
          aria-describedby="journal-save-status"
          id="journal-text"
          className="journal-text"
          maxLength={100000}
          placeholder="Start writing. This page saves automatically..."
          aria-label="Daily journal entry"
          disabled={!snapshot.enabled || snapshot.draft.loading || !snapshot.draft.entry}
          readOnly={snapshot.draft.errorStatus === 403}
          value={snapshot.draft.text}
          onChange={(event) => controller.edit(event.target.value)}
        />
        <div className="journal-paper-footer">
          <span id="journal-word-count">
            {words} {words === 1 ? 'word' : 'words'}
          </span>
          <span>Private to your account</span>
        </div>
        {snapshot.draft.loadError && (
          <button
            className="secondary-button"
            type="button"
            aria-describedby="journal-save-status"
            onClick={() => void controller.open(snapshot.selected)}
          >
            Retry entry
          </button>
        )}
        {snapshot.draft.status === 'error' && snapshot.dirty && (
          <button
            className="secondary-button"
            type="button"
            onClick={() => void controller.flush()}
          >
            Retry save
          </button>
        )}
        {snapshot.draft.errorStatus === 403 && (
          <p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void sessionController.reload({ force: true })}
            >
              Check session again
            </button>
            {snapshot.draft.message.includes('verify your email') && (
              <Link
                className="secondary-button"
                to={{ pathname: '/activate', search: location.search }}
                state={{
                  email: session.status === 'authenticated' ? session.account.email : '',
                  afterLogin: '/journal',
                }}
              >
                Activate account / enter email PIN
              </Link>
            )}
          </p>
        )}
        <JournalSuggestions />
      </div>
    </div>
  );
}
