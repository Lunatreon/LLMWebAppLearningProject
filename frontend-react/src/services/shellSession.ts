import type { SessionContextValue } from '../context/SessionContext';
import type { ShellSession } from '../types/navigation';
import { hasJournalAccess, hasMapAccess } from './capabilities';

export function shellSession(context: SessionContextValue): ShellSession {
  const { session, feedback, controller } = context;
  if (session.status === 'authenticated') {
    return {
      mode: 'authenticated',
      user: {
        displayName: session.account.display_name || session.account.username || 'Your space',
        email: session.account.email,
      },
      mapAccess: hasMapAccess(session.subscription),
      journalAccess: hasJournalAccess(session.subscription),
      feedbackEnabled: feedback.enabled,
      onSignOut: () => controller.signOut(),
    };
  }
  let statusMessage = 'No account signed in';
  if (session.status === 'loading') {
    statusMessage = 'Loading session...';
  } else if (session.status === 'error') {
    statusMessage = 'Session unavailable';
  }
  return {
    mode: session.status,
    user: {
      displayName: 'Your space',
      email: statusMessage,
    },
    mapAccess: false,
    journalAccess: false,
    feedbackEnabled: false,
  };
}
