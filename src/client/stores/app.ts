/**
 * src/client/stores/app.ts — Global Zustand store for the dbpeek SPA.
 *
 * ARCHITECTURE:
 *   - Single store, colocated state + actions (Zustand recommended pattern).
 *   - ALL state is in-memory only. No localStorage, sessionStorage, or IndexedDB.
 *     When the browser tab is closed, everything is gone. This is intentional:
 *     dbpeek is a read-explore-discard tool, not a persistent workspace.
 *   - The store is a plain React hook (useAppStore). Any component can read from
 *     it using a selector: `const x = useAppStore((s) => s.x)`.
 *
 * USAGE:
 *   import { useAppStore } from '../stores/app'
 *   const dialect = useAppStore((s) => s.connectionInfo?.dialect)
 *
 * [source: Zustand — Creating a Store with State & Actions]
 * [source: Zustand — Using the Store in Components]
 */

import { create } from "zustand";
import type { SchemaMap, SchemaColumns } from "../hooks/useSchema";
import type { QueryResult } from "../types";
import type { ExplainResponse } from "../hooks/useExplain";

// ===== EXPORTED TYPES =====
// These are defined here (alongside the store) because they describe the shape
// of the application's domain objects. Keeping them colocated avoids a separate
// types.ts that would need constant synchronisation with the store.

/**
 * The payload returned by GET /api/status.
 * Passwords are never included — they stay inside the Knex pool config.
 */
export interface StatusResponse {
  dialect: string;
  host: string;
  port: number;
  database: string;
  user: string;
  mode: string;
  connected: boolean;
}

/** Which panel is shown below the query editor for a query result. */
export type ViewMode = "grid" | "chart" | "explain";

/**
 * A single editor tab. Each tab owns its SQL buffer, query result, error
 * message, loading state, and view mode independently. Switching tabs
 * restores the full state of the previous session without re-fetching.
 *
 * WHY result/error/loading live here instead of in a local hook:
 *   useQueryExecution previously held these as local useState values, which
 *   meant switching tabs would always show a blank result panel. Moving them
 *   into the store lets each tab keep its last result visible across switches.
 */
export interface Tab {
  id: string;
  title: string;
  /** Base title without row count, used to reset title when SQL changes. */
  baseTitle: string;
  /** Live SQL content, kept in sync with the CodeMirror document on every keystroke. */
  sql: string;
  /** The most recent successful query result for this tab, or null if none yet. */
  result: QueryResult | null;
  /** Human-readable error from the most recent failed execution, or null. */
  error: string | null;
  /** True while a query fetch is in-flight for this tab. */
  loading: boolean;
  /** Which result panel view is active for this tab. */
  viewMode: ViewMode;
  /**
   * Monotonically increasing counter, incremented by loadSqlFromHistory().
   * SqlEditor watches this via a dedicated effect: when it ticks up, the
   * effect dispatches a CodeMirror document-replacement transaction so the
   * editor reflects the newly loaded SQL without the user having to switch
   * tabs. This separates "external SQL injection" from normal keystrokes,
   * which flow in the opposite direction (editor → store via onChange).
   */
  loadNonce: number;

  // ── EXPLAIN state ──────────────────────────────────────────────────────────
  // Mirrors the result/error/loading triplet above but for POST /api/explain.
  // Kept per-tab so switching tabs restores the last EXPLAIN view without a
  // re-fetch (same survivability rationale as the query result fields).

  /** Most recent EXPLAIN response for this tab, or null if none yet. */
  explainData: ExplainResponse | null;
  /** Most recent EXPLAIN error message for this tab, or null. */
  explainError: string | null;
  /** True while POST /api/explain is in flight for this tab. */
  explainLoading: boolean;
}

/**
 * One entry in the query history sidebar.
 * Capped at 200 entries (oldest are dropped) to keep memory bounded.
 */
export interface HistoryEntry {
  id: string;
  sql: string;
  executedAt: Date;
  success: boolean;
  /** Number of rows returned (undefined for non-SELECT queries). */
  rowCount?: number;
  /** Wall-clock milliseconds from send to first byte. */
  executionTime?: number;
}

// ===== STORE SHAPE =====

interface AppState {
  // ── State ──────────────────────────────────────────────────────────────────

  /** Populated by StatusBar on mount via GET /api/status. Null = not yet loaded. */
  connectionInfo: StatusResponse | null;

  // ── Schema state (populated by useSchema on mount) ─────────────────────────

