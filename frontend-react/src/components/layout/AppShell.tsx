import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAppearance } from '../../hooks/useAppearance';
import { useSidebar } from '../../hooks/useSidebar';
import { useViewportHeight } from '../../hooks/useViewportHeight';
import { SessionContext } from '../../context/SessionContext';
import { shellSession } from '../../services/shellSession';
import type { ShellSession } from '../../types/navigation';
import { featureFromPath, featureRoutes, workspaceFromRoute } from '../../utils/routes';
import Sidebar from './Sidebar';
import WorkspaceHeader from './WorkspaceHeader';
import { useContext } from 'react';
import TermsGate from '../../features/terms/TermsGate';
import { MapContext } from '../../features/map/MapContext';
import { ReflectionContext } from '../../features/reflection/ReflectionContext';
import { ChatContext } from '../../features/chat/ChatContext';

interface Props {
  session?: ShellSession;
}

export default function AppShell({ session: supplied }: Props) {
  const context = useContext(SessionContext);
  const map = useContext(MapContext);
  const reflection = useContext(ReflectionContext);
  const chat = useContext(ChatContext);
  if (!supplied && !context)
    throw new Error('SessionProvider is required for the application shell.');
  const session = supplied ?? shellSession(context!);
  const location = useLocation();
  const navigate = useNavigate();
  const feature = featureFromPath(location.pathname);
  const visibleFeature = feature === 'reflection' && reflection ? 'map' : feature;
  const workspace = workspaceFromRoute(feature, location.state);
  const sidebar = useSidebar(location.key);
  const appearance = useAppearance();
  useViewportHeight();

  function navigateTo(path: string) {
    sidebar.closeSidebar();
    if (path === '/map' && location.pathname === '/map') void map?.controller.visit();
    navigate(
      { pathname: path, search: location.search },
      {
        replace: path === location.pathname,
        state: { workspace, returnTo: `/${workspace}` },
      },
    );
  }

  const route = visibleFeature ? featureRoutes[visibleFeature] : undefined;
  let title: string;
  if (visibleFeature === 'map') {
    title = 'My Map | FeelY';
  } else if (feature === 'chat' && chat) {
    const conversationTitle =
      chat.snapshot.chats.find((item) => item.chat_id === chat.snapshot.active)?.title ||
      'New conversation';
    title = `${conversationTitle} | FeelY`;
  } else {
    title = `${route?.title ?? 'React preview'} | FeelY`;
  }
  const isMainTab = visibleFeature === 'chat' || visibleFeature === 'map';
  const mapDialogOpen = map?.snapshot.enabled && (map.snapshot.popup || map.snapshot.confirmation);
  const reflectionDialogOpen =
    feature === 'reflection' && reflection?.snapshot.enabled && reflection.snapshot.id;
  const chatDialogOpen =
    feature === 'chat' &&
    chat?.snapshot.enabled &&
    (chat.snapshot.review || chat.snapshot.confirmation);

  return (
    <main
      className="shell"
      inert={Boolean(mapDialogOpen || reflectionDialogOpen || chatDialogOpen)}
      onClick={() => {
        map?.controller.closeMenu();
        chat?.controller.closeMenu();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') chat?.controller.closeMenu();
        if (event.key === 'Escape') map?.controller.closeMenu();
        if (event.key === 'Escape' && sidebar.isOpen) {
          event.preventDefault();
          sidebar.closeSidebar();
        }
      }}
    >
      <title>{title}</title>
      <meta name="theme-color" content={appearance.theme === 'light' ? '#fff4f7' : '#100f13'} />
      <section className="chat-view">
        <button
          id="sidebar-backdrop"
          className={`sidebar-backdrop${sidebar.isOpen ? '' : ' hidden'}`}
          type="button"
          aria-label="Close chat navigation"
          tabIndex={-1}
          hidden={!sidebar.isOpen}
          onClick={sidebar.closeSidebar}
        />
        <Sidebar
          workspace={workspace}
          feature={feature}
          session={session}
          isMobile={sidebar.isMobile}
          isOpen={sidebar.isOpen}
          closeRef={sidebar.closeRef}
          brandRef={sidebar.brandRef}
          onClose={sidebar.closeSidebar}
          onNavigate={navigateTo}
        />
        <section
          id="workspace-panel"
          className={route?.viewClass ?? 'conversation'}
          inert={sidebar.isMobile && sidebar.isOpen}
          role={isMainTab ? 'tabpanel' : 'region'}
          aria-labelledby={isMainTab ? `${visibleFeature}-workspace-button` : 'workspace-heading'}
        >
          <WorkspaceHeader
            feature={visibleFeature}
            sidebarOpen={sidebar.isOpen}
            onOpenSidebar={sidebar.openSidebar}
            menuRef={sidebar.menuRef}
            theme={appearance.theme}
            onToggleTheme={appearance.toggleTheme}
          />
          <TermsGate feature={feature}>
            <Outlet />
          </TermsGate>
        </section>
      </section>
    </main>
  );
}
