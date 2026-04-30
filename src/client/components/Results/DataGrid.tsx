/**
 * src/client/components/Results/DataGrid.tsx
 *
 * WHAT:
 *   Renders the output of a SQL query as a scrollable table with a stats footer.
 *   Also handles loading, error, and empty states inline.
 *
 * WHY a plain HTML <table> instead of TanStack Table:
 *   TanStack Table adds ~10 KB for virtualization, sorting, and filtering.
 *   Phase 1 only needs to display results — a plain table is the right size.
 *   The Phase 2 upgrade is a drop-in: swap the render loop for TanStack rows
 *   and add column header click handlers.
 *
 * FOUR RENDER STATES:
 *   1. loading  — pulsing "Running…" centered in the panel.
 *   2. error    — red error card with the human-friendly message from the server.
 *   3. no columns — non-SELECT statement (INSERT/UPDATE/DELETE); shows row count.
 *   4. table    — sticky header, scrollable body, stats bar, NULL rendering.
 *
 * COLUMN ALIGNMENT:
 *   Numeric columns (detected from the first non-null value in the column) are
 *   right-aligned in a light-blue color, matching the convention of most DB GUIs.
 *   All other columns are left-aligned in the default text color.
 *
 * NULL / SPECIAL VALUES:
 *   null / undefined → "NULL" in muted italic
 *   boolean         → "true" (green) / "false" (red)
 *   object/array    → JSON.stringify (e.g. JSONB columns from Postgres)
 *   all others      → String(value)
 */

import { useMemo, type ReactNode } from "react";
import type { QueryResult } from "../../hooks/useQuery";

// ===== TYPES =====

/** Props for the DataGrid component. */
interface DataGridProps {
  /** The normalized result from the last successful query, or null if no query has run. */
  result: QueryResult | null;
  /** Human-friendly error message from the last failed query, or null. */
  error: string | null;
  /** True while a query is in flight. */
  loading: boolean;
}

// ===== HELPERS =====

/**
 * formatTime — converts a millisecond duration into a human-readable string.
 *
 * WHY three tiers:
 *   Sub-millisecond: "< 1 ms" — avoids "0.0 ms" which looks like zero work.
 *   Seconds tier: kicks in at ≥ 1 000 ms so "1200 ms" becomes "1.20 s".
 *   Default: one decimal place ("12.3 ms") for practical precision.
 */
function formatTime(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

/**
 * isNumericColumn — returns true if the first non-null value in the column is
 * a JavaScript number.
 *
 * WHY inspect only the first non-null value:
 *   All rows in a given column have the same type (it's a typed database column).
 *   Scanning every row would be O(n) per column; first non-null is O(1) amortized.
 *   The only exception is a column that is null in ALL rows, in which case we
 *   return false (default: left-aligned) — a safe and reasonable fallback.
 */
function isNumericColumn(colIndex: number, rows: unknown[][]): boolean {
  for (const row of rows) {
    const val = row[colIndex];
    if (val !== null && val !== undefined) {
      return typeof val === "number";
    }
  }
  return false;
}

/**
 * renderCell — converts a raw cell value into a React node for display.
 *
 * WHY special-case null/undefined/boolean/object:
 *   SQL NULL is semantically distinct from an empty string. Rendering it as ""
 *   or "null" conflates two different meanings; "NULL" in italic matches the
 *   convention of psql, TablePlus, and most SQL GUIs.
 *
 *   Booleans get color-coded (green/red) because true/false appear frequently
 *   in boolean columns and color makes them scannable at a glance.
 *
 *   Objects/arrays come from JSONB columns (Postgres) or JSON columns (MySQL).
 *   JSON.stringify gives a readable representation without needing a tree widget.
 */
function renderCell(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    // Muted italic "NULL" — visually distinct from the string "NULL".
    return <span className="text-[#374151] italic not-italic:text-[#374151]">NULL</span>;
  }
  if (typeof value === "boolean") {
    // Color-coded booleans: green for true, red for false.
    return (
      <span className={value ? "text-[#34d399]" : "text-[#f87171]"}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === "object") {
    // JSONB / JSON column — show compact JSON.
    return JSON.stringify(value);
  }
  return String(value);
}

// ===== COMPONENT =====

/**
 * DataGrid — renders query results in one of four states.
 *
 * The component is purely presentational (no data fetching, no side effects).
 * All data flows in via props from the useQueryExecution hook in App.tsx.
 *
 * WHY the root div uses "h-full flex flex-col overflow-hidden":
 *   The parent panel in App.tsx allocates flex-1 to the results body. For the
 *   table to scroll correctly, DataGrid must fill that space and let only the
 *   table wrapper (not the whole panel) overflow. overflow-hidden on the root
 *   prevents a double scrollbar from appearing.
 */
export function DataGrid({ result, error, loading }: DataGridProps) {
  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[#4b5563] text-xs animate-pulse font-mono">
          Running…
        </span>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="h-full flex items-start p-3">
        {/*
          Red card with a subtle border. The error message comes from
          mapDatabaseError() on the server, which translates noisy driver
          messages ("relation 'users' does not exist") into clean English
          ("Table not found: users"). We render it verbatim.
        */}
        <div className="flex items-start gap-2 px-3 py-2 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-xs font-mono max-w-full">
          {/* × symbol — simple and universally understood as an error indicator */}
          <span className="shrink-0 mt-px">✕</span>
          {/* break-all prevents long error messages (e.g. a SQL backtrace) from
              overflowing the panel horizontally */}
          <span className="break-all">{error}</span>
        </div>
      </div>
    );
  }

  // ── No query run yet ───────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">
          Run a query to see results
        </p>
      </div>
    );
  }

  // ── Non-SELECT command (INSERT / UPDATE / DELETE / CREATE / …) ─────────────
  // The server returns an empty columns array when the query had no tabular
  // output. This is normal — not an error. Show a success confirmation.
  if (result.columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#34d399] text-sm font-mono">
            Query executed successfully
          </p>
          <p className="text-[#4b5563] text-xs mt-1 font-mono">
            {result.rowCount}{" "}
            {result.rowCount === 1 ? "row" : "rows"} affected
            {" · "}
            {formatTime(result.executionTime)}
          </p>
        </div>
      </div>
    );
  }

  return <ResultsTable result={result} />;
}

