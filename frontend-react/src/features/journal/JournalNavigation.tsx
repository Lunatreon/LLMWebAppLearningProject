import { useContext } from 'react';
import { JournalContext } from './JournalContext';
import { localDateKey, shiftedDateKey, formattedJournalDate } from './dates';

export default function JournalNavigation({
  allowed,
  onClose,
}: {
  allowed: boolean;
  onClose: () => void;
}) {
  const journal = useContext(JournalContext);
  const state = journal?.snapshot;
  const locked = !allowed || state?.denied;
  const select = (date: string) => {
    void journal?.controller.open(date).then((opened) => {
      if (opened) onClose();
    });
  };
  return (
    <section id="journal-sidebar-content" className="sidebar-context journal-sidebar-content">
      <div className="journal-sidebar-heading">
        <div>
          <p className="eyebrow">Daily writing</p>
          <h2>Your journal</h2>
        </div>
        <span
          className="journal-private-mark"
          title="Private to your account"
          aria-label="Private to your account"
        >
          ●
        </span>
      </div>
      {locked ? (
        <div id="journal-sidebar-locked" className="journal-sidebar-locked">
          <span className="workspace-premium-badge">Pro</span>
          <strong>Journal is a Premium space</strong>
          <p>Unlock daily pages, autosave, and optional map insights.</p>
        </div>
      ) : (
        <div id="journal-sidebar-access" className="journal-sidebar-access">
          <button
            id="journal-today-button"
            className="journal-today-button"
            type="button"
            disabled={!state?.enabled}
            onClick={() => select(localDateKey())}
          >
            <span>Today</span> <small>Open a fresh page</small>
          </button>
          <div className="journal-date-navigation">
            <button
              id="journal-previous-button"
              type="button"
              aria-label="Previous day"
              disabled={!state?.enabled}
              onClick={() => select(shiftedDateKey(state!.selected, -1))}
            >
              ← Previous
            </button>
            <button
              id="journal-next-button"
              type="button"
              aria-label="Next day"
              disabled={!state?.enabled || state.selected >= localDateKey()}
              onClick={() => select(shiftedDateKey(state!.selected, 1))}
            >
              Next →
            </button>
          </div>
          <div className="journal-history-heading">
            <span>Earlier pages</span>
            <span id="journal-entry-count">{state?.history.length ?? 0}</span>
          </div>
          <nav id="journal-entry-list" className="journal-entry-list" aria-label="Journal entries">
            {state?.historyLoading && (
              <p className="empty-state" role="status">
                Loading earlier pages...
              </p>
            )}
            {state?.historyError && (
              <div role="alert">
                <p>{state.historyError}</p>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void journal?.controller.loadHistory()}
                >
                  Retry history
                </button>
              </div>
            )}
            {!state?.historyLoading && !state?.historyError && !state?.history.length && (
              <p className="empty-state">Your saved pages will appear here.</p>
            )}
            {state?.history.map((item) => (
              <button
                key={item.entry_date}
                className={`journal-entry-button${item.entry_date === state.selected ? ' active' : ''}`}
                type="button"
                disabled={!state.enabled}
                aria-current={item.entry_date === state.selected ? 'page' : undefined}
                onClick={() => select(item.entry_date)}
              >
                <strong>
                  {formattedJournalDate(item.entry_date, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </strong>{' '}
                <span>{item.excerpt || `${item.word_count || 0} words`}</span>
              </button>
            ))}
          </nav>
        </div>
      )}
    </section>
  );
}
