/**
 * useTheme.ts — Dark/light theme management for the docs site.
 *
 * WHAT: Reads and writes the user's theme preference, defaulting to 'dark'
 * (matching the dbpeek app aesthetic). Persists to localStorage so the
 * preference survives page reloads.
 *
 * WHY default dark: The docs site is an extension of the dbpeek terminal-style
 * brand. Users who arrive from the main site expect the same dark palette.
 * Light mode is available for accessibility but is not the primary mode.
 *
 * HOW:
 *   - On mount, read localStorage('theme'). Fall back to 'dark' if absent.
 *   - Apply theme by toggling class="light" on <html>. We use an additive
 *     approach (add 'light' for light mode, remove for dark) rather than
 *     toggling 'dark', because Tailwind's dark: variant defaults to dark
 *     when no class is present — matching our default.
 *   - All theme-dependent Tailwind classes use dark: prefix. The docs
 *     currently use the dark palette everywhere, but this hook is the single
 *     switch if light mode classes are added later.
 *
 * Usage:
 *   const { theme, toggleTheme } = useTheme();
 */

import { useState, useEffect, useCallback } from 'react';

type Theme = 'dark' | 'light';

interface UseThemeReturn {
  /** Current active theme. */
  theme: Theme;
  /** Toggle between dark and light, persisting to localStorage. */
  toggleTheme: () => void;
  /** True when theme has been read from localStorage (avoids flash). */
  resolved: boolean;
}

/** localStorage key — keep in sync if changed. */
const STORAGE_KEY = 'dbpeek-docs-theme';

/**
 * Apply theme class to <html> element.
 * We manipulate the DOM directly rather than relying on React state to avoid
 * a flash: by the time React re-renders, the class is already set.
 */
function applyTheme(theme: Theme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
}

export function useTheme(): UseThemeReturn {
  const [theme, setTheme] = useState<Theme>('dark');
  const [resolved, setResolved] = useState(false);

  // Read from localStorage on first mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial: Theme =
      stored === 'dark' || stored === 'light' ? stored : 'dark';
    setTheme(initial);
    applyTheme(initial);
    setResolved(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, toggleTheme, resolved };
}
