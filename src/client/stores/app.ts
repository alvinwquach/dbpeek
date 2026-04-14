/**
 * src/client/stores/app.ts
 *
 * WHAT: Global Zustand store that holds all shared application state for dbpeek.
 *
 * WHY: Rather than prop-drilling state through many component layers, Zustand
 * provides a lightweight global store. Any component can read or update state
 * without being wired through its parent tree.
 *
 * HOW: Imported by any component that needs to read or update global state.
 * App.tsx calls initConnectionInfo() on mount to hydrate connectionInfo from
 * GET /api/status.
 */

import { create } from 'zustand';

// ── Type definitions ──────────────────────────────────────────────────────────

/**
 * The database engines that dbpeek supports.
 * Mirrors the Dialect type on the server side (src/server/db.ts).
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

/**
 * Permission modes available on the server.
 * 'read-only'  — SELECT only (the safe default)
 * 'write'      — SELECT + INSERT/UPDATE/DELETE
 * 'full'       — all of the above + DDL (CREATE/DROP/ALTER)
 */
export type PermissionMode = 'read-only' | 'write' | 'full';

/**
 * Shape of the GET /api/status response.
 * All fields except dialect, mode, and connected are optional because sqlite
 * does not have a host/port/user — it is a local file.
 */
export interface ConnectionInfo {
  /** Database engine: postgres, mysql, sqlite, or mssql */
  dialect: Dialect;
  /** Hostname — undefined for SQLite */
  host?: string;
  /** Port number — undefined for SQLite */
  port?: number;
  /** Database name or SQLite filename */
  database?: string;
  /** Login user — undefined for SQLite */
  user?: string;
  /** Current permission mode */
  mode: PermissionMode;
  /** Whether the SELECT 1 health check succeeded */
  connected: boolean;
}

/**
 * Which view is rendered in the results panel below the SQL editor.
 * 'grid'    — tabular data view (default)
 * 'chart'   — chart / visualisation view (future)
 * 'explain' — query plan view (future)
 */
export type CurrentView = 'grid' | 'chart' | 'explain';

/**
 * A single editor tab. Each tab has its own SQL buffer and the last
 * result set returned for that tab.
 */
export interface Tab {
  /** Unique identifier — used as React key and for tab switching */
  id: string;
  /** Display name shown on the tab strip */
  name: string;
  /** Current SQL text in the editor for this tab */
  sql: string;
  /** Last result set for this tab (null if the query hasn't run yet) */
  result: QueryResult | null;
}

/**
 * The result of executing a SQL query.
 * columns holds the ordered column names; rows is an array of plain objects.
 */
export interface QueryResult {
  /** Ordered list of column names */
  columns: string[];
  /** Each row as a plain key→value map */
  rows: Record<string, unknown>[];
}

/**
 * One entry in the query history list.
 * Stores enough metadata to display a useful history panel without re-running
 * the query.
 */
export interface HistoryEntry {
  /** The SQL text that was executed */
  sql: string;
  /** When the query was executed (ms since epoch) */
  timestamp: number;
  /** How many rows were returned or affected */
  rowCount: number;
  /** Wall-clock time in milliseconds for the round-trip */
  executionTime: number;
  /** Whether the query completed without an error */
  success: boolean;
}

// ── Store shape ───────────────────────────────────────────────────────────────

/**
 * The full shape of the global app store — both state fields and actions.
 */
interface AppStore {
  // ── State ──────────────────────────────────────────────────────────────────

  /**
   * Connection metadata fetched from GET /api/status on mount.
   * null until the first fetch completes.
   */
  connectionInfo: ConnectionInfo | null;

  /**
   * Which results panel is currently visible.
   * Defaults to 'grid'.
   */
  currentView: CurrentView;

  /**
   * The list of open editor tabs.
   * Starts with one empty tab so the user sees the editor immediately.
   */
  tabs: Tab[];

  /**
   * Index into tabs[] of the currently active tab.
   * Zero-based.
   */
  activeTabIndex: number;

