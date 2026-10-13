import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { SessionContext } from '../../context/SessionContext';
import { hasMapAccess } from '../../services/capabilities';
import { MapController } from './MapController';
import type { MapSnapshot } from './MapController';
import { useLocation } from 'react-router-dom';
export const MapContext = createContext<{
  controller: MapController;
  snapshot: MapSnapshot;
} | null>(null);
const noSubscribe = () => () => {};
const empty = () => null;
export function MapProvider({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext);
  const location = useLocation();
  const previousRoute = useRef<string | null>(null);
  const [controller] = useState(() => (session ? new MapController(session.controller) : null));
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? empty,
    controller?.getSnapshot ?? empty,
  );
  useEffect(() => {
    if (!session || !controller) return;
    const state = session.session;
    controller.configure(
      state.token,
      state.status === 'authenticated' && !state.termsRequired && hasMapAccess(state.subscription),
      state.status === 'authenticated' ? state.subscription : null,
    );
  }, [controller, session?.session]);
  useEffect(() => {
    if (!controller) return;
    if (location.pathname === '/reflection') controller.resume(false);
    else if (location.pathname === '/map') {
      if (snapshot?.enabled) {
        if (previousRoute.current === '/reflection') void controller.resume();
        else void controller.visit();
      }
    } else controller.leave();
    previousRoute.current = location.pathname;
  }, [controller, location.pathname, snapshot?.enabled]);
  useEffect(() => () => controller?.stop(), [controller]);
  const owned = Boolean(controller?.isOwnedBy(session?.session.token || null));
  const allowed =
    session?.session.status === 'authenticated' &&
    !session.session.termsRequired &&
    hasMapAccess(session.session.subscription);
  // Project ownership synchronously; effects clear the underlying cache next.
  let safeSnapshot: MapSnapshot | null = null;
  if (snapshot) {
    if (owned) {
      safeSnapshot = { ...snapshot, enabled: snapshot.enabled && allowed };
    } else {
      safeSnapshot = {
        ...snapshot,
        data: null,
        enabled: false,
        denied: false,
        selected: null,
        detailOpen: false,
        popup: null,
        confirmation: null,
        pending: [],
        menu: null,
        error: '',
        errorStatus: null,
        loadError: '',
        loading: false,
      };
    }
  }
  return (
    <MapContext.Provider
      value={controller && safeSnapshot ? { controller, snapshot: safeSnapshot } : null}
    >
      {children}
    </MapContext.Provider>
  );
}
export function useMap() {
  const value = useContext(MapContext);
  if (!value) throw new Error('MapProvider is required.');
  return value;
}
