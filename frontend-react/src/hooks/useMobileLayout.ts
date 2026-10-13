import { useMemo, useSyncExternalStore } from 'react';

export function useMobileLayout() {
  const media = useMemo(
    () => (typeof window === 'undefined' ? null : window.matchMedia('(max-width: 900px)')),
    [],
  );
  const subscribe = useMemo(
    () => (notify: () => void) => {
      media?.addEventListener('change', notify);
      return () => media?.removeEventListener('change', notify);
    },
    [media],
  );

  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? false,
    () => false,
  );
}
