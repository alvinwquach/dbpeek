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
 *
 * WHY the multi-statement fields are OPTIONAL on this same shape:
 *   The server returns a single envelope for both single- and multi-statement
 *   submissions (the multi case adds `statements`, `statementCount`, and
 *   `totalExecutionTime`). Putting them on the same type lets every consumer
 *   (the data grid, the export menu, the chart) keep reading the top-level
 *   columns/rows fields unchanged, while the small number of components that
 *   want to surface "Statement 2 of 4" or "Total: 123 ms" can opt in by
 *   reading the optional multi-statement fields.
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
  /**
   * The SQL string that produced this result, captured client-side at execute
   * time.
   *
   * WHY it lives on the result and not on the tab:
   *   The cell-editing flow needs to know which table a row came from so it
   *   can build the UPDATE WHERE clause. The user can keep typing in the
   *   editor after pressing Run — `tab.sql` drifts away from "the SQL that
   *   produced these rows". Pinning the executed SQL onto the result keeps
   *   the editability check honest no matter how long ago the query ran.
   *
   * NOT sent by the server. Set by useQueryExecution after a successful
   * single-statement run. Optional because legacy / multi-statement results
   * may omit it.
   */
  executedSql?: string;

  // ── Multi-statement metadata (present only when the user submitted a batch) ─

  /**
   * Per-statement results, in submission order. Present only when the SQL
   * contained more than one statement after SQL-aware splitting. Each entry
   * carries its own columns/rows/rowCount/executionTime plus a 1-based
   * `statementIndex` so the UI can label "Statement 2 of 4" without having
   * to count from the array index.
   */
  statements?: StatementResult[];
  /** Total statements in the batch (statements.length). Convenience field. */
  statementCount?: number;
  /** Sum of every statement's executionTime. NOT identical to the largest
   *  per-statement time — it's the wall-clock for the full sequential batch. */
  totalExecutionTime?: number;
}

/**
 * One statement's worth of result data inside a multi-statement batch response.
 *
 * Mirrors the server-side StatementResult interface exactly. Kept as a
 * separate type (rather than reusing QueryResult recursively) because a
 * StatementResult never contains a nested `statements` field — there is no
 * such thing as a multi-statement statement.
 */
export interface StatementResult {
  /** 1-based position of this statement in the submitted batch. */
  statementIndex: number;
  /** Ordered column names for THIS statement's SELECT projection. */
  columns: string[];
  /** Rows produced by THIS statement, in column order. */
  rows: unknown[][];
  /** Number of rows returned/affected by THIS statement. */
  rowCount: number;
  /** Wall-clock ms for THIS statement only (not the batch total). */
  executionTime: number;
}
