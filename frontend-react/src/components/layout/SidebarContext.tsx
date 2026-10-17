import type { ShellSession, Workspace } from '../../types/navigation';
import MapSidebar from '../../features/map/MapSidebar';
import ChatConversationList from '../../features/chat/ChatConversationList';

interface Props {
  workspace: Workspace;
  session: ShellSession;
  onNavigate: (path: string) => void;
  onClose: () => void;
}

export default function SidebarContext({ workspace, session, onNavigate, onClose }: Props) {
  if (workspace === 'map') return <MapSidebar allowed={session.mapAccess} onClose={onClose} />;

  return <ChatConversationList onNavigate={() => onNavigate('/chat')} onClose={onClose} />;
}
