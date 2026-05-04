/**
 * usePalette — State and keyboard navigation for the command palette.
 *
 * WHY: Separating logic from rendering makes the CommandPalette easier to
 * test and reason about. The hook owns all mutable state; components just
 * call setters and render values.
 *
 * HOW:
 * - `open` / `setOpen`: controls whether the palette modal is visible.
 * - `query` / `setQuery`: the current search string typed by the user.
 * - `selectedIndex`: which result row is highlighted (keyboard nav).
 * - `results`: filtered SidebarItem list derived from query + sidebar data.
 * - `handleKeyDown`: arrow keys move selection; Enter navigates; Escape closes.
 * - Global Cmd+K (Mac) / Ctrl+K (Windows) listener registered once via
 *   useEffect, cleaned up on unmount.
 *
 * The hook does NOT call useNavigate itself — navigation is handled in
 * CommandPalette.tsx to keep the hook free of Router dependencies and
 * usable in tests without a Router wrapper.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { sidebar, allItems, type SidebarItem } from '@/lib/sidebar-config';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PaletteResult {
  /** The matched SidebarItem. */
  item: SidebarItem;
  /** Which sidebar group this item belongs to (used for category headers). */
  category: string;
}

export interface UsePaletteReturn {
  /** Whether the palette modal is visible. */
  open: boolean;
  /** Open the palette programmatically (e.g. search button click). */
  openPalette: () => void;
  /** Close the palette and reset query/selection. */
  closePalette: () => void;
  /** Toggle open/closed (used by Cmd+K handler). */
  togglePalette: () => void;
  /** Current search query string. */
  query: string;
  /** Update the search query (resets selectedIndex to 0). */
  setQuery: (q: string) => void;
  /** Index of the currently keyboard-highlighted result (-1 = none). */
  selectedIndex: number;
  /** Filtered results matching the current query. */
  results: PaletteResult[];
  /**
   * Keyboard handler — attach to the palette input's onKeyDown.
   * Handles: ArrowUp, ArrowDown, Enter, Escape.
   * Returns the selected item if Enter was pressed (caller navigates).
   */
  handleKeyDown: (e: React.KeyboardEvent) => SidebarItem | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Case-insensitive substring match against label and keywords.
 * Returns true if the query matches any searchable field of the item.
 */
function matchesQuery(item: SidebarItem, query: string): boolean {
  const q = query.toLowerCase();
  if (item.label.toLowerCase().includes(q)) return true;
  if (item.slug.toLowerCase().includes(q)) return true;
  if (item.keywords?.some((kw) => kw.toLowerCase().includes(q))) return true;
  return false;
}

/**
 * Looks up the category label for a given item slug from the sidebar config.
 */
function getCategoryForSlug(slug: string): string {
  const group = sidebar.find((g) => g.items.some((i) => i.slug === slug));
  return group?.label ?? 'Docs';
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePalette(): UsePaletteReturn {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Track whether we've registered the global keydown listener.
  const listenerRef = useRef(false);

  // ── Query filter ──────────────────────────────────────────────────────────

  const results: PaletteResult[] = useMemo(() => {
    const q = query.trim();
    if (!q) return [];
    return allItems
      .filter((item) => matchesQuery(item, q))
      .map((item) => ({
        item,
        category: getCategoryForSlug(item.slug),
      }));
  }, [query]);

  // ── Selection bounds ──────────────────────────────────────────────────────

  // Clamp selectedIndex when results list shrinks.
  useEffect(() => {
    if (selectedIndex >= results.length) {
      setSelectedIndex(Math.max(0, results.length - 1));
    }
  }, [results.length, selectedIndex]);

  // ── Open / close helpers ──────────────────────────────────────────────────

  const openPalette = useCallback(() => {
    setOpen(true);
    setQueryState('');
    setSelectedIndex(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQueryState('');
    setSelectedIndex(0);
  }, []);

  const togglePalette = useCallback(() => {
    setOpen((prev) => {
      if (prev) {
        setQueryState('');
        setSelectedIndex(0);
      }
      return !prev;
    });
  }, []);

  // ── Query setter (resets selection) ──────────────────────────────────────

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    setSelectedIndex(0);
  }, []);

  // ── Keyboard navigation ───────────────────────────────────────────────────

  /**
   * Handles ArrowUp / ArrowDown / Enter / Escape within the palette input.
   * Returns the selected SidebarItem when Enter is pressed (so the caller
   * can navigate), or null otherwise.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): SidebarItem | null => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            results.length > 0 ? (prev + 1) % results.length : 0
          );
          return null;

        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            results.length > 0
              ? (prev - 1 + results.length) % results.length
              : 0
          );
          return null;

        case 'Enter': {
          const selected = results[selectedIndex];
          if (selected) {
            closePalette();
            return selected.item;
          }
          return null;
        }

        case 'Escape':
          closePalette();
          return null;

        default:
          return null;
      }
    },
    [results, selectedIndex, closePalette]
  );

  // ── Global Cmd+K / Ctrl+K listener ───────────────────────────────────────

  useEffect(() => {
    if (listenerRef.current) return;
    listenerRef.current = true;

    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        togglePalette();
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      listenerRef.current = false;
    };
  }, [togglePalette]);

  return {
    open,
    openPalette,
    closePalette,
    togglePalette,
    query,
    setQuery,
    selectedIndex,
    results,
    handleKeyDown,
  };
}
