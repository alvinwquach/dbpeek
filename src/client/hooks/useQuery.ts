/**
 * src/client/hooks/useQuery.ts
 *
 * WHAT: React hook that executes SQL queries against the server and manages the
 * loading → success/error state machine for a single query execution.
 *
 * WHY: Centralises all fetch logic so components only call `execute(sql)` and
 * react to `{ loading, result, error }` — they never touch fetch() directly.
 * This keeps the state transitions atomic (all three fields flip in one
 * setState call, preventing the UI from briefly showing a stale result while
 * loading is still false).
 *
 * HOW: Imported by App.tsx, which owns the hook instance and threads the return
 * values down to EditorPane (execute) and ResultsPane/DataGrid (result, error,
 * loading). The Zustand store is updated here (addHistoryEntry) so the history
 * panel stays in sync without coupling it to the component tree.
 */

import { useCallback, useState } from 'react';
import { useAppStore } from '@/stores/app';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The normalised result of a successful POST /api/query call.
 *
 * NOTE: The server returns rows as plain objects (Record<string, unknown>) keyed
 * by column name. We keep that shape here rather than converting to any[][] so
 * DataGrid can index by column name in the correct column order without extra
 * array index arithmetic.
 */
export interface QueryResult {
  /** Ordered list of column names matching the SELECT clause. */
  columns: string[];
  /** One object per result row — keys are column names, values are raw data. */
  rows: Record<string, unknown>[];
  /** Number of rows in the result set (0 for non-SELECT statements). */
  rowCount: number;
  /** Wall-clock milliseconds for the full database round-trip. */
  executionTime: number;
}

/**
 * Internal state object — kept as a single record so all three fields can be
 * updated atomically in one setState call, preventing intermediate renders
 * where loading is false but result/error haven't landed yet.
 */
interface QueryState {
  /** True while the fetch is in-flight. */
  loading: boolean;
  /** Populated on success; null otherwise. */
  result: QueryResult | null;
  /** Human-readable error message on failure; null otherwise. */
  error: string | null;
}

/**
 * The public interface returned by useQuery.
 *
 * @example
 *   const { execute, loading, result, error } = useQuery();
 *   <button onClick={() => execute('SELECT 1')}>Run</button>
 *   {loading && <Spinner />}
 *   {result && <DataGrid result={result} />}
 *   {error && <p className="text-danger">{error}</p>}
 */
export interface UseQueryReturn {
  /** Call with a SQL string to execute it. Returns a promise that resolves when done. */
  execute: (sql: string) => Promise<void>;
  /** True while the HTTP request is in-flight. */
  loading: boolean;
  /** The last successful result; null before the first run or after an error. */
  result: QueryResult | null;
  /** The last error message; null before the first run or after a success. */
  error: string | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * useQuery
 *
 * Manages the full lifecycle of a SQL query execution: sending the request,
 * tracking loading state, parsing the response, and recording the run in
 * query history.
 *
 * State machine:
 *   idle    → execute() called → loading
 *   loading → HTTP 2xx        → success (result populated, error null)
 *   loading → HTTP 4xx        → error   (result null, error populated)
 *   loading → network failure → error   (result null, error populated)
 *
 * @returns execute function and reactive state fields.
 *
 * @example
 *   const { execute, loading, result, error } = useQuery();
 *   // In a keymap handler:
 *   execute('SELECT * FROM users LIMIT 10');
 */
export function useQuery(): UseQueryReturn {
  // Single state object so all three fields always transition together.
  // If they were separate useState calls, React might batch them differently
  // in async contexts and produce a transient render where loading=false but
  // result is still null.
  const [state, setState] = useState<QueryState>({
    loading: false,
    result: null,
    error: null,
  });

  // Read only the action we need from the store — not any reactive state —
  // so this hook doesn't re-render when unrelated store fields change.
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry);