  /**
   * Table → column-name-array map consumed by @codemirror/lang-sql's `schema`
   * option.  Null = schema not yet loaded.
   * Example: { users: ["id", "email"], orders: ["id", "user_id", "total"] }
   */
  schemaMap: SchemaMap | null;

  /**
   * Table → ColumnInfo-array map with rich metadata (type, nullable, PK/FK/index).
   * Null = schema not yet loaded.  Used by the sidebar tree (Phase 3).
   */
  schemaColumns: SchemaColumns | null;

  /**
   * Table → estimated row count, populated alongside schemaMap by useSchema.
   * Null = schema not yet loaded.  Used by the sidebar tree to render the
   * row-count badge next to each table name.
   *
   * WHY a separate map instead of nesting inside schemaColumns:
   *   schemaColumns is keyed on table → columns; bolting `rowCount` onto each
   *   column entry would duplicate the value N times per table.  A parallel
   *   map keeps the row count exactly once per table and lets callers select
   *   only the slice they need (the SqlEditor never reads row counts; the
   *   sidebar never reads column metadata for collapsed tables).
   */
  schemaRowCounts: Record<string, number> | null;

  /** True while GET /api/schema (and per-table column fetches) are in-flight. */
  schemaLoading: boolean;

  /** Human-readable error message if the schema fetch failed, null otherwise. */
  schemaError: string | null;

  /** All open editor tabs. Always has at least one entry. */
  tabs: Tab[];

  /** Index into `tabs` for the currently focused tab. */
  activeTabIndex: number;

  /** Query history list, newest first. Capped at 200 entries. */
  history: HistoryEntry[];

  /**
   * Whether the query history push-panel is visible.
   * Toggled by the History button in EditorTabs and by Cmd+H.
   */
  historyOpen: boolean;

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Called by StatusBar once /api/status resolves (or rejects). */
  setConnectionInfo: (info: StatusResponse | null) => void;

  /**
   * Called by useSchema once all table + column fetches complete.
   *
   * WHY rowCounts is a third positional arg rather than rolled into one config
   * object:
   *   The action is invoked from exactly one place (useSchema.ts) and the
   *   three arguments are always passed together.  A config object would add
   *   ceremony without buying anything — the call site reads cleaner as
   *   `setSchema(map, columns, rowCounts)` than as `setSchema({ ... })`.
   */
  setSchema: (
    map: SchemaMap,
    columns: SchemaColumns,
    rowCounts: Record<string, number>
  ) => void;

  /** Called by useSchema to toggle the in-flight indicator. */
  setSchemaLoading: (loading: boolean) => void;

  /** Called by useSchema to surface a fetch error. */
  setSchemaError: (error: string | null) => void;

  /** Appends a new tab and activates it. */
  addTab: (tab: Tab) => void;

  /** Updates the title, SQL, or viewMode of an existing tab (identified by id). */
  updateTab: (id: string, updates: Partial<Pick<Tab, "title" | "sql" | "viewMode">>) => void;

  /**
   * Writes the query execution state (loading, result, error) back into a tab.
   * Called by useQueryExecution so each tab independently tracks its last result.
   *
   * WHY a dedicated action instead of three updateTab calls:
   *   A single set() call is an atomic Zustand update — subscribers see one
   *   consistent snapshot instead of three rapid intermediate states.
   */
  setTabQueryState: (
    id: string,
    state: { loading: boolean; result: QueryResult | null; error: string | null }
  ) => void;

  /**
   * Writes the EXPLAIN execution state into a tab. Mirror of setTabQueryState
   * for the parallel /api/explain pipeline.
   *
   * WHY a separate action and not a single set-anything-on-tab action:
   *   Keeping query state and explain state on separate actions makes the
   *   call sites in useQuery and useExplain self-documenting — each hook
   *   touches exactly one slice and cannot accidentally clobber the other.
   */
  setTabExplainState: (
    id: string,
    state: {
      loading: boolean;
      data: ExplainResponse | null;
      error: string | null;
    }
  ) => void;

  /**
   * Removes a tab by id. If the active tab is removed, the tab immediately
   * to the left (or the new last tab) becomes active. Refuses to remove the
   * final tab — the editor always shows at least one tab.
   */
  removeTab: (id: string) => void;

  /** Changes which tab is focused. Bounds-checked by callers. */
  setActiveTabIndex: (index: number) => void;

  /** Prepends a history entry and trims to 200. */
  addHistoryEntry: (entry: HistoryEntry) => void;

  /** Wipes the history list. */
  clearHistory: () => void;

