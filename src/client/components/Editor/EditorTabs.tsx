/**
 * src/client/components/Editor/EditorTabs.tsx
 *
 * WHAT:
 *   The tab bar rendered above the SQL editor. Each tab stores its own SQL
 *   buffer, query result, error state, and view mode independently in Zustand.
 *   Tabs can be added with the "+" button and closed with the "×" button.
 *   The last remaining tab cannot be closed.
 *
 * HOW IT WORKS:
 *   - Reads `tabs` and `activeTabIndex` from the Zustand store.
 *   - Clicking a tab → setActiveTabIndex; clicking "×" → removeTab.
 *   - Clicking "+" → addTab with a fresh makeTab() value. Tab title is
 *     "Query N" where N is the next sequential number (not the array length,
 *     so closing tabs never causes title collisions like "Query 2, Query 2").
 *   - The active tab gets a distinctive bottom border and brighter text.
 *     Inactive tabs are dimmed and show their close button only on hover.
 *
 * LAYOUT:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ [Query 1 ×] [Query 2 ×] [Query 3 ×]           [+]     │
 *   └─────────────────────────────────────────────────────────┘
 *   The tab list is horizontally scrollable so many open tabs don't overflow.
 *   The "+" button is sticky to the right edge of the bar.
 *
 * WHY tab count is tracked with a ref instead of deriving from tabs.length:
 *   After closing tabs, tabs.length drops. If the next "+" used tabs.length+1
 *   as the title counter, you'd get "Query 2" right after closing "Query 2".
 *   A monotonically increasing counter ref avoids all title collisions.
 */

import { useRef, useCallback } from "react";
import { useAppStore, makeTab } from "../../stores/app";

// ===== ICONS =====

/**
 * ClockIcon — minimal SVG clock used on the History toggle button.
 * Inline SVG costs zero bytes of extra bundle vs. an icon library import.
 * 16×16 viewBox, 1.5px stroke, currentColor so Tailwind color utilities apply.
 */
function ClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

// ===== COMPONENT =====

/**
 * EditorTabs — horizontal tab bar above the SQL editor.
 *
 * Reads tab state from Zustand; writes via addTab / removeTab / setActiveTabIndex.
 * Renders no props — all data flows through the global store.
 */
