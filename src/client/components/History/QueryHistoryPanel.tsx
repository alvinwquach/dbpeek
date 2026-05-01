/**
 * src/client/components/History/QueryHistoryPanel.tsx
 *
 * WHAT:
 *   A 340 px push-panel rendered to the right of the SQL editor/results column.
 *   It lists every query execution (success or failure) in reverse-chronological
 *   order with a live search filter. Clicking an entry loads its SQL into the
 *   active tab WITHOUT closing the panel, so the user can iterate through
 *   history entries and run them back-to-back.
 *
 * WHY push-panel instead of overlay:
 *   An overlay would cover the results grid — the very thing the user wants to
 *   compare against their historical queries. A push-panel shrinks the center
 *   column so the editor, results, and history are all visible simultaneously.
 *   App.tsx switches the grid from "244px 1fr" to "244px 1fr 340px" when open.
 *
 * HOW loading SQL works (the nonce path):
 *   handleSelect() calls loadSqlFromHistory(tabId, sql), which in the Zustand
 *   store updates tab.sql AND increments tab.loadNonce. SqlEditor subscribes
 *   to loadNonce via a dedicated useEffect; when it ticks up the effect
 *   dispatches a CodeMirror document-replacement transaction. This keeps the
 *   "external injection" path (store → editor) separate from the normal
 *   "keystroke" path (editor → store via onChange).
 *
 * STATE:
 *   - history[]       — from Zustand, newest first, max 200 entries
 *   - search          — local useState; filters by case-insensitive SQL substring
 *
 * LAYOUT (top to bottom):
 *   ┌─────────────────────────────────┐
 *   │ HISTORY                  Clear  │  ← header (h-8, border-b)
 *   ├─────────────────────────────────┤
 *   │ 🔍 Search history...            │  ← search input
 *   ├─────────────────────────────────┤
 *   │ ● just now · 42 rows · 8ms      │  ← history item (success)
 *   │   SELECT * FROM users WHERE...  │
 *   ├─────────────────────────────────┤
 *   │ ● 3m ago                        │  ← history item (failure)
 *   │   SELECT * FROM nonexist...     │
 *   └─────────────────────────────────┘
 *   │ 12 entries                      │  ← footer count
 *   └─────────────────────────────────┘
 */

import { useState, useCallback, useMemo } from "react";
import { useAppStore, type HistoryEntry } from "../../stores/app";

// ===== UTILITIES =====

/**
 * formatRelativeTime — converts a Date to a compact human-readable string.
 *
 * WHY not use Intl.RelativeTimeFormat:
 *   Intl.RelativeTimeFormat produces strings like "3 minutes ago" which are
 *   too wide for the narrow metadata row. Hand-rolled abbreviations ("3m ago",
 *   "2h ago") fit the design without truncation.
 *
 * Thresholds:
 *   < 60 s  → "just now"
 *   1–59 m  → "Xm ago"
 *   1–23 h  → "Xh ago"
 *   ≥ 1 day → "Apr 29" (month + day, no year — history is in-memory so it
 *              never spans more than one browser session anyway)
 */
function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * formatExecTime — converts a millisecond duration to a compact string.
 * Examples: 8 → "8ms",  1200 → "1.2s"
 */
function formatExecTime(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ===== ICONS =====

/**
 * SearchIcon — 12×12 magnifying glass.
 * Inline SVG so there's no icon-library dependency.
 */
function SearchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="6.5" cy="6.5" r="4.5" />
      <path d="M10.5 10.5 l3.5 3.5" />
    </svg>
  );
}

// ===== SUB-COMPONENTS =====

/** Props for a single row in the history list. */
interface HistoryItemProps {
  entry: HistoryEntry;
  /** Called when the user clicks the row — loads SQL into the active tab. */
  onSelect: (entry: HistoryEntry) => void;
}

