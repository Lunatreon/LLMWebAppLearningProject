import { useJournal } from './JournalContext';
export default function JournalStatus() {
  const { snapshot } = useJournal();
  return (
    <p
      id="journal-save-status"
      className="journal-save-status"
      role={snapshot.draft.status === 'error' ? 'alert' : 'status'}
      data-state={snapshot.draft.status}
    >
      {snapshot.draft.message}
    </p>
  );
}