// ===== SUB-COMPONENT =====

/**
 * ResultsTable — the actual table render, extracted so that the parent
 * DataGrid can return early for loading/error/empty states without nesting
 * deeply conditional JSX.
 *
 * WHY useMemo for numericColumns:
 *   isNumericColumn scans the rows array for each column. With large result
 *   sets (hundreds of rows × dozens of columns), that scan is non-trivial.
 *   Memoizing it means the scan runs once per `result` object, not once per
 *   render (which could fire during unrelated state changes in App.tsx).
 */
function ResultsTable({ result }: { result: QueryResult }) {
  // Pre-compute which column indices contain numeric data.
  const numericColumns = useMemo<Set<number>>(() => {
    return new Set(
      result.columns
        .map((_, i) => i)
        .filter((i) => isNumericColumn(i, result.rows))
    );
  }, [result]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      {/*
        Pinned above the table so it stays visible when scrolling.
        Shows row count and server-measured execution time.
        Using shrink-0 prevents the stats bar from collapsing when the table
        content is taller than the available panel height.
      */}
      <div className="shrink-0 flex items-center gap-2 px-3 h-7 border-b border-[#1f2033] bg-[#0d0d17] text-[10px] font-mono text-[#4b5563]">
        <span>
          {result.rowCount.toLocaleString()}{" "}
          {result.rowCount === 1 ? "row" : "rows"}
        </span>
        {/* Thin pipe separator */}
        <span className="text-[#1f2033]" aria-hidden="true">
          ·
        </span>
        <span>{formatTime(result.executionTime)}</span>
      </div>

      {/* ── Scrollable table wrapper ──────────────────────────────────────── */}
      {/*
        overflow-auto enables both horizontal and vertical scrolling.
        The sticky <thead> stays pinned to the top of THIS overflow container
        (not the viewport), which is the correct behavior for an inset panel.
        Without a defined overflow container, `position: sticky` would try to
        stick relative to the nearest scrolling ancestor — possibly the window.
      */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs font-mono">
          {/* ── Column headers ─────────────────────────────────────────────── */}
          <thead className="sticky top-0 z-10">
            <tr>
              {result.columns.map((col, colIdx) => (
                <th
                  key={colIdx}
                  // text-left overrides the default center alignment from Tailwind's
                  // Preflight reset. Numeric columns don't get special alignment in
                  // the header — the column name is always left-aligned for readability.
                  className="px-3 py-1.5 text-left text-[10px] uppercase tracking-wider text-[#4b5563] border-b border-[#1f2033] bg-[#0d0d17] whitespace-nowrap select-none"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>

          {/* ── Data rows ──────────────────────────────────────────────────── */}
          <tbody>
            {result.rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                // Subtle row separator + hover highlight for scannability.
                // The row index is used as key because SQL result rows don't have
                // stable identifiers — this is safe since rows are never reordered.
                className="border-b border-[#0f0f1f] hover:bg-[#0d0d17] transition-colors duration-75"
              >
                {row.map((cell, colIdx) => (
                  <td
                    key={colIdx}
                    className={[
                      "px-3 py-1.5 whitespace-nowrap",
                      // Prevent very wide text values (e.g. long VARCHAR) from
                      // stretching the column beyond a readable width. The overflow
                      // is clipped with an ellipsis rather than wrapping, which
                      // keeps rows a uniform height.
                      "max-w-[320px] overflow-hidden text-ellipsis",
                      // Numeric columns: right-aligned in light blue to distinguish
                      // them from text. The color echoes "cold" data (numbers, IDs)
                      // vs "warm" data (text descriptions) — a common DB GUI idiom.
                      numericColumns.has(colIdx)
                        ? "text-right text-[#7dd3fc]"
                        : "text-left text-[#ededf0]",
                    ].join(" ")}
                  >
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ── Zero-rows message ─────────────────────────────────────────────── */}
        {/*
          A SELECT that returned no rows is a success (not an error), but we still
          need to communicate it to the user — an empty table body looks like a
          render bug. Only shown when columns exist (we already handled the
          no-columns case above for non-SELECT commands).
        */}
        {result.rows.length === 0 && (
          <div className="flex items-center justify-center h-12 text-[#2d3047] text-xs italic font-mono">
            Query returned 0 rows
          </div>
        )}
      </div>
    </div>
  );
}