/**
 * HistoryItem — renders one entry in the scrollable history list.
 *
 * LAYOUT (two rows inside a button):
 *   Row 1 — metadata: status dot · timestamp · row count · exec time
 *   Row 2 — SQL preview: monospace, 2-line clamp, breaks on any character
 *            so long table names / aliased columns don't overflow the panel.
 *
 * WHY a <button> wrapping both rows:
 *   The entire card is the click target. Using a <button> gives keyboard
 *   accessibility (Tab + Enter) and correct cursor styling for free.
 *   The onClick calls onSelect with the entry, not just the SQL string, so
 *   the parent has full context if it needs to do more than load SQL.
 *
 * WHY `break-all` on the SQL preview:
 *   SQL can contain very long unbroken strings (base64 values, long table
 *   names). Without break-all the text overflows the 340 px panel. break-all
 *   is more aggressive than break-words but necessary here to stay in-bounds.
 */
function HistoryItem({ entry, onSelect }: HistoryItemProps) {
  return (
    <button
      onClick={() => onSelect(entry)}
      className="w-full text-left px-3 py-2 border-b border-[#1f2033] hover:bg-[#0f0f1a] active:bg-[#14142b] transition-colors duration-100 group focus-visible:outline-none focus-visible:bg-[#0f0f1a]"
    >
      {/* ── Row 1: metadata ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 mb-1 min-w-0">

        {/* Status indicator dot: emerald = success, red = failure. */}
        <span
          className={[
            "flex-shrink-0 w-1.5 h-1.5 rounded-full",
            entry.success ? "bg-emerald-500" : "bg-red-500",
          ].join(" ")}
          aria-label={entry.success ? "Success" : "Failed"}
        />

        {/* Relative timestamp, e.g. "just now", "3m ago", "Apr 29". */}
        <span className="text-[10px] text-[#4b5563] flex-shrink-0">
          {formatRelativeTime(entry.executedAt)}
        </span>

        {/*
          Row count and exec time are only shown for successful queries.
          Failed queries don't have meaningful row/time metadata because the
          server returns an error before executing the statement.
        */}
        {entry.success && entry.rowCount !== undefined && (
          <>
            <span className="text-[#2d3047] text-[10px] flex-shrink-0" aria-hidden="true">·</span>
            <span className="text-[10px] text-[#4b5563] flex-shrink-0">
              {entry.rowCount.toLocaleString()}{" "}
              {entry.rowCount === 1 ? "row" : "rows"}
            </span>
          </>
        )}

        {entry.success && entry.executionTime !== undefined && (
          <>
            <span className="text-[#2d3047] text-[10px] flex-shrink-0" aria-hidden="true">·</span>
            <span className="text-[10px] text-[#4b5563] flex-shrink-0">
              {formatExecTime(entry.executionTime)}
            </span>
          </>
        )}
      </div>

      {/* ── Row 2: SQL preview ───────────────────────────────────────────── */}
      {/*
        font-mono + text-[11px]: matches the SqlEditor font stack at a readable
        size. line-clamp-2 keeps tall entries from dominating the list.
        group-hover: brightens text on hover to signal the row is clickable.
      */}
      <div className="font-mono text-[11px] text-[#6b7280] group-hover:text-[#ededf0] leading-relaxed line-clamp-2 break-all transition-colors duration-100">
        {entry.sql}
      </div>
    </button>
  );
}

// ===== MAIN COMPONENT =====

/**
 * QueryHistoryPanel — the 340 px right push-panel for query execution history.
 *
 * Rendered conditionally in App.tsx inside an <aside> when historyOpen is true.
 * The panel never overlays other content — it participates in the flex row and
 * pushes the center column left.
 *
 * IMPORTANT: this component owns no toggle state — it reads historyOpen from
 * the store but does NOT render the toggle button (that lives in EditorTabs so
 * the Cmd+H affordance is always visible in the tab bar regardless of panel state).
 */
