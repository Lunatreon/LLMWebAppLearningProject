import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { SessionContext } from '../../context/SessionContext';
import { hasJournalAccess } from '../../services/capabilities';
import { JournalController } from './JournalController';
import type { JournalSnapshot } from './types';
import JournalLifecycle from './JournalLifecycle';

export const JournalContext = createContext<{
  controller: JournalController;
  snapshot: JournalSnapshot;
} | null>(null);
const noopSubscribe = () => () => {};
const emptySnapshot = () => null;
export function JournalProvider({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext);
  const [controller] = useState(() => (session ? new JournalController(session.controller) : null));
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    controller?.getSnapshot ?? emptySnapshot,
  );
  useEffect(() => {
    if (!session || !controller) return;
    const state = session.session;
    controller.configure(
      state.token,
      state.status === 'authenticated' &&
        !state.termsRequired &&
        hasJournalAccess(state.subscription),
      state.status === 'authenticated' ? state.subscription : null,
    );
  }, [controller, session?.session]);
  useEffect(() => () => controller?.stop(), [controller]);
  const owned = Boolean(controller?.isOwnedBy(session?.session.token || null));
  const allowed =
    session?.session.status === 'authenticated' &&
    !session.session.termsRequired &&
    hasJournalAccess(session.session.subscription);
  // Keep same-owner drafts through gates; mask another owner's text before effects.
  let safeSnapshot: JournalSnapshot | null = null;
  if (snapshot) {
    if (owned) {
      safeSnapshot = { ...snapshot, enabled: snapshot.enabled && allowed };
    } else {
      safeSnapshot = {
        ...snapshot,
        enabled: false,
        denied: false,
        history: [],
        topics: [],
        dirty: false,
        historyError: '',
        topicsError: '',
        analysing: false,
        deciding: [],
        draft: {
          ...snapshot.draft,
          entry: null,
          text: '',
          baseline: '',
          inflightText: null,
          loadError: '',
          message: 'New page',
          saving: false,
          errorStatus: null,
        },
      };
    }
  }
  return (
    <JournalContext.Provider
      value={controller && safeSnapshot ? { controller, snapshot: safeSnapshot } : null}
    >
      {controller && safeSnapshot && (
        <JournalLifecycle controller={controller} enabled={safeSnapshot.enabled} />
      )}
      {children}
    </JournalContext.Provider>
  );
}
export function useJournal() {
  const context = useContext(JournalContext);
  if (!context) throw new Error('JournalProvider is required.');
  return context;
}
