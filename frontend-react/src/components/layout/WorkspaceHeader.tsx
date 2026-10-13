import type { ReactNode, Ref } from 'react';
import type { Feature, Theme } from '../../types/navigation';
import { featureRoutes } from '../../utils/routes';
import ThemeToggle from './ThemeToggle';
import { useContext } from 'react';
import { JournalContext } from '../../features/journal/JournalContext';
import { MapContext } from '../../features/map/MapContext';
import { ChatContext } from '../../features/chat/ChatContext';

interface Props {
  feature?: Feature;
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  menuRef: Ref<HTMLButtonElement>;
  theme: Theme;
  onToggleTheme: () => void;
}

export default function WorkspaceHeader({
  feature,
  sidebarOpen,
  onOpenSidebar,
  menuRef,
  theme,
  onToggleTheme,
}: Props) {
  const route = feature ? featureRoutes[feature] : undefined;
  const journal = useContext(JournalContext);
  const map = useContext(MapContext);
  const chat = useContext(ChatContext);
  const menuLabel = feature === 'journal' ? 'Open journal pages' : 'Open conversations';
  let heading: ReactNode = route?.title ?? 'FeelY preview';
  if (feature === 'map') {
    heading = (
      <>
        <span className="map-title-short">My Map</span>
        <span className="map-title-long">
          A map of yourself and your journey, growing from the reflections and connections you
          choose to save.
        </span>
      </>
    );
  } else if (feature === 'chat' && chat) {
    const conversationTitle =
      chat.snapshot.chats.find((item) => item.chat_id === chat.snapshot.active)?.title ||
      'New conversation';
    heading = <span id="chat-title">{conversationTitle}</span>;
  }
  return (
    <header className={`${route?.headerClass ?? 'conversation-header'} workspace-header`}>
      <div className="conversation-heading">
        <button
          ref={menuRef}
          id="sidebar-toggle"
          className="icon-button sidebar-toggle"
          type="button"
          title={menuLabel}
          aria-label={menuLabel}
          aria-expanded={sidebarOpen}
          aria-controls="sidebar"
          onClick={onOpenSidebar}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <div>
          <p className="eyebrow">{route?.eyebrow ?? 'Your private reflection space'}</p>
          <h2 id="workspace-heading">{heading}</h2>
        </div>
      </div>
      <div className="workspace-header-actions">
        {feature === 'map' && map?.snapshot.enabled && (
          <button
            id="add-topic-button"
            className="map-command"
            type="button"
            disabled={
              !map.snapshot.data ||
              map.snapshot.errorStatus === 403 ||
              Boolean(map.snapshot.pending.length)
            }
            onClick={() => map.controller.openTopic()}
          >
            + Add topic
          </button>
        )}
        {feature === 'journal' && journal?.snapshot.enabled && (
          <button
            id="journal-analyse-button"
            className="journal-ai-button"
            type="button"
            disabled={
              journal.snapshot.analysing ||
              journal.snapshot.draft.loading ||
              !journal.snapshot.draft.entry
            }
            onClick={() => void journal.controller.analyse()}
          >
            {journal.snapshot.analysing ? (
              'Finding insights...'
            ) : (
              <>
                <span aria-hidden="true">✦</span> Find map insights
              </>
            )}
          </button>
        )}
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
    </header>
  );
}
