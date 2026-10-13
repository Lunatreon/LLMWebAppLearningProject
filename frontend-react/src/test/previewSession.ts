import type { ShellSession } from '../types/navigation';

// Historical Phase 2 layout fixture, used only by tests. Production uses the
// real SessionProvider; this module is not imported by the application.
export const previewSession: ShellSession = {
  mode: 'preview',
  user: { displayName: 'Shell preview', email: 'No account signed in' },
  mapAccess: false,
  journalAccess: false,
  feedbackEnabled: true,
};
