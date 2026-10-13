import { useEffect, useSyncExternalStore } from 'react';

function viewportHeight() {
  return window.visualViewport?.height || window.innerHeight;
}

function subscribe(notify: () => void) {
  // Browser subscriptions live in a hook and are removed on unmount. Navigation
  // and sidebar controls use React event props, not imperative DOM listeners.
  window.addEventListener('resize', notify);
  window.addEventListener('orientationchange', notify);
  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', notify);
  return () => {
    window.removeEventListener('resize', notify);
    window.removeEventListener('orientationchange', notify);
    viewport?.removeEventListener('resize', notify);
  };
}

export function useViewportHeight() {
  const height = useSyncExternalStore(subscribe, viewportHeight, () => 0);
  useEffect(() => {
    if (height <= 0) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--app-height');
    root.style.setProperty('--app-height', `${height}px`);
    return () => {
      if (previous) root.style.setProperty('--app-height', previous);
      else root.style.removeProperty('--app-height');
    };
  }, [height]);
}
