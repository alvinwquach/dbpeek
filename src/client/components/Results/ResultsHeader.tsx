/**
 * src/client/components/Results/ResultsHeader.tsx
 *
 * WHAT:
 *   The stats bar pinned above the results table. Shows row count (filtered or
 *   total), execution time, a "Clear filters" button when column filters are
 *   active, and the ExportMenu button.
 *
 * WHY a separate file:
 *   ResultsHeader had no dependencies on TanStack Table or Virtual — it only
 *   needs the QueryResult shape, the filter state summary, and the ExportMenu.
 *   Extracting it keeps DataGrid.tsx and ResultsTable.tsx focused on their own
 *   concerns.
 *
 * FILTER STATE DISPLAY:
 *   When filteredRowCount is provided (i.e. at least one column filter is
 *   active), the row count changes from "1 000 rows" to "42 of 1 000 rows"
 *   so users always know the scope of what they're looking at.
 *   The "Clear filters" button is a single click to reset all columns at once,
 *   matching the UX of DBeaver and TablePlus.
 */

import { ExportMenu } from "./ExportMenu";
import type { QueryResult } from "../../types";

// ===== HELPERS =====

/**
 * formatTime — converts a millisecond duration to a human-readable string.
 *
 * Three tiers:
 *   < 1 ms   → "< 1 ms"    (avoids misleading "0.0 ms")
 *   ≥ 1000ms → "1.20 s"    (seconds with 2 decimals)
 *   default  → "12.3 ms"   (ms with 1 decimal)
 */
export function formatTime(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

// ===== COMPONENT =====

/** Props for ResultsHeader. */
interface ResultsHeaderProps {
  /** Full result — used for row count, execution time, and passed to ExportMenu. */
  result: QueryResult;
  /**
   * Number of rows that pass the current column filters.
   * Absent (undefined) when no filters are active — triggers the plain row count display.
   * Present when at least one column filter is active — triggers the "N of M rows" display.
   */
  filteredRowCount?: number;
  /**
   * Called when the user clicks "Clear filters".
   * Absent when no filters are active, which also hides the button.
   */
  onClearFilters?: () => void;
}

/**
 * ResultsHeader — the stats bar pinned above the table.
 *
 * WHY show both row count and time:
 *   Row count confirms "did my WHERE clause filter as expected?".
 *   Execution time reveals slow queries without leaving the tool.
 *
 * The checkmark icon signals success visually before the user reads the numbers.
 * ExportMenu sits on the right end, pushed there by ml-auto.
 *
 * WHY "N of M rows" when filtered:
 *   The user needs to know how many source rows were matched by their filter
 *   without mentally subtracting. "42 of 1 000 rows" makes it instant.
 */
export function ResultsHeader({ result, filteredRowCount, onClearFilters }: ResultsHeaderProps) {
  // True when column filters are active and narrowing the visible row set
  const isFiltered =
    filteredRowCount !== undefined && filteredRowCount !== result.rowCount;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 h-7 border-b border-[#1f2033] bg-[#0d0d17] text-[10px] font-mono text-[#4b5563]">
      {/* Checkmark — green to signal the query succeeded */}
      <svg
        className="w-3 h-3 text-[#34d399] shrink-0"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 6l3 3 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/*
        Row count — switches between "N rows" and "N of M rows" based on
        whether column filters are active. Both branch on the same condition
        so there's no stale display during filter state transitions.
      */}
      {isFiltered ? (
        <span className="text-[#6b7280]">
          {filteredRowCount!.toLocaleString()} of{" "}
          {result.rowCount.toLocaleString()}{" "}
          {result.rowCount === 1 ? "row" : "rows"}
        </span>
      ) : (
        <span className="text-[#6b7280]">
          {result.rowCount.toLocaleString()}{" "}
          {result.rowCount === 1 ? "row" : "rows"}
        </span>
      )}

      {/* Thin separator dot */}
      <span className="text-[#1f2033]" aria-hidden="true">·</span>

      <span>{formatTime(result.executionTime)}</span>

      {/*
        "Clear filters" button — only visible when at least one column filter
        is active (isFiltered). A single click resets all column filters via the
        onClearFilters callback provided by ResultsTable.

        WHY a button, not a link:
          It triggers an action (state mutation), not navigation — semantically
          a button. Screen readers will announce it as a button.

        WHY inline with the stats (not in the filter row):
          The filter row is inside <thead> and scrolls with the table header.
          The stats bar is always visible at the top of the panel. "Clear all"
          belongs next to the row count it explains.
      */}
      {isFiltered && onClearFilters && (
        <>
          <span className="text-[#1f2033]" aria-hidden="true">·</span>
          <button
            onClick={onClearFilters}
            className={[
              "flex items-center gap-1",
              "text-[#4b5563] hover:text-[#ededf0]",
              "transition-colors duration-100",
              "cursor-pointer",
            ].join(" ")}
            aria-label="Clear all column filters"
          >
            {/* × icon drawn with SVG for pixel-precise sizing at 10px text */}
            <svg
              className="w-2.5 h-2.5 shrink-0"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2 2l6 6M8 2l-6 6"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <span>Clear filters</span>
          </button>
        </>
      )}

      {/* Push export button to the far right */}
      <div className="ml-auto">
        <ExportMenu result={result} />
      </div>
    </div>
  );
}
