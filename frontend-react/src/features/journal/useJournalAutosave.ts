import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useJournal } from './JournalContext';

// Browser lifecycle subscriptions are delegated to hooks; editor/navigation
// interaction is exclusively controlled React props/state/Router transitions.
export function useJournalAutosave() {
  const { controller, snapshot } = useJournal();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      snapshot.enabled &&
      snapshot.dirty &&
      snapshot.draft.errorStatus !== 403 &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void controller.flush().then((saved) => {
      if (!active) return;
      // Authorization recovery must remain reachable; provider memory retains
      // that failed draft. Other failed saves keep the user on the Journal page.
      if (saved || controller.getSnapshot().draft.errorStatus === 403) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, controller]);
}
