/**
 * src/client/components/Results/DataGrid.tsx
 *
 * WHAT: Renders the result of a SQL query as a plain HTML table, with separate
 * visual states for idle, loading, error, and success.
 *
 * WHY: Decoupling the display from the fetch logic makes DataGrid easy to test
 * and reuse — it renders whatever it receives as props and knows nothing about
 * how the data was fetched. The parent (App/ResultsPane) owns the query state
 * and passes it down.
 *
 * HOW: Imported by ResultsPane in App.tsx, which threads result/error/loading
 * from the useQuery hook. DataGrid does NOT read from the Zustand store; all
 * data flows in through props.
 *
 * NOTE: This is a Phase 1 implementation using a plain <table>. Phase 2 will
 * replace it with @tanstack/react-table for virtualisation, column resizing,
 * and sorting — but the prop interface will stay the same.
 */

import type { QueryResult } from '@/hooks/useQuery';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DataGridProps {
  /**
   * The last successful query result; null if no query has run yet or the last
   * one failed.
   */
  result: QueryResult | null;
  /**
   * Human-readable error message from the last failed query; null otherwise.
   */
  error: string | null;
  /**
   * True while a query is in-flight. When true, result and error are both null.
   */
  loading: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * formatTime
 *
 * Converts a millisecond duration into a compact display string.
 * Sub-millisecond results show as "<1ms" to avoid displaying "0.0ms".
 * Results over one second switch to seconds for readability.
 *
 * @param ms - Duration in milliseconds (may be a float from process.hrtime).
 * @returns   Human-readable string like "<1ms", "12.4ms", or "1.23s".
 *
 * @example
 *   formatTime(0.4)    // "<1ms"
 *   formatTime(12.4)   // "12.4ms"
 *   formatTime(1234.5) // "1.23s"
 */
function formatTime(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * DataGrid
 *
 * Displays query results in a scrollable table. Handles four distinct states:
 *
 *   idle    — neither loading nor result nor error → shows "Ready"
 *   loading — query is in-flight                  → shows "Running…"
 *   error   — last query failed                   → shows error in danger colour
 *   success — last query returned rows            → shows scrollable table
 *
 * The results header always shows the "Results" label. When a successful result
 * is present it additionally shows the row count and execution time on the right.
 *
 * PSEUDOCODE:
 *   1. Compute rowLabel — "N rows • Xms" — only if result is non-null.
 *   2. Decide which body to render:
 *      a. loading  → "Running…" text
 *      b. error    → error message in danger colour
 *      c. no result → "Ready" text (idle state)
 *      d. no columns → "N rows affected" (non-SELECT statement result)
 *      e. columns present → render the full <table>
 *   3. Render header (always) + chosen body.
 *
 * @param result  - Successful query result, or null.
 * @param error   - Error message string, or null.
 * @param loading - True while the query is in-flight.
 *
 * @example
 *   <DataGrid result={result} error={error} loading={loading} />
 */
export function DataGrid({ result, error, loading }: DataGridProps) {
  // Step 1 — build the header annotation shown to the right of "Results".
  // We only compute this string when a result exists so TypeScript knows
  // result is non-null inside the template literal.
  const rowLabel =
    result !== null
      ? `${result.rowCount} ${result.rowCount === 1 ? 'row' : 'rows'} \u2022 ${formatTime(result.executionTime)}`
      : null;

  // Step 2 — pick the body based on the current state.
  let body: React.ReactNode;

  if (loading) {
    // Step 2a — query is in-flight. The ellipsis is a unicode character so it
    // renders as a single glyph rather than three separate dots.
    body = (
      <div className="px-4 py-3 text-sm text-muted">Running\u2026</div>
    );
  } else if (error) {
    // Step 2b — the last query returned a non-2xx status or a network failure.
    // We display the server's human-readable message (already mapped from raw
    // driver error codes in server/routes/query.ts → mapDbError).
    body = (
      <div className="px-4 py-3 text-sm text-danger leading-relaxed">{error}</div>
    );
  } else if (result === null) {
    // Step 2c — idle state: no query has been run yet in this session.
    body = (
      <div className="px-4 py-3 text-sm text-muted">Ready</div>
    );
  } else if (result.columns.length === 0) {
    // Step 2d — the query ran successfully but returned no columns. This happens
    // for non-SELECT statements (INSERT, UPDATE, DELETE, CREATE, etc.) whose
    // result has no rows array — only a rowCount from the driver's affectedRows.
    body = (
      <div className="px-4 py-3 text-sm text-muted">
        {result.rowCount} {result.rowCount === 1 ? 'row' : 'rows'} affected
      </div>
    );
  } else {
    // Step 2e — full table render.
    //
    // NOTE: We use a plain <table> for Phase 1 rather than @tanstack/react-table.
    // The tradeoff is simplicity: no virtualisation means very large result sets
    // (>10k rows) will be slow to render. That's acceptable for a Phase 1 tool
    // aimed at exploratory queries, which typically return small result sets.
    body = (
      // overflow-auto on the wrapper lets the table scroll both horizontally
      // (many columns) and vertically (many rows) independently of the rest of
      // the layout. Without this, a wide table would push the sidebar off screen.
      <div className="flex-1 overflow-auto">
        <table className="text-xs font-mono w-full border-collapse">
          <thead>
            <tr>
              {result.columns.map((col) => (
                <th
                  key={col}
                  // sticky top-0 keeps the header visible as the user scrolls
                  // through a long result set. bg-surface gives it a solid
                  // background so rows don't bleed through behind it.
                  className="sticky top-0 px-3 py-2 text-left text-muted font-semibold bg-surface border-b border-border whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              // NOTE: Using rowIndex as the key is safe here because the result
              // set is immutable — we never reorder or insert rows in place.
              // If we added sorting later, we'd need a stable row identifier.
              <tr
                key={rowIndex}
                className="border-b border-border hover:bg-surface transition-colors"
              >
                {result.columns.map((col) => {
                  // Index the row object by column name to preserve the column
                  // order from the SELECT clause. Using Object.values(row) would
                  // rely on insertion-order stability, which is not guaranteed
                  // across all JS engines for non-integer keys.
                  const val = row[col];
                  return (
                    <td key={col} className="px-3 py-1.5 whitespace-nowrap text-primary">
                      {val === null || val === undefined ? (
                        // Display null/undefined as italic "null" in muted colour
                        // so it's visually distinct from the string "null".
                        <span className="text-muted italic">null</span>
                      ) : (
                        // Convert everything else to a string. This handles numbers,
                        // booleans, dates (returned as strings by most drivers), and
                        // nested objects (rare, but toString() beats a silent blank).
                        String(val)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Step 3 — render the header bar and the selected body.
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Results header — always visible regardless of state */}
      <div className="px-4 py-1.5 border-b border-border bg-surface shrink-0 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
          Results
        </span>

        {/*
          Row count and execution time — only shown when a result is present.
          tabular-nums prevents the number from shifting width as it changes,
          which would cause the layout to jitter between queries.
        */}
        {rowLabel !== null && (
          <span className="text-[11px] text-muted tabular-nums">{rowLabel}</span>
        )}
      </div>

      {body}
    </div>
  );
}
