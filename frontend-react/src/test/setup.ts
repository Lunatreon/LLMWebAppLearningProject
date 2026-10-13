import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

let viewportWidth = 1440;
const mediaListeners = new Set<() => void>();

export function setMobileViewport(value: boolean) {
  setViewportWidth(value ? 390 : 1440);
}

export function setViewportWidth(value: number) {
  viewportWidth = value;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value });
  mediaListeners.forEach((notify) => notify());
}

beforeEach(() => {
  viewportWidth = 1440;
  mediaListeners.clear();
  localStorage.clear();
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.style.removeProperty('--app-height');
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  if (!HTMLElement.prototype.scrollTo) HTMLElement.prototype.scrollTo = () => {};
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      media: query,
      get matches() {
        const width = query.match(/\((max|min)-width:\s*(\d+)px\)/);
        if (!width) return false;
        return width[1] === 'max'
          ? viewportWidth <= Number(width[2])
          : viewportWidth >= Number(width[2]);
      },
      addEventListener: (_event: string, notify: () => void) => mediaListeners.add(notify),
      removeEventListener: (_event: string, notify: () => void) => mediaListeners.delete(notify),
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
