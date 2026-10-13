import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { SessionContext } from '../../context/SessionContext';
import { MapContext } from '../map/MapContext';
import { hasMapAccess } from '../../services/capabilities';
import { ReflectionController } from './ReflectionController';
import { practiceSource, reflectionPracticeId } from './types';
import type { ReflectionSnapshot } from './types';
import type { MapEntry } from '../../types/map';
export const ReflectionContext = createContext<{
  controller: ReflectionController;
  snapshot: ReflectionSnapshot;
  practice: MapEntry | null;
} | null>(null);
const noSubscribe = () => () => {};
const empty = () => null;
export function ReflectionProvider({ children }: { children: ReactNode }) {
  const session = useContext(SessionContext),
    map = useContext(MapContext),
    location = useLocation();
  const previous = useRef<string | null>(null);
  const [controller] = useState(() =>
    session && map ? new ReflectionController(session.controller, map.controller) : null,
  );
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? empty,
    controller?.getSnapshot ?? empty,
  );
  const id = reflectionPracticeId(location.state);
  useEffect(() => {
    if (!session || !map || !controller) return;
    const state = session.session;
    controller.configure(
      state.token,
      state.status === 'authenticated' &&
        !state.termsRequired &&
        hasMapAccess(state.subscription) &&
        !map.snapshot.denied,
    );
  }, [controller, session?.session, map?.snapshot.denied]);
  useEffect(() => {
    if (!controller) return;
    if (location.pathname === '/reflection' && snapshot?.enabled) {
      const reset = previous.current !== '/reflection' && location.state?.reflectionResume !== true;
      void controller.open(id, reset);
    } else if (location.pathname !== '/reflection') controller.leave();
    previous.current = location.pathname;
  }, [controller, location.pathname, id, snapshot?.enabled]);
  useEffect(() => {
    controller?.synchronize();
  }, [controller, map?.snapshot.data]);
  useEffect(() => () => controller?.stop(), [controller]);
  const owned = Boolean(controller?.isOwnedBy(session?.session.token || null));
  const allowed =
    session?.session.status === 'authenticated' &&
    !session.session.termsRequired &&
    hasMapAccess(session.session.subscription) &&
    !map?.snapshot.denied;
  const safeSnapshot = snapshot
    ? {
        ...snapshot,
        ...(owned ? {} : { id: null, answer: '' }),
        enabled: snapshot.enabled && owned && allowed,
      }
    : null;
  return (
    <ReflectionContext.Provider
      value={
        controller && safeSnapshot
          ? {
              controller,
              snapshot: safeSnapshot,
              practice: owned ? practiceSource(map?.snapshot.data || null, safeSnapshot.id) : null,
            }
          : null
      }
    >
      {children}
    </ReflectionContext.Provider>
  );
}
export function useReflection() {
  const value = useContext(ReflectionContext);
  if (!value) throw new Error('ReflectionProvider is required.');
  return value;
}
