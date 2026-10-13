import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { Workspace } from '../../types/navigation';

interface Props {
  workspace: Workspace;
  mapAccess: boolean;
  isMobile: boolean;
  onNavigate: (path: string) => void;
}

export default function Navigation({ workspace, mapAccess, isMobile, onNavigate }: Props) {
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const paths = ['/chat', '/map'];

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + paths.length) % paths.length;
    onNavigate(paths[next]);
    // A mobile navigation selection closes the drawer and returns focus to its
    // opener. Keep desktop keyboard focus on the newly selected tab.
    if (!isMobile) tabs.current[next]?.focus();
  }

  return (
    <div className="workspace-switch" role="tablist" aria-label="Workspace view">
      <button
        ref={(node) => {
          tabs.current[0] = node;
        }}
        id="chat-workspace-button"
        type="button"
        role="tab"
        className={workspace === 'chat' ? 'active' : ''}
        aria-selected={workspace === 'chat'}
        aria-controls="workspace-panel"
        tabIndex={workspace === 'map' ? -1 : 0}
        onClick={() => onNavigate('/chat')}
        onKeyDown={(event) => handleKeyDown(event, 0)}
      >
        <svg className="workspace-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 5.5h14v10H9l-4 3v-13Z" />
        </svg>
        <span className="workspace-switch-label">Chat</span>
      </button>
      <button
        ref={(node) => {
          tabs.current[1] = node;
        }}
        id="map-workspace-button"
        type="button"
        role="tab"
        className={`${workspace === 'map' ? 'active' : ''}${!mapAccess ? ' premium-locked' : ''}`}
        aria-selected={workspace === 'map'}
        aria-controls="workspace-panel"
        tabIndex={workspace === 'map' ? 0 : -1}
        title={mapAccess ? 'Open My Map' : 'My Map is included with Premium'}
        onClick={() => onNavigate('/map')}
        onKeyDown={(event) => handleKeyDown(event, 1)}
      >
        <svg className="workspace-switch-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="7" r="2.25" />
          <circle cx="18" cy="6" r="2.25" />
          <circle cx="14" cy="18" r="2.25" />
          <path d="m8 7 7.8-.8M7.5 9l5.2 7M17 8l-2 7.8" />
        </svg>
        <span className="workspace-switch-label">Map</span>
        <span
          id="map-plan-badge"
          className="workspace-premium-badge"
          aria-hidden="true"
          hidden={mapAccess}
        >
          ✦
        </span>
      </button>
    </div>
  );
}
