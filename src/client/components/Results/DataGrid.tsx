/**
 * src/client/components/Results/DataGrid.tsx
 *
 * WHAT:
 *   Top-level state-router for the results panel. Selects which view to render
 *   based on the current query lifecycle state and delegates all table rendering
 *   to ResultsTable.
 *
 * ARCHITECTURE:
 *   DataGrid        — state router: loading / error / empty / non-SELECT / table
 *   └─ ResultsTable — TanStack Table + Virtual grid (ResultsTable.tsx)
 *      ├─ ResultsHeader  — stats bar + export button (ResultsHeader.tsx)
 *      ├─ SortIndicator  — column sort arrows (SortIndicator.tsx)
 *      └─ ColumnResizeHandle — drag handle on header cells (ColumnResizeHandle.tsx)
 *
 * WHY "h-full flex flex-col overflow-hidden" on the root:
 *   The parent panel in App.tsx gives this component flex-1 height. For virtual
 *   scroll to work, DataGrid must fill exactly that space and expose a scrollable
 *   inner container. overflow-hidden on the root prevents a second scrollbar from
 *   appearing on the page body.
 */

import type { QueryResult } from "../../types";
import { ResultsTable } from "./ResultsTable";

// ===== HELPERS =====

/**
 * formatTime — converts a millisecond duration to a human-readable string.
 * Re-exported here so the non-SELECT success banner can use it without importing
 * from ResultsHeader (which would create a cross-sibling dependency).
 *
 * Three tiers:
 *   < 1 ms   → "< 1 ms"
 *   ≥ 1000ms → "1.20 s"
 *   default  → "12.3 ms"
 */
function formatTime(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

// ===== TYPES =====

/** Props for the top-level DataGrid component. */
interface DataGridProps {
  /** Normalized result from the last successful query, or null if none has run. */
  result: QueryResult | null;
  /** Human-friendly error from the last failed query, or null. */
  error: string | null;
  /** True while a query is in flight. */
  loading: boolean;
}

// ===== COMPONENT =====

/**
 * DataGrid — routes to the correct view for the current query lifecycle state.
 *
 * Five states:
 *   loading    — spinner (query in flight)
 *   error      — error banner (last query failed)
 *   no result  — placeholder (no query has been run in this tab)
 *   non-SELECT — success banner (INSERT / UPDATE / DELETE / CREATE / …)
 *   results    — ResultsTable (SELECT returned tabular data)
 */
export function DataGrid({ result, error, loading }: DataGridProps) {
  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[#4b5563] text-xs animate-pulse font-mono">
          Running…
        </span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="h-full flex items-start p-3">
        <div className="flex items-start gap-2 px-3 py-2 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-xs font-mono max-w-full">
          <span className="shrink-0 mt-px">✕</span>
          <span className="break-all">{error}</span>
        </div>
      </div>
    );
  }

  // ── No query run yet ───────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">Run a query to see results</p>
      </div>
    );
  }

  // ── Non-SELECT statement (INSERT / UPDATE / DELETE / CREATE / …) ───────────
  // The server returns columns=[] when the statement produced no tabular output.
  if (result.columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#34d399] text-sm font-mono">Query executed successfully</p>
          <p className="text-[#4b5563] text-xs mt-1 font-mono">
            {result.rowCount} {result.rowCount === 1 ? "row" : "rows"} affected
            {" · "}
            {formatTime(result.executionTime)}
          </p>
        </div>
      </div>
    );
  }

  // ── SELECT result with tabular data ───────────────────────────────────────
  return <ResultsTable result={result} />;
}
