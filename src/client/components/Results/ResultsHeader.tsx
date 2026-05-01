/**
 * src/client/components/Results/ResultsHeader.tsx
 *
 * WHAT:
 *   The stats bar pinned above the results table. Shows row count, execution
 *   time, and the ExportMenu button.
 *
 * WHY a separate file:
 *   ResultsHeader had no dependencies on TanStack Table or Virtual — it only
 *   needs the QueryResult shape and the ExportMenu. Extracting it keeps
 *   DataGrid.tsx and ResultsTable.tsx focused on their own concerns.
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
  /** Full result — passed to ExportMenu so it can build CSV/JSON directly. */
  result: QueryResult;
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
 */
export function ResultsHeader({ result }: ResultsHeaderProps) {
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

      <span className="text-[#6b7280]">
        {result.rowCount.toLocaleString()}{" "}
        {result.rowCount === 1 ? "row" : "rows"}
      </span>

      {/* Thin separator dot */}
      <span className="text-[#1f2033]" aria-hidden="true">·</span>

      <span>{formatTime(result.executionTime)}</span>

      {/* Push export button to the far right */}
      <div className="ml-auto">
        <ExportMenu result={result} />
      </div>
    </div>
  );
}
