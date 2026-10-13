import { useRef } from 'react';
import type { KeyboardEvent, Ref, RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { Feature, ShellSession, Workspace } from '../../types/navigation';
import Navigation from './Navigation';
import SidebarContext from './SidebarContext';

interface Props {
  workspace: Workspace;
  feature?: Feature;
  session: ShellSession;
  isMobile: boolean;
  isOpen: boolean;
  closeRef: Ref<HTMLButtonElement>;
  brandRef: RefObject<HTMLAnchorElement | null>;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

export default function Sidebar({
  workspace,
  feature,
  session,
  isMobile,
  isOpen,
  closeRef,
  brandRef,
  onClose,
  onNavigate,
}: Props) {
  const location = useLocation();
  const accountRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const canSignOut = session.mode === 'authenticated' && Boolean(session.onSignOut);

  function keepDrawerFocus(event: KeyboardEvent<HTMLElement>) {
    if (!isMobile || !isOpen || event.key !== 'Tab') return;
    const last = canSignOut ? signOutRef.current : accountRef.current;
    if (event.shiftKey && event.target === brandRef.current) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && event.target === last) {
      event.preventDefault();
      brandRef.current?.focus();
    }
  }

  return (
    <aside
      id="sidebar"
      className={`sidebar${isOpen ? ' open' : ''}`}
      aria-label="Chat navigation"
      aria-hidden={isMobile && !isOpen}
      inert={isMobile && !isOpen}
      onKeyDown={keepDrawerFocus}
    >
      <div className="sidebar-brand-row">
        <Link
          ref={brandRef}
          className="brand-lockup brand-lockup-light"
          to={{ pathname: '/chat', search: location.search }}
          aria-label="FeelY chat"
          onClick={onClose}
        >
          <span className="brand-symbol" aria-hidden="true">
            F
          </span>
          <span>FeelY</span>
        </Link>
        <button
          ref={closeRef}
          id="sidebar-close"
          className="icon-button sidebar-close"
          type="button"
          title="Close navigation"
          aria-label="Close navigation"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="sidebar-tagline">Become your own creation.</p>
      <Navigation
        workspace={workspace}
        mapAccess={session.mapAccess}
        isMobile={isMobile}
        onNavigate={onNavigate}
      />
      <SidebarContext
        workspace={workspace}
        session={session}
        onNavigate={onNavigate}
        onClose={onClose}
      />
      <button
        id="journal-workspace-button"
        className={`sidebar-journal-link${workspace === 'journal' ? ' active' : ''}`}
        type="button"
        aria-pressed={workspace === 'journal'}
        title={session.journalAccess ? 'Open Journal' : 'Journal is included with Premium'}
        onClick={() => onNavigate('/journal')}
      >
        <span aria-hidden="true">✎</span> Journal
        <span
          id="journal-plan-badge"
          className="workspace-premium-badge"
          hidden={session.journalAccess}
          aria-hidden="true"
        >
          ✦
        </span>
      </button>
      <button
        id="feedback-button"
        className={`sidebar-feedback-link${feature === 'feedback' ? ' active' : ''}`}
        type="button"
        hidden={!session.feedbackEnabled}
        aria-current={feature === 'feedback' ? 'page' : undefined}
        onClick={() => onNavigate('/feedback')}
      >
        Share test feedback
      </button>
      <div className="sidebar-profile">
        <span id="user-avatar" className="user-avatar" aria-hidden="true">
          {session.user.displayName.charAt(0) || 'Y'}
        </span>
        <div className="user-copy">
          <strong id="user-name">{session.user.displayName}</strong>
          <span id="user-email">{session.user.email}</span>
        </div>
        <button
          ref={accountRef}
          id="account-button"
          className="icon-button"
          type="button"
          title="Account settings"
          aria-label="Account settings"
          aria-current={feature === 'account' ? 'page' : undefined}
          onClick={() => onNavigate('/account')}
        >
          <span aria-hidden="true">⚙</span>
        </button>
        <button
          ref={signOutRef}
          id="logout-button"
          className="icon-button"
          type="button"
          disabled={!canSignOut}
          title={canSignOut ? 'Sign out' : 'Sign out is unavailable until you sign in'}
          aria-label="Sign out"
          onClick={session.onSignOut}
        >
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </aside>
  );
}
