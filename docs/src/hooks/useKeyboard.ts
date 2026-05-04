/**
 * useKeyboard.ts — Global keyboard shortcut registration hook.
 *
 * WHAT: Registers document-level keydown listeners that fire a callback when
 * a specified key combination is pressed. Cleans up listeners on unmount.
 *
 * WHY: Centralizing shortcut registration in a hook prevents duplicate
 * listeners if a component re-renders, and guarantees cleanup so old handlers
 * don't accumulate in long-lived SPAs.
 *
 * HOW:
 *   - Each shortcut definition specifies a key, optional modifier flags
 *     (meta/ctrl/shift), and an onMatch callback.
 *   - The handler ignores shortcuts when focus is inside an interactive
 *     element (input, textarea, select, contenteditable) unless the shortcut
 *     opts in via allowInInput. This prevents Cmd+K from triggering the
 *     command palette while the user is typing a search query inside it.
 *   - The shortcuts array is spread into the useEffect deps array so new
 *     shortcut definitions trigger a re-registration. Callers should
 *     memoize their shortcuts array with useMemo to avoid unnecessary cycles.
 *
 * Usage:
 *   useKeyboard([
 *     { key: 'k', meta: true, onMatch: openPalette },
 *     { key: 'Escape', onMatch: closePalette, allowInInput: true },
 *   ]);
 */

import { useEffect, useRef } from 'react';

export interface ShortcutOptions {
  /** The key string matching KeyboardEvent.key (case-sensitive for named keys). */
  key: string;
  /** Require the Meta key (Cmd on Mac, Windows key on PC). */
  meta?: boolean;
  /** Require the Ctrl key. */
  ctrl?: boolean;
  /** Require the Shift key. */
  shift?: boolean;
  /** Called when all conditions are met. */
  onMatch: () => void;
  /**
   * When false (default), shortcuts are suppressed while focus is inside
   * an input-like element. Set to true for shortcuts like Escape that
   * should always fire (e.g. to close a modal that contains an input).
   */
  allowInInput?: boolean;
}

/**
 * Tags that capture keyboard input. Shortcuts are suppressed when any of
 * these elements has focus, unless allowInInput is true.
 *
 * WHY Set and not Array:
 *   handleKeyDown fires on every single keydown event — potentially
 *   hundreds of times per second during typing. The membership test
 *   `INPUT_TAGS.has(tagName)` is O(1) (hash lookup). The equivalent
 *   `['INPUT','TEXTAREA','SELECT'].includes(tagName)` is O(n) (linear
 *   scan). Three items is too small to matter today, but a Set makes
 *   the intent (unordered membership, fast lookup) explicit.
 */
const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function useKeyboard(shortcuts: ShortcutOptions[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    // Algorithm for each keydown event:
    //   if shortcut list is empty → return early (no work to do)
    //   for each registered shortcut:
    //     if modifier keys don't match → skip to next shortcut
    //     if key name doesn't match → skip to next shortcut
    //     if focus is in an input element AND shortcut.allowInInput is false → skip
    //     otherwise → prevent default browser action and call onMatch()
    function handleKeyDown(event: KeyboardEvent) {
      if (shortcutsRef.current.length === 0) return;
      const target = event.target as Element | null;

      for (const shortcut of shortcutsRef.current) {
        // Check modifier keys first — cheapest exit condition before
        // the string comparison below
        if (shortcut.meta !== undefined && shortcut.meta !== event.metaKey) continue;
        if (shortcut.ctrl !== undefined && shortcut.ctrl !== event.ctrlKey) continue;
        if (shortcut.shift !== undefined && shortcut.shift !== event.shiftKey) continue;

        // Case-insensitive so callers can write 'k' or 'K' interchangeably
        if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) continue;

        // Suppress in input elements unless the shortcut explicitly opts in.
        // isContentEditable catches rich-text editors not covered by INPUT_TAGS.
        if (!shortcut.allowInInput && target) {
          if (INPUT_TAGS.has(target.tagName)) continue;
          if ((target as HTMLElement).isContentEditable) continue;
        }

        event.preventDefault();
        shortcut.onMatch();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);
}
