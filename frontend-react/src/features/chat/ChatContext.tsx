import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useDocumentVisibility, useMediaQuery } from '@react-hookz/web';
import { SessionContext } from '../../context/SessionContext';
import { MapContext } from '../map/MapContext';
import { ChatController } from './ChatController';
import type { ChatSnapshot } from './types';
export const ChatContext = createContext<{
  controller: ChatController;
  snapshot: ChatSnapshot;
} | null>(null);
const noSubscribe = () => () => {};
const empty = () => null;
export function ChatProvider({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext);
  const map = useContext(MapContext);
  const location = useLocation();
  const visible = useDocumentVisibility();
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [controller] = useState(() =>
    session ? new ChatController(session.controller, map?.controller) : null,
  );
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? empty,
    controller?.getSnapshot ?? empty,
  );
  const source =
    typeof location.state?.chatId === 'string' && location.state.chatId
      ? location.state.chatId
      : null;
  useEffect(() => {
    if (!controller || !session) return;
    const state = session.session;
    controller.configure(
      state.token,
      state.status === 'authenticated' && !state.termsRequired,
      state.status === 'authenticated'
        ? state.subscription.my_map_access
        : snapshot?.mapAccess || false,
    );
  }, [controller, session?.session]);
  useEffect(() => {
    controller?.setVisible(location.pathname === '/chat', visible === false || Boolean(reduced));
  }, [controller, location.pathname, visible, reduced]);
  useEffect(() => {
    if (controller && snapshot?.enabled && location.pathname === '/chat' && source)
      void controller.select(source);
  }, [controller, snapshot?.enabled, location.pathname, source]);
  useEffect(() => {
    if (location.pathname !== '/chat' && location.pathname !== '/terms') controller?.closeReview();
  }, [controller, location.pathname]);
  useEffect(() => () => controller?.stop(), [controller]);
  const owned = Boolean(controller?.isOwnedBy(session?.session.token || null));
  const allowed = session?.session.status === 'authenticated' && !session.session.termsRequired;
  let safe: ChatSnapshot | null = null;
  if (snapshot) {
    if (owned) {
      safe = { ...snapshot, enabled: snapshot.enabled && allowed };
    } else {
      safe = {
        ...snapshot,
        enabled: false,
        active: null,
        chats: [],
        draft: '',
        generation: null,
        review: null,
        confirmation: null,
        error: '',
        listError: '',
      };
    }
  }
  useEffect(() => {
    map?.controller.setChatSource(safe?.active && safe.errorStatus !== 404 ? safe.active : null);
  }, [map?.controller, safe?.active, safe?.errorStatus]);
  return (
    <ChatContext.Provider value={controller && safe ? { controller, snapshot: safe } : null}>
      {children}
    </ChatContext.Provider>
  );
}
export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error('ChatProvider is required.');
  return value;
}
