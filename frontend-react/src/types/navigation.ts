export type Workspace = 'chat' | 'map';
export type Feature = Workspace | 'reflection' | 'account' | 'feedback' | 'terms';
export type Theme = 'dark' | 'light';

// Shared layout accepts real session-derived data; preview is only a test fixture.
export interface ShellSession {
  mode: 'preview' | 'authenticated' | 'loading' | 'unauthenticated' | 'error';
  user: { displayName: string; email: string };
  mapAccess: boolean;
  feedbackEnabled: boolean;
  onSignOut?: () => void;
}

export interface ShellRouteState {
  workspace?: Workspace;
  returnTo?: string;
  afterTerms?: string;
  afterLogin?: string;
}