  /**
   * execute
   *
   * Sends the SQL to POST /api/query, transitions through loading → success/error,
   * and records the run in query history.
   *
   * PSEUDOCODE:
   *   1. Immediately transition to loading state (clear previous result/error).
   *   2. POST /api/query with { sql } as JSON body.
   *   3. Parse the JSON response.
   *   4. If the HTTP status is not 2xx:
   *      a. Extract the error message from data.error.
   *      b. Transition to error state atomically.
   *      c. Record a failed history entry (success: false).
   *   5. If HTTP 2xx:
   *      a. Build a QueryResult from the response fields.
   *      b. Transition to success state atomically.
   *      c. Record a successful history entry with rowCount + executionTime.
   *   6. On network/parse failure (catch):
   *      a. Transition to error state with a generic network message.
   *      b. Record a failed history entry with executionTime: 0.
   *
   * @param sql - The SQL string to execute. Sent verbatim to the server.
   * @returns    Promise<void> — resolves when the request completes (either way).
   *
   * @example
   *   await execute('SELECT id, name FROM users LIMIT 5');
   */
  // NOTE: useCallback gives `execute` a stable function identity across renders.
  //
  // Without it, React would create a brand-new `execute` function object on
  // every render of whatever component calls useQuery(). That matters here
  // because:
  //   1. App.tsx wraps `execute` in its own useCallback (handleRun) with
  //      [execute] in the dependency array. If `execute` changes every render,
  //      handleRun also changes every render.
  //   2. handleRun is passed as the `onRun` prop to SqlEditor, which stores it
  //      in an onRunRef via a useEffect([onRun]). If onRun keeps changing, that
  //      effect fires on every render — harmless but wasteful.
  //
  // With useCallback, execute is only recreated when addHistoryEntry changes
  // (which is never, because Zustand action references are stable). So execute
  // → handleRun → onRunRef all stay rock-solid across the component lifetime.
  const execute = useCallback(
    async (sql: string) => {
      // Step 1 — enter loading. Clearing result and error here ensures DataGrid
      // never shows stale data from a previous run while the new one is in-flight.
      setState({ loading: true, result: null, error: null });

      try {
        // Step 2 — POST the SQL. The Vite dev server proxies /api/* to Express
        // (see vite.config.ts), so no CORS headers or absolute URLs are needed.
        const res = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        });

        // Step 3 — parse JSON. We cast loosely here and validate fields below
        // because the server error body has a different shape than the success body.
        const data = (await res.json()) as Record<string, unknown>;

        if (!res.ok) {
          // Step 4 — server returned a 4xx (permission denied, SQL error, etc.).
          // The server always includes a human-readable `error` field; fall back
          // to a generic message if parsing fails for any reason.
          const errorMessage =
            typeof data['error'] === 'string' ? data['error'] : 'Query failed.';

          // The server includes executionTime even on error so we can show how
          // long it took before the DB rejected the query.
          const executionTime =
            typeof data['executionTime'] === 'number' ? data['executionTime'] : 0;

          setState({ loading: false, result: null, error: errorMessage });

          addHistoryEntry({
            sql,
            timestamp: Date.now(),
            rowCount: 0,
            executionTime,
            success: false,
          });
        } else {
          // Step 5 — successful response. Build the typed QueryResult and transition
          // atomically so DataGrid gets all fields at once.
          const result: QueryResult = {
            columns: data['columns'] as string[],
            rows: data['rows'] as Record<string, unknown>[],
            rowCount: data['rowCount'] as number,
            executionTime: data['executionTime'] as number,
          };

          setState({ loading: false, result, error: null });

          addHistoryEntry({
            sql,
            timestamp: Date.now(),
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            success: true,
          });
        }
      } catch {
        // Step 6 — network failure (server down, DNS error, parse error).
        // We don't re-throw because the UI handles all error display.
        setState({
          loading: false,
          result: null,
          error: 'Network error: could not reach the server.',
        });

        addHistoryEntry({
          sql,
          timestamp: Date.now(),
          rowCount: 0,
          executionTime: 0,
          success: false,
        });
      }
    },
    // addHistoryEntry is stable (Zustand actions never change identity), so
    // execute itself is stable — no unnecessary re-creates on each render.
    [addHistoryEntry]
  );

  return {
    execute,
    loading: state.loading,
    result: state.result,
    error: state.error,
  };
}
