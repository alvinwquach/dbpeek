/**
 * src/client/hooks/useExplain.ts
 *
 * WHAT:
 *   Imperative React hook that wraps POST /api/explain. Mirrors the design of
 *   useQueryExecution: the caller invokes `explain(sql)`, the hook writes
 *   loading / data / error into the active tab in the Zustand store, and the
 *   panel reads those values back via a selector.
 *
 * WHY this hook exists separately from useQueryExecution:
 *   /api/explain has its own response shape (a recursive tree, not tabular
 *   rows) and its own per-tab state (explainData / explainError /
 *   explainLoading). Folding it into useQueryExecution would require shape
 *   discrimination on every call site that consumes the result. Two small
 *   focused hooks are easier to reason about than one branching hook.
 *
 * WHY no history entry:
 *   EXPLAIN is exploratory — running it many times against the same SQL
 *   would flood the history sidebar with noise that the user never wants to
 *   re-execute. The history list stays focused on actual query runs.
 */

import { useCallback } from "react";
import { useAppStore } from "../stores/app";

// ===== TYPES =====

/**
 * One node in the normalized plan tree (mirrors src/server/routes/explain.ts).
 *
 * WHY duplicated client-side:
 *   The client cannot import from src/server/* because the server tree pulls
 *   in knex / pg / mysql2 — Node-only modules that would break the Vite bundle.
 *   The shape is intentionally small and stable; if it ever drifts, the
 *   parser tests on the server will surface it.
 */
export interface ExplainNode {
  type: string;
  table: string | null;
  cost: number | null;
  rows: number | null;
  details: Record<string, unknown>;
  children: ExplainNode[];
}

/** Successful response from POST /api/explain. */
export interface ExplainResponse {
  plan: ExplainNode;
  raw: string;
}

/** Error response shape (HTTP 400 / 403). */
interface ExplainApiError {
  error: string;
}

// ===== HOOK =====

/**
 * useExplain — imperative hook that runs EXPLAIN for a SQL string.
 *
 * Returns just the `explain` function. Components reading loading / data /
 * error pull them from the active tab in the store, the same pattern as
 * useQueryExecution.
 */
export function useExplain(): { explain: (sql: string) => Promise<void> } {
  const setTabExplainState = useAppStore((s) => s.setTabExplainState);
  const getState = useAppStore.getState;

  const explain = useCallback(
    async (sql: string) => {
      const trimmed = sql.trim();
      if (!trimmed) return;

      // Pin the tab id at click time so a tab switch mid-flight doesn't
      // misroute the result. Same rationale as useQueryExecution.
      const { tabs, activeTabIndex } = getState();
      const tabId = tabs[activeTabIndex]?.id;
      if (!tabId) return;

      // Switch to the explain view at request start so the user sees the
      // loading state immediately, even if they were on the grid view.
      setTabExplainState(tabId, {
        loading: true,
        data: null,
        error: null,
      });

      try {
        const response = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: trimmed }),
        });

        const body = (await response.json()) as ExplainResponse | ExplainApiError;

        if (!response.ok || "error" in body) {
          const errorMsg =
            "error" in body ? body.error : `HTTP ${response.status}`;
          setTabExplainState(tabId, {
            loading: false,
            data: null,
            error: errorMsg,
          });
        } else {
          setTabExplainState(tabId, {
            loading: false,
            data: body,
            error: null,
          });
        }
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Network error — is the server running?";
        setTabExplainState(tabId, {
          loading: false,
          data: null,
          error: msg,
        });
      }
    },
    [setTabExplainState, getState]
  );

  return { explain };
}