export function EditorTabs() {
  // ── Store subscriptions ──────────────────────────────────────────────────
  // Subscribe to tabs and activeTabIndex as a single selector to get one
  // coherent snapshot and avoid tearing between a tab list update and an
  // index update.
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const addTab = useAppStore((s) => s.addTab);
  const removeTab = useAppStore((s) => s.removeTab);
  const setActiveTabIndex = useAppStore((s) => s.setActiveTabIndex);

  // ── History panel toggle ─────────────────────────────────────────────────
  // historyOpen drives the button's active styling; toggleHistory is called
  // on click and also wired to Cmd+H in App.tsx.
  const historyOpen = useAppStore((s) => s.historyOpen);
  const toggleHistory = useAppStore((s) => s.toggleHistory);

  // ── Tab counter ──────────────────────────────────────────────────────────
  // Monotonically increasing counter so new tabs always get unique "Query N"
  // titles even after some tabs have been closed. Start at 2 because the
  // initial tab is always "Query 1" (created in the store initializer).
  const tabCounterRef = useRef(2);

  // ── Handlers ────────────────────────────────────────────────────────────

  /**
   * handleAddTab — creates a fresh blank tab and activates it.
   * Uses tabCounterRef to guarantee unique titles across add/close cycles.
   */
  const handleAddTab = useCallback(() => {
    const n = tabCounterRef.current++;
    addTab(makeTab(crypto.randomUUID(), `Query ${n}`));
  }, [addTab]);

  /**
   * handleCloseTab — removes the tab with the given id.
   * Stops event propagation so the click doesn't also activate the tab.
   *
   * The store's removeTab action refuses to remove the last tab, so we
   * don't need a guard here — but we do hide the close button via CSS
   * (pointer-events-none + opacity-0) when only one tab remains.
   */
  const handleCloseTab = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      removeTab(id);
    },
    [removeTab]
  );

  // ===== RENDER =====

  return (
    // Root bar: full-width, fixed height, dark background, bottom border.
    // flex + overflow-x-auto lets the tab list scroll horizontally when many
    // tabs are open, while the "+" button stays pinned via shrink-0.
    <div className="flex items-stretch h-8 bg-[#080810] border-b border-[#1f2033] overflow-x-auto overflow-y-hidden select-none">

      {/* ── TAB LIST ────────────────────────────────────────────────────── */}
      {/*
        flex-1 min-w-0: allows this section to shrink so the "+" button is never
        pushed off-screen. overflow-x-auto on the parent handles the scroll.
      */}
      <div className="flex items-stretch flex-1 min-w-0">
        {tabs.map((tab, idx) => {
          const isActive = idx === activeTabIndex;
          const isOnly = tabs.length === 1;

          return (
            <button
              key={tab.id}
              onClick={() => setActiveTabIndex(idx)}
              // Active tab: brighter text + accent bottom border + lighter bg.
              // Inactive: muted text + transparent bottom border + darker bg.
              // group: lets the close button respond to the tab's hover state.
              className={[
                "group relative flex items-center gap-1.5 px-3 h-full text-[11px] font-medium",
                "border-r border-[#1f2033] shrink-0 transition-colors duration-100 cursor-pointer",
                "whitespace-nowrap focus-visible:outline-none",
                isActive
                  ? "bg-[#0a0a0f] text-[#ededf0] border-b-2 border-b-[#5b6ad6]"
                  : "bg-[#080810] text-[#4b5563] hover:bg-[#0d0d1a] hover:text-[#9ca3af] border-b-2 border-b-transparent",
              ].join(" ")}
              title={tab.title}
              aria-selected={isActive}
              role="tab"
            >
              {/* ── Tab title ───────────────────────────────────────────── */}
              {/*
                max-w-[120px] + truncate: keeps long titles from blowing out
                the tab bar width. The full title is surfaced via the title attr.
              */}
              <span className="max-w-[120px] truncate">{tab.title}</span>

              {/* ── Close button ─────────────────────────────────────────── */}
              {/*
                Hidden (opacity-0) on inactive tabs until the tab is hovered,
                then fades in. Always visible on the active tab.
                pointer-events-none when only one tab remains — the store would
                refuse the removal anyway, but this prevents the misleading click.
              */}
              <span
                onClick={(e) => handleCloseTab(e, tab.id)}
                className={[
                  "flex items-center justify-center w-3.5 h-3.5 rounded-sm",
                  "text-[10px] leading-none transition-opacity duration-100",
                  "hover:bg-[#2a2a4a] hover:text-[#ededf0]",
                  isOnly
                    ? "opacity-0 pointer-events-none"
                    : isActive
                    ? "opacity-60 hover:opacity-100"
                    : "opacity-0 group-hover:opacity-60 hover:!opacity-100",
                ].join(" ")}
                role="button"
                aria-label={`Close ${tab.title}`}
                title={`Close ${tab.title}`}
              >
                ×
              </span>
            </button>
          );
        })}
      </div>

      {/* ── ADD TAB BUTTON ──────────────────────────────────────────────── */}
      {/*
        shrink-0: never compressed by the tab list.
        Sticky to the right edge, separated by a left border from the last tab.
      */}
      <button
        onClick={handleAddTab}
        className="flex items-center justify-center w-8 h-full shrink-0 text-[#4b5563] hover:text-[#9ca3af] hover:bg-[#0d0d1a] border-l border-[#1f2033] transition-colors duration-100 focus-visible:outline-none cursor-pointer"
        title="New tab"
        aria-label="Open new query tab"
      >
        {/* Plus icon — rendered as text for zero bundle cost. */}
        <span className="text-[14px] leading-none">+</span>
      </button>

      {/* ── HISTORY TOGGLE BUTTON ────────────────────────────────────────── */}
      {/*
        Right-aligned, separated from the "+" by a left border.
        Active state: brighter text + accent bottom border + slightly lighter bg,
        matching the visual language used for active editor tabs.
        Cmd+H is the keyboard equivalent (wired in App.tsx).
      */}
      <button
        onClick={toggleHistory}
        className={[
          "flex items-center gap-1.5 px-2.5 h-full shrink-0",
          "border-l border-[#1f2033] transition-colors duration-100",
          "focus-visible:outline-none cursor-pointer text-[11px] font-medium",
          "border-b-2",
          historyOpen
            ? "bg-[#0a0a0f] text-[#ededf0] border-b-[#5b6ad6]"
            : "bg-[#080810] text-[#4b5563] border-b-transparent hover:bg-[#0d0d1a] hover:text-[#9ca3af]",
        ].join(" ")}
        title="Toggle query history (⌘H)"
        aria-label="Toggle query history panel"
        aria-pressed={historyOpen}
      >
        <ClockIcon />
        <span>History</span>
      </button>

    </div>
  );
}
