/**
 * src/client/stores/theme.ts — Theme state management with Zustand.
 *
 * ARCHITECTURE:
 *   Single store for dark/light theme preference. In-memory only.
 *   Default is dark mode. Uses CSS custom properties to switch colors dynamically.
 */

import { create } from "zustand";

type Theme = "dark" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  // Initialize theme on store creation
  const initialTheme: Theme = "dark";
  applyTheme(initialTheme);

  return {
    theme: initialTheme,

    setTheme: (theme: Theme) => {
      set({ theme });
      applyTheme(theme);
    },

    toggleTheme: () => {
      const current = get().theme;
      const next = current === "dark" ? "light" : "dark";
      set({ theme: next });
      applyTheme(next);
    },
  };
});

/**
 * Apply theme to document root by setting CSS custom properties.
 * CodeMirror theme is also updated via a custom data attribute.
 */
function applyTheme(theme: Theme) {
  const root = document.documentElement;

  if (theme === "dark") {
    root.style.setProperty("--bg-primary", "#0a0a0f");
    root.style.setProperty("--bg-secondary", "#0d0d17");
    root.style.setProperty("--bg-tertiary", "#1a1a27");
    root.style.setProperty("--text-primary", "#ededf0");
    root.style.setProperty("--text-secondary", "#9ca3af");
    root.style.setProperty("--text-muted", "#6b7280");
    root.style.setProperty("--text-light", "#374151");
    root.style.setProperty("--border-color", "#1f2033");
    root.style.setProperty("--border-light", "#2d2d3d");
    root.classList.remove("light-theme");
    root.classList.add("dark-theme");
  } else {
    root.style.setProperty("--bg-primary", "#ffffff");
    root.style.setProperty("--bg-secondary", "#f9f9fb");
    root.style.setProperty("--bg-tertiary", "#f3f3f6");
    root.style.setProperty("--text-primary", "#1f2937");
    root.style.setProperty("--text-secondary", "#6b7280");
    root.style.setProperty("--text-muted", "#9ca3af");
    root.style.setProperty("--text-light", "#e5e7eb");
    root.style.setProperty("--border-color", "#e5e7eb");
    root.style.setProperty("--border-light", "#d1d5db");
    root.classList.remove("dark-theme");
    root.classList.add("light-theme");
  }
}
