import { useLayoutEffect, useState } from 'react';
import type { Theme } from '../types/navigation';

const storageKey = 'feely_theme';

function readTheme(): Theme {
  try {
    return localStorage.getItem(storageKey) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useLayoutEffect(() => {
    // The reference CSS scopes light appearance to html[data-theme]. Keep this
    // document integration isolated; all controls themselves render from state.
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // As in the reference, appearance still changes if storage is unavailable.
    }
  }

  return { theme, toggleTheme };
}
