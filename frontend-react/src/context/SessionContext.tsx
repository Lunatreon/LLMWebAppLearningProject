import { createContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { resolveApiBase } from '../services/config';
import { SessionController } from '../services/sessionController';
import type { SessionSnapshot } from '../services/sessionController';

export interface SessionContextValue extends SessionSnapshot {
  controller: SessionController;
}
export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  children,
  controller: supplied,
}: {
  children: ReactNode;
  controller?: SessionController;
}) {
  const [controller] = useState(() => supplied ?? new SessionController(resolveApiBase()));
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    void controller.reload();
    void controller.refreshFeedbackConfig();
    const onReturn = () => {
      if (document.visibilityState !== 'hidden') void controller.validateOnReturn();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'feely_token' || event.key === null) void controller.reload();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
      window.removeEventListener('storage', onStorage);
      controller.stop();
    };
  }, [controller]);

  return (
    <SessionContext.Provider value={{ ...snapshot, controller }}>
      {children}
    </SessionContext.Provider>
  );
}