export function QueryHistoryPanel() {
  // ── Store subscriptions ────────────────────────────────────────────────────
  const history = useAppStore((s) => s.history);
  const clearHistory = useAppStore((s) => s.clearHistory);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const loadSqlFromHistory = useAppStore((s) => s.loadSqlFromHistory);

  // ── Local state ────────────────────────────────────────────────────────────
  // Search string — stored locally because it's purely UI state that doesn't
  // need to survive panel close/reopen (the list resets to "show all" each time).
  const [search, setSearch] = useState("");

  // ── Derived: filtered list ─────────────────────────────────────────────────
  // useMemo avoids re-filtering the full history array on every render caused
  // by unrelated store updates (e.g. a different tab's loading state flipping).
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return history;
    return history.filter((e) => e.sql.toLowerCase().includes(term));
  }, [history, search]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * handleSelect — loads the clicked history entry's SQL into the active tab.
   *
   * Does NOT close the panel so the user can quickly load and compare multiple
   * historical queries. The nonce path (loadSqlFromHistory → loadNonce effect
   * in SqlEditor) handles the CodeMirror document update.
   */
  const handleSelect = useCallback(
    (entry: HistoryEntry) => {
      const activeTab = tabs[activeTabIndex];
      if (!activeTab) return;
      loadSqlFromHistory(activeTab.id, entry.sql);
    },
    [tabs, activeTabIndex, loadSqlFromHistory]
  );

  /**
   * handleClear — wipes history and resets the search input.
   * Resetting search avoids a "no results for X" empty state immediately after
   * clearing, which would be confusing.
   */
  const handleClear = useCallback(() => {
    clearHistory();
    setSearch("");
  }, [clearHistory]);

  // ===== RENDER =====

  return (
    <div className="flex flex-col h-full bg-[#0c0c14]">

      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-[#1f2033] shrink-0">
        <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
          History
        </span>

        {/*
          Clear button: only shown when there's something to clear.
          Transitions to red on hover as a visual warning that this is
          a destructive action (in-memory only, but still unrecoverable).
        */}
        {history.length > 0 && (
          <button
            onClick={handleClear}
            className="text-[10px] text-[#4b5563] hover:text-[#ef4444] transition-colors duration-100 focus-visible:outline-none"
            title="Clear all history"
          >
            Clear
          </button>
        )}
      </div>

      {/* ── SEARCH INPUT ────────────────────────────────────────────────────── */}
      <div className="px-2 py-1.5 border-b border-[#1f2033] shrink-0">
        <div className="relative">
          {/* Icon pinned to the left of the input field. */}
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#4b5563] pointer-events-none">
            <SearchIcon />
          </span>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history…"
            spellCheck={false}
            className="w-full pl-6 pr-2 py-1 text-[11px] bg-[#0a0a0f] border border-[#1f2033] rounded text-[#ededf0] placeholder:text-[#2d3047] focus:outline-none focus:border-[#3b4070] transition-colors duration-100"
          />
        </div>
      </div>

      {/* ── HISTORY LIST ────────────────────────────────────────────────────── */}
      {/*
        overflow-y-auto: the list scrolls independently of the panel shell.
        flex-1: grows to fill the space between the search bar and the footer,
        so the footer stays anchored to the bottom even when the list is short.
      */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (

          // ── EMPTY STATE ────────────────────────────────────────────────────
          // Two variants:
          //   a) No history at all → encourage the user to run a query.
          //   b) History exists but search found nothing → show the search term.
          <div className="flex flex-col items-center justify-center h-full text-center px-4 gap-1">
            {history.length === 0 ? (
              <>
                <p className="text-[12px] text-[#4b5563]">No history yet</p>
                <p className="text-[10px] text-[#2d3047]">
                  Run a query to see it here
                </p>
              </>
            ) : (
              <p className="text-[12px] text-[#4b5563]">
                No results for &ldquo;{search}&rdquo;
              </p>
            )}
          </div>

        ) : (

          // ── ENTRY LIST ─────────────────────────────────────────────────────
          filtered.map((entry) => (
            <HistoryItem key={entry.id} entry={entry} onSelect={handleSelect} />
          ))

        )}
      </div>

      {/* ── FOOTER: entry count ─────────────────────────────────────────────── */}
      {/*
        Only shown when there's at least one entry. When filtered, shows
        "X of Y entries" so the user knows their search narrowed the list.
        Stays at the bottom thanks to the flex-1 on the list above.
      */}
      {history.length > 0 && (
        <div className="px-3 py-1.5 border-t border-[#1f2033] shrink-0">
          <span className="text-[10px] text-[#2d3047]">
            {filtered.length === history.length
              ? `${history.length} ${history.length === 1 ? "entry" : "entries"}`
              : `${filtered.length} of ${history.length} entries`}
          </span>
        </div>
      )}

    </div>
  );
}
