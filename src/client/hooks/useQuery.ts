/**
 * src/client/hooks/useQuery.ts
 *
 * WHAT:
 *   A React hook that wraps POST /api/query and manages loading / error / result
 *   state for a single SQL execution session. Also exposes a cancel() function
 *   that aborts the in-flight fetch and sends POST /api/query/cancel to kill
 *   the server-side query process.
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
 *   2. Hook reads the active tab id from the Zustand store, then:
 *        a. Creates an AbortController and stores it in abortRef so cancel() can
 *           reach it across the async lifecycle.
 *        b. Immediately sets loading=true, result=null, error=null on that tab.
 *        c. Sends POST /api/query with { sql } in the body + the AbortSignal.
 *        d. On success: writes result + success history entry into the tab.
 *        e. On abort:   clears loading, writes no error, skips history entry.
 *        f. On error:   writes error message + failure history entry into the tab.
 *        g. Finally:    clears abortRef.current so cancel() is a no-op again.
 *   3. Derived tab state (loading, result, error) is read back by the caller via
 *      selectors — the hook itself returns only execute and cancel.
 *
 * WHY result/error/loading moved from local useState into the Zustand tab:
 *   Local state was lost on every tab switch, so switching back to a tab that had
 *   just run a query showed a blank results panel. Per-tab state in the store
 *   survives tab switches — the results panel instantly restores on re-activation.
 *
 * WHY history is written here (not in the component):
 *   The hook is the only place that knows whether the request succeeded or failed
 *   and what the exact executionTime was. Centralising the history write keeps
 *   the component layer free of that bookkeeping.
 *
 * WHY cancel() is on the hook (not a global utility):
 *   cancel() needs the AbortController that was created inside the most recent
 *   execute() call. A useRef inside the hook is the right scope: it lives as
 *   long as the component that called the hook, is accessible to both execute
 *   and cancel, and does not trigger re-renders when it changes.
 */

import { useCallback, useRef } from "react";
import { useAppStore, type HistoryEntry } from "../stores/app";

// Re-export QueryResult from the shared types file so existing callers that
// import it from this module continue to compile without changes.
export type { QueryResult, StatementResult } from "../types";

import type { StatementResult } from "../types";

// ===== INTERNAL TYPES =====

/**
 * Shape of the JSON body for a successful /api/query response (HTTP 200).
 *
 * The multi-statement fields (statements, statementCount, totalExecutionTime)
 * are present only when the user submitted more than one statement. The
 * top-level columns/rows/rowCount/executionTime are ALWAYS present — for
 * multi-statement responses, they mirror the LAST statement so legacy
 * single-statement consumers can render something sensible without code
 * changes. See server/routes/query.ts for the contract.
 */
interface QueryApiSuccess {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  executionTime: number;
  statements?: StatementResult[];
  statementCount?: number;
  totalExecutionTime?: number;
}

/**
 * Shape of the JSON body for an error /api/query response (HTTP 400 / 403).
 *
 * For multi-statement runtime errors, `statementIndex`, `statementCount`, and
 * `completed` are also populated so the UI can show "Statement 2 of 4 failed"
 * along with whatever earlier statements DID complete. These are absent for
 * single-statement errors and for permission denials.
 */
interface QueryApiError {
  error: string;
  statementIndex?: number;
  statementCount?: number;
  completed?: StatementResult[];
}

// ===== HOOK =====

/**
 * useQueryExecution — imperative hook for running and cancelling a SQL query.
 *
 * @returns
 *   execute — async function that fires the query against the currently active
 *             tab. Results are written into that tab's slot in the Zustand store,
 *             so they persist across tab switches.
 *
 *   cancel  — function that aborts the in-flight fetch (via AbortController) and
 *             sends POST /api/query/cancel to interrupt the database-side query.
 *             Safe to call when no query is running — it is a no-op in that case.
 *
 * Components that need loading / result / error read them directly from the
 * store via a selector keyed on the active tab id:
 *   const tab = useAppStore((s) => s.tabs[s.activeTabIndex]);
 *   tab.loading / tab.result / tab.error
 */
