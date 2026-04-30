/**
 * src/client/hooks/useQuery.ts
 *
 * WHAT:
 *   A React hook that wraps POST /api/query and manages loading / error / result
 *   state for a single SQL execution session.
 *
 * WHY a custom hook instead of TanStack Query:
 *   TanStack's useQuery is designed for declarative, auto-fetching queries (e.g.
 *   "always show the latest data for key X"). A SQL editor needs an IMPERATIVE
 *   trigger: run exactly when the user presses Cmd+Enter, not automatically on
 *   mount or on focus. TanStack's useMutation is closer, but adds ~5 KB for
 *   retries and devtools we don't need. A 40-line custom hook is the right tool.
 *
 * WHY the export is named useQueryExecution (not useQuery):
 *   TanStack Query's useQuery is a named export that may be imported in the same
 *   file or component. Naming this hook useQuery would create a collision at the
 *   import site. useQueryExecution is unambiguous: it executes a query imperatively.
 *
 * HOW IT WORKS:
 *   1. Caller invokes `execute(sql)` — typically from the SqlEditor's onRun prop.
 *   2. Hook sets loading=true, clears previous result and error.
 *   3. Sends POST /api/query with { sql } in the body.
 *   4. On success: sets result, pushes a success HistoryEntry to Zustand.
 *   5. On error (HTTP 4xx or network failure): sets error, pushes failure entry.
 *   6. Resets loading=false in the finally block.
 *
 * WHY history is written here (not in the component):
 *   The hook is the only place that knows whether the request succeeded or failed
 *   and what the exact executionTime was. Centralizing the history write keeps
 *   the component layer free of that bookkeeping.
 */

import { useState, useCallback } from "react";
import { useAppStore, type HistoryEntry } from "../stores/app";

// ===== TYPES =====

/**
 * The normalized shape of a successful query response from /api/query.
 * Mirrors the server's NormalizedResult + executionTime field.
 *
 * WHY rows-as-arrays (unknown[][]) instead of objects:
 *   The server serializes rows as arrays (not key/value objects) to preserve
 *   column order and to support duplicate column names (e.g. two columns both
 *   named "id" from a JOIN). See src/server/routes/query.ts for details.
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

/** Shape of the JSON body for a successful /api/query response (HTTP 200). */
interface QueryApiSuccess {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
}

/** Shape of the JSON body for an error /api/query response (HTTP 400 / 403). */
interface QueryApiError {
  error: string;
}

// ===== HOOK =====

/**
 * useQueryExecution — imperative hook for running a SQL query.
 *
 * @returns
 *   execute  — async function that fires the query. Safe to call concurrently
 *              (later calls will overwrite earlier state), but the typical usage
 *              is one call at a time (Cmd+Enter while loading is already visible).
 *   loading  — true while the fetch is in-flight.
 *   result   — the normalized result from the last successful execution, or null.
 *   error    — the human-friendly error message from the last failed execution, or null.
 *
 * WHY useCallback with [addHistoryEntry] dep:
 *   addHistoryEntry is stable across renders (Zustand actions don't change
 *   reference). useCallback memoizes execute so callers that receive it as a
 *   prop (e.g. SqlEditor's onRun) don't trigger unnecessary re-renders.
 */
export function useQueryExecution(): {
  execute: (sql: string) => Promise<void>;
  loading: boolean;
  result: QueryResult | null;
  error: string | null;
} {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Pull only the action (stable reference) — not the full history array.
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry);

  const execute = useCallback(
    async (sql: string) => {
      const trimmed = sql.trim();

      // Guard: don't fire a request for empty SQL. The editor's placeholder
      // text is never part of the document (CM treats it as decorative), so
      // the only way to get an empty string here is if the user cleared the editor.
      if (!trimmed) return;

      // Reset state for the new run.
      setLoading(true);
      setError(null);
      setResult(null);

      try {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: trimmed }),
        });

        // Parse JSON regardless of status — error responses also carry JSON bodies.
        const data = (await response.json()) as QueryApiSuccess | QueryApiError;

        if (!response.ok || "error" in data) {
          // ── Query failed (permission denied, syntax error, missing table, …) ──
          const errorMsg =
            "error" in data ? data.error : `HTTP ${response.status}`;
          setError(errorMsg);

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            sql: trimmed,
            executedAt: new Date(),
            success: false,
          };
          addHistoryEntry(entry);
        } else {
          // ── Query succeeded ────────────────────────────────────────────────
          const successData = data as QueryApiSuccess;

          setResult({
            columns: successData.columns,
            rows: successData.rows,
            rowCount: successData.rowCount,
            executionTime: successData.executionTime,
          });

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            sql: trimmed,
            executedAt: new Date(),
            success: true,
            rowCount: successData.rowCount,
            executionTime: successData.executionTime,
          };
          addHistoryEntry(entry);
        }
      } catch (err) {
        // Network failure (no internet, server not running, CORS block, etc.)
        const msg =
          err instanceof Error ? err.message : "Network error — is the server running?";
        setError(msg);

        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          sql: trimmed,
          executedAt: new Date(),
          success: false,
        };
        addHistoryEntry(entry);
      } finally {
        setLoading(false);
      }
    },
    [addHistoryEntry]
  );

  return { execute, loading, result, error };
}
