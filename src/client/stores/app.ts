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
 * A single editor tab. Each tab has its own SQL buffer.
 * Tabs are not persisted — they are lost on page close.
 */
export interface Tab {
  id: string;
  title: string;
  sql: string;
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

  /** True while GET /api/schema (and per-table column fetches) are in-flight. */
  schemaLoading: boolean;

  /** Human-readable error message if the schema fetch failed, null otherwise. */
  schemaError: string | null;

  /** Active result view mode. Grid is the default. */
  currentView: ViewMode;

  /** All open editor tabs. Always has at least one entry. */
  tabs: Tab[];

  /** Index into `tabs` for the currently focused tab. */
  activeTabIndex: number;

  /** Query history list, newest first. Capped at 200 entries. */
  history: HistoryEntry[];

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Called by StatusBar once /api/status resolves (or rejects). */
  setConnectionInfo: (info: StatusResponse | null) => void;

  /** Called by useSchema once all table + column fetches complete. */
  setSchema: (map: SchemaMap, columns: SchemaColumns) => void;

  /** Called by useSchema to toggle the in-flight indicator. */
  setSchemaLoading: (loading: boolean) => void;

  /** Called by useSchema to surface a fetch error. */
  setSchemaError: (error: string | null) => void;

  /** Switches the result panel between grid, chart, and explain views. */
  setCurrentView: (view: ViewMode) => void;

  /** Appends a new tab and activates it. */
  addTab: (tab: Tab) => void;

  /** Updates the title or SQL of an existing tab (identified by id). */
  updateTab: (id: string, updates: Partial<Pick<Tab, "title" | "sql">>) => void;

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
export const useAppStore = create<AppState>()((set) => ({
  // ── Initial state ───────────────────────────────────────────────────────────

  connectionInfo: null,
  currentView: "grid",

  schemaMap: null,
  schemaColumns: null,
  schemaLoading: false,
  schemaError: null,

  // Start with one blank tab so the editor is never empty.
  tabs: [{ id: crypto.randomUUID(), title: "Query 1", sql: "" }],
  activeTabIndex: 0,

  history: [],

  // ── Actions ─────────────────────────────────────────────────────────────────

  setConnectionInfo: (info) => set({ connectionInfo: info }),

  setSchema: (map, columns) =>
    set({ schemaMap: map, schemaColumns: columns }),
  setSchemaLoading: (loading) => set({ schemaLoading: loading }),
  setSchemaError: (error) => set({ schemaError: error }),

  setCurrentView: (view) => set({ currentView: view }),

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
}));
