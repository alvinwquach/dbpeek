/**
 * src/client/types.ts — Shared client-side type definitions.
 *
 * WHY a separate file:
 *   QueryResult is needed by both the Zustand store (app.ts, where per-tab
 *   result state lives) and the query execution hook (useQuery.ts, which
 *   produces QueryResult values). Defining it in either file would create a
 *   circular import. A shared types module breaks the cycle cleanly.
 */

// ===== QUERY RESULT =====

/**
 * The normalized shape of a successful query response from POST /api/query.
 *
 * WHY rows-as-arrays (unknown[][]) instead of objects:
 *   The server serializes rows as arrays to preserve column order and to
 *   support duplicate column names (e.g. two columns named "id" from a JOIN).
 *   Key/value objects cannot represent duplicate keys.
 */
export interface QueryResult {
  /** Ordered column names, matching the projection in the SELECT clause. */
  columns: string[];
  /** Each row is an array of values in the same order as `columns`. */
  rows: unknown[][];
  /** Number of rows returned (or rows affected for non-SELECT statements). */
  rowCount: number;
  /** Wall-clock milliseconds from request send to first byte, measured server-side. */
  executionTime: number;
}