  /** Flips the history push-panel open or closed. */
  toggleHistory: () => void;

  /**
   * Loads SQL into a tab from an external source (history panel, schema preview).
   * Updates tab.sql AND increments tab.loadNonce so that SqlEditor's dedicated
   * effect fires and replaces the CodeMirror document — without a tab switch and
   * without a visible flash. Normal keystrokes flow editor → store via onChange;
   * this action flows store → editor via the nonce, keeping the two paths separate.
   */
  loadSqlFromHistory: (id: string, sql: string) => void;
}

// ===== STORE CREATION =====

/**
 * useAppStore — the single Zustand store for the entire SPA.
 *
 * Uses the curried form `create<State>()((set) => ...)` so that TypeScript can
 * infer the full state type without needing explicit generic parameters at
 * every call site.
 * [source: Zustand — Creating a Store with State & Actions]
 */
/** Helper that produces a blank Tab value with sensible defaults. */
function makeTab(id: string, title: string, sql = ""): Tab {
  return {
    id,
    title,
    baseTitle: title,
    sql,
    result: null,
    error: null,
    loading: false,
    viewMode: "grid",
    loadNonce: 0,
    // EXPLAIN state starts empty — populated by useExplain when the user clicks
    // the Explain button. Persists across tab switches so the user can compare
    // the plan with the result without losing either.
    explainData: null,
    explainError: null,
    explainLoading: false,
  };
}

export const useAppStore = create<AppState>()((set) => ({
  // ── Initial state ───────────────────────────────────────────────────────────

  connectionInfo: null,

  schemaMap: null,
  schemaColumns: null,
  schemaRowCounts: null,
  schemaLoading: false,
  schemaError: null,

  // Start with one blank tab so the editor is never empty.
  tabs: [makeTab(crypto.randomUUID(), "Query 1")],
  activeTabIndex: 0,

  history: [],

  // History panel closed by default; toggled by the tab-bar button or Cmd+H.
  historyOpen: false,

  // ── Actions ─────────────────────────────────────────────────────────────────

  setConnectionInfo: (info) => set({ connectionInfo: info }),

  setSchema: (map, columns, rowCounts) =>
    set({ schemaMap: map, schemaColumns: columns, schemaRowCounts: rowCounts }),

  setSchemaLoading: (loading) => set({ schemaLoading: loading }),
  setSchemaError: (error) => set({ schemaError: error }),

  addTab: (tab) =>
    set((state) => ({
      tabs: [...state.tabs, tab],
      // Activate the newly added tab.
      activeTabIndex: state.tabs.length,
    })),

  updateTab: (id, updates) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),

  setTabQueryState: (id, queryState) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, ...queryState } : t
      ),
    })),

  setTabExplainState: (id, explainState) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              explainLoading: explainState.loading,
              explainData: explainState.data,
              explainError: explainState.error,
            }
          : t
      ),
    })),

  removeTab: (id) =>
    set((state) => {
      // Refuse to remove the last tab — always keep at least one.
      if (state.tabs.length <= 1) return state;

      const removedIdx = state.tabs.findIndex((t) => t.id === id);
      const newTabs = state.tabs.filter((t) => t.id !== id);

      // If the active tab was removed, move focus left (or clamp to the end).
      let newActiveIdx = state.activeTabIndex;
      if (removedIdx === state.activeTabIndex) {
        newActiveIdx = Math.max(0, removedIdx - 1);
      } else if (removedIdx < state.activeTabIndex) {
        // A tab before the active one was removed; shift the index down.
        newActiveIdx = state.activeTabIndex - 1;
      }

      return {
        tabs: newTabs,
        activeTabIndex: Math.min(newActiveIdx, newTabs.length - 1),
      };
    }),

  setActiveTabIndex: (index) => set({ activeTabIndex: index }),

  addHistoryEntry: (entry) =>
    set((state) => ({
      // Prepend newest, cap at 200 to avoid unbounded memory growth.
      history: [entry, ...state.history].slice(0, 200),
    })),

  clearHistory: () => set({ history: [] }),

  toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),

  loadSqlFromHistory: (id, sql) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        // Increment loadNonce so SqlEditor's dedicated effect fires and
        // replaces the CodeMirror document with the new SQL string.
        t.id === id ? { ...t, sql, loadNonce: t.loadNonce + 1 } : t
      ),
    })),
}));

// Export makeTab so EditorTabs.tsx can create fully-typed Tab objects.
export { makeTab };