  /**
   * History of all queries executed in this session, most-recent first.
   */
  history: HistoryEntry[];

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Fetches GET /api/status and stores the result in connectionInfo.
   * Called once on App mount. Safe to call again to refresh.
   *
   * @returns Promise<void>
   * @example
   *   useEffect(() => { useAppStore.getState().initConnectionInfo(); }, []);
   */
  initConnectionInfo: () => Promise<void>;

  /**
   * Switches the results panel view.
   *
   * @param view - the view to switch to
   * @example
   *   setCurrentView('explain');
   */
  setCurrentView: (view: CurrentView) => void;

  /**
   * Replaces the SQL content of the given tab.
   *
   * @param tabId - the id of the tab to update
   * @param sql   - the new SQL text
   * @example
   *   updateTabSql('tab-1', 'SELECT * FROM users');
   */
  updateTabSql: (tabId: string, sql: string) => void;

  /**
   * Switches focus to the tab at the given index.
   *
   * @param index - zero-based index into the tabs array
   * @example
   *   setActiveTab(2);
   */
  setActiveTab: (index: number) => void;

  /**
   * Appends a new blank tab and switches to it.
   *
   * @example
   *   addTab();
   */
  addTab: () => void;

  /**
   * Appends an entry to the history list.
   *
   * @param entry - the history entry to append
   * @example
   *   addHistoryEntry({ sql: 'SELECT 1', timestamp: Date.now(), rowCount: 1, executionTime: 12, success: true });
   */
  addHistoryEntry: (entry: HistoryEntry) => void;
}

// ── Initial tabs ──────────────────────────────────────────────────────────────

/** Counter used to generate unique tab IDs without needing a UUID library. */
let tabCounter = 1;

/**
 * createBlankTab
 *
 * Returns a new Tab with an auto-incremented id and an empty SQL buffer.
 *
 * @returns a fresh Tab object
 * @example
 *   const t = createBlankTab(); // { id: 'tab-2', name: 'Query 2', sql: '', result: null }
 */
function createBlankTab(): Tab {
  const id = `tab-${tabCounter}`;
  const name = `Query ${tabCounter}`;
  tabCounter += 1;
  return { id, name, sql: '', result: null };
}

// ── Store creation ────────────────────────────────────────────────────────────

/**
 * useAppStore
 *
 * The global Zustand store. Import this hook in any React component that needs
 * to read or update application state.
 *
 * @example
 *   const { connectionInfo, currentView } = useAppStore();
 *   const setCurrentView = useAppStore((s) => s.setCurrentView);
 */
export const useAppStore = create<AppStore>((set) => ({
  // ── Initial state ──────────────────────────────────────────────────────────

  connectionInfo: null,
  currentView: 'grid',
  tabs: [createBlankTab()],
  activeTabIndex: 0,
  history: [],

  // ── Actions ────────────────────────────────────────────────────────────────

  initConnectionInfo: async () => {
    // PSEUDOCODE:
    // 1. Fetch GET /api/status (proxied to Express by Vite in dev)
    // 2. Parse the JSON response into ConnectionInfo
    // 3. Store in connectionInfo — triggers a re-render of StatusBar
    // 4. On network error, leave connectionInfo as null so StatusBar shows "offline"
    try {
      const res = await fetch('/api/status');
      const data = (await res.json()) as ConnectionInfo;
      set({ connectionInfo: data });
    } catch {
      // Network error or server not running — leave connectionInfo as null.
      // StatusBar will render a disconnected indicator.
    }
  },

  setCurrentView: (view) => set({ currentView: view }),

  updateTabSql: (tabId, sql) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, sql } : tab
      ),
    }));
  },

  setActiveTab: (index) => set({ activeTabIndex: index }),

  addTab: () => {
    const newTab = createBlankTab();
    set((state) => ({
      tabs: [...state.tabs, newTab],
      // Switch immediately to the new tab.
      activeTabIndex: state.tabs.length,
    }));
  },

  addHistoryEntry: (entry) => {
    // Prepend to keep most-recent-first ordering.
    set((state) => ({
      history: [entry, ...state.history],
    }));
  },

}));
