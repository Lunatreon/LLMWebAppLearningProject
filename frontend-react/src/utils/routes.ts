import type { Feature, ShellRouteState, Workspace } from '../types/navigation';

export const featureRoutes = {
  chat: {
    title: 'New conversation',
    eyebrow: 'Current reflection',
    viewClass: 'conversation',
    headerClass: 'conversation-header',
    workspace: 'chat',
  },
  map: {
    title: 'My Map',
    eyebrow: 'Self-authorship',
    viewClass: 'map-view',
    headerClass: 'map-header',
    workspace: 'map',
  },
  journal: {
    title: 'Write and reflect',
    eyebrow: 'Private journal',
    viewClass: 'journal-view',
    headerClass: 'journal-header',
    workspace: 'journal',
  },
  reflection: {
    title: 'What happened when you tried it?',
    eyebrow: 'Review without shame',
    viewClass: 'conversation',
    headerClass: 'conversation-header',
    workspace: 'map',
  },
  account: {
    title: 'Your FeelY space',
    eyebrow: 'Account settings',
    viewClass: 'conversation',
    headerClass: 'conversation-header',
    workspace: null,
  },
  feedback: {
    title: 'Share test feedback',
    eyebrow: 'Help shape FeelY',
    viewClass: 'conversation',
    headerClass: 'conversation-header',
    workspace: null,
  },
  terms: {
    title: 'FeelY terms of use (AGB)',
    eyebrow: 'Terms of use',
    viewClass: 'conversation',
    headerClass: 'conversation-header',
    workspace: null,
  },
} as const;

export function featureFromPath(pathname: string): Feature | undefined {
  const name = pathname.replace(/\/$/, '').slice(1);
  return Object.hasOwn(featureRoutes, name) ? (name as Feature) : undefined;
}

export function workspaceFromRoute(feature: Feature | undefined, state: unknown): Workspace {
  const routeWorkspace = feature ? featureRoutes[feature].workspace : null;
  if (routeWorkspace) return routeWorkspace;
  const value =
    state && typeof state === 'object' ? (state as ShellRouteState).workspace : undefined;
  return value === 'map' || value === 'journal' ? value : 'chat';
}

export function workspaceReturnPath(workspace: Workspace, state: unknown): string {
  const value =
    state && typeof state === 'object' ? (state as ShellRouteState).returnTo : undefined;
  // Only return to a known primary workspace; never trust arbitrary route state.
  return value === '/chat' || value === '/map' || value === '/journal' ? value : `/${workspace}`;
}

export function termsReturnPath(workspace: Workspace, state: unknown): string {
  const value =
    state && typeof state === 'object' ? (state as ShellRouteState).afterTerms : undefined;
  const feature = typeof value === 'string' ? featureFromPath(value) : undefined;
  return feature && feature !== 'terms' ? `/${feature}` : workspaceReturnPath(workspace, state);
}

export function loginReturnPath(state: unknown, search: string): string {
  const value =
    state && typeof state === 'object' ? (state as ShellRouteState).afterLogin : undefined;
  const requested =
    typeof value === 'string' ? value : `/${new URLSearchParams(search).get('view') || 'chat'}`;
  const feature = featureFromPath(requested);
  return feature && feature !== 'terms' ? `/${feature}` : '/chat';
}