export function useQueryExecution(): {
  execute: (
    sql: string,
    params?: unknown[] | Record<string, string>
  ) => Promise<void>;
  cancel: () => void;
} {
  // Pull only stable action references — not reactive slices — to avoid
  // re-renders every time any tab's query state changes.
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry);
  const setTabQueryState = useAppStore((s) => s.setTabQueryState);
  const updateTab = useAppStore((s) => s.updateTab);

  // getState() is the Zustand escape hatch for reading state inside a callback
  // without creating a subscription. We use it inside execute() so we always
  // capture the tab id that was active at the moment the user pressed Run,
  // rather than the id at the time the hook was last rendered.
  const getState = useAppStore.getState;

  // ── AbortController ref ──────────────────────────────────────────────────
  // Holds the AbortController for the most recently started execute() call.
  // A ref (not state) because changing it must NOT trigger a re-render — it is
  // purely internal plumbing between execute() and cancel(). Cleared to null in
  // execute()'s finally block so cancel() is a no-op once the query finishes.
  const abortRef = useRef<AbortController | null>(null);

  // ===== CANCEL =====

  /**
   * cancel — interrupts the currently running query.
   *
   * WHAT it does (in order):
   *   1. Fires POST /api/query/cancel (fire-and-forget) so the database-side
   *      process is killed. This is intentionally sent BEFORE abort() so the
   *      kill request races ahead to the server while the browser is unwinding
   *      the fetch abort on the main thread.
   *   2. Calls abortRef.current.abort(), which causes the pending fetch() in
   *      execute() to throw an AbortError. execute()'s catch block detects it
   *      and clears loading=false without writing an error message or history
   *      entry.
   *
   * WHY fire-and-forget for the cancel request:
   *   The cancel is best-effort. If the query already finished before the cancel
   *   arrives, the server returns { cancelled: false, reason: "No active query" }
   *   which is harmless. Awaiting the response would add latency to the UI state
   *   update for no benefit — the fetch abort handles the client-side state
   *   cleanup independently.
   *
   * WHY no history entry on cancel:
   *   A cancelled query is neither a success nor a meaningful failure — it was
   *   deliberately stopped by the user. Adding it to history would pollute the
   *   list with noise that doesn't help re-run or diagnose anything.
   */
  const cancel = useCallback(() => {
    if (!abortRef.current) return;

    // Tell the server to kill the database-side query. Fire-and-forget.
    fetch("/api/query/cancel", { method: "POST" }).catch(() => {
      // Intentionally swallowed — cancel is best-effort. The server may
      // return { cancelled: false } if the query already finished.
    });

    // Abort the fetch. This causes execute()'s catch to run with an AbortError,
    // which clears loading=false without writing an error or history entry.
    abortRef.current.abort();
  }, []);

  // ===== EXECUTE =====

  const execute = useCallback(
    async (
      sql: string,
      params?: unknown[] | Record<string, string>
    ) => {
      const trimmed = sql.trim();

      // Guard: don't fire a request for empty SQL. The editor's placeholder
      // text is never part of the document (CM treats it as decorative), so
      // the only way to get an empty string here is if the user cleared the editor.
      if (!trimmed) return;

      // Snapshot the active tab id at the moment Run is pressed.
      // We pin this id for the entire async lifecycle so that if the user
      // switches tabs while a query is running, the result lands in the
      // correct tab (the one that initiated the request), not the new active one.
      const { tabs, activeTabIndex } = getState();
      const tabId = tabs[activeTabIndex]?.id;
      if (!tabId) return;

      // Create a fresh AbortController for this request. Any previous request
      // has already completed (execute() is not re-entrant from a single tab).
      const controller = new AbortController();
      abortRef.current = controller;

      // ── Start loading ──────────────────────────────────────────────────────
      setTabQueryState(tabId, { loading: true, result: null, error: null });

      try {
        const response = await fetch("/api/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Omit params from the JSON body when undefined so the server treats
          // the request as a plain (non-parameterized) query.
          body: JSON.stringify(
            params !== undefined ? { sql: trimmed, params } : { sql: trimmed }
          ),
          // Attach the abort signal so AbortController.abort() cancels this fetch.
          signal: controller.signal,
        });

        // Parse JSON regardless of status — error responses also carry JSON bodies.
        const data = (await response.json()) as QueryApiSuccess | QueryApiError;

        if (!response.ok || "error" in data) {
          // ── Query failed (permission denied, syntax error, missing table, …) ──
          const errorMsg =
            "error" in data ? data.error : `HTTP ${response.status}`;

          setTabQueryState(tabId, { loading: false, result: null, error: errorMsg });

          const entry: HistoryEntry = {
            id: crypto.randomUUID(),
            sql: trimmed,
            executedAt: new Date(),
            success: false,
          };
          addHistoryEntry(entry);
        } else {
          // ── Query succeeded ────────────────────────────────────────────────
          // For multi-statement batches, copy the per-statement metadata
          // (statements, statementCount, totalExecutionTime) onto the result
          // alongside the standard top-level fields. The top-level fields
          // mirror the LAST statement (server contract), so legacy components
          // that only read columns/rows/rowCount continue to render the
          // final result. Components that opt in to multi-statement awareness
          // (e.g. a "2 of 4" status badge) read the optional fields.
          const successData = data as QueryApiSuccess;

          setTabQueryState(tabId, {
            loading: false,
            result: {
              columns: successData.columns,
              rows: successData.rows,
              rowCount: successData.rowCount,
              executionTime: successData.executionTime,
              // Pin the SQL we just ran onto the result so the cell-edit flow
              // can decide editability without consulting the editor's live
              // buffer (which the user may have changed since pressing Run).
              executedSql: trimmed,
              ...(successData.statements
                ? {
                    statements: successData.statements,
                    statementCount: successData.statementCount,
                    totalExecutionTime: successData.totalExecutionTime,
                  }
                : {}),
            },
            error: null,
          });

          // Update tab title to include row count.
          const tab = getState().tabs.find((t) => t.id === tabId);
          if (tab) {
            const newTitle = `${tab.baseTitle} (${successData.rowCount} row${successData.rowCount !== 1 ? "s" : ""})`;
            updateTab(tabId, { title: newTitle });
          }

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
        // ── Abort (user pressed Cancel) ────────────────────────────────────
        // AbortController.abort() causes fetch() to throw a DOMException with
        // name "AbortError". We detect it here and clear loading without writing
        // an error message or a history entry — the cancellation was intentional.
        if (err instanceof Error && err.name === "AbortError") {
          setTabQueryState(tabId, { loading: false, result: null, error: null });
          return;
        }

        // ── Network failure ────────────────────────────────────────────────
        // No internet, server not running, CORS block, etc.
        const msg =
          err instanceof Error
            ? err.message
            : "Network error — is the server running?";

        setTabQueryState(tabId, { loading: false, result: null, error: msg });

        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          sql: trimmed,
          executedAt: new Date(),
          success: false,
        };
        addHistoryEntry(entry);
      } finally {
        // Clear the controller so cancel() becomes a no-op until the next
        // execute() call creates a fresh one.
        abortRef.current = null;
      }
    },
    [addHistoryEntry, setTabQueryState, getState, updateTab]
  );

  return { execute, cancel };
}
