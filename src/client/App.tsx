/**
 * src/client/App.tsx — Root layout component.
 *
 * LAYOUT:
 *   ┌──────────────┬──────────────────────────────────────┬──────────┐
 *   │ Schema       │  [Tab 1] [Tab 2] [+]  [History]     │ History  │  ← EditorTabs bar
 *   │ Sidebar      ├──────────────────────────────────────┤ panel    │
 *   │ 244 px wide  │  SQL Editor                          │ 340 px   │
 *   │              │  (resizable — drag the divider bar)  │ (push,   │
 *   │              ├──────────────────────────────────────┤ not      │
 *   │              │  Query Results                       │ overlay) │
 *   │              │  (grows to fill remaining space)     │          │
 *   ├──────────────┴──────────────────────────────────────┴──────────┤
 *   │ Status Bar (24 px)                                             │
 *   └────────────────────────────────────────────────────────────────┘
 *
 *   When the history panel is closed the grid is back to: 244px 1fr
 *   When open: the <aside> is added to the flex row and the center column
 *   shrinks naturally (flex-1 contracts). Nothing is ever covered.
 *
 * MULTI-TAB ARCHITECTURE:
 *   Each tab in the Zustand store owns its SQL, result, error, loading flag,
 *   and view mode. Switching tabs swaps the SqlEditor document and immediately
 *   restores the previous result in DataGrid — no re-fetch needed.
 *
 *   App.tsx reads the active tab from the store and passes its fields as props
 *   to SqlEditor and DataGrid. It does NOT own result/error/loading as local
 *   state — those live in the store so they survive tab switches.
 *
 * QUERY EXECUTION FLOW:
 *   1. User types SQL into the CodeMirror editor (SqlEditor).
 *   2. SqlEditor.onChange fires on every keystroke → updateTab(id, { sql }).
 *   3. User presses Cmd/Ctrl+Enter → SqlEditor.onRun fires.
 *      Alternatively, user clicks the "Run" button in the editor panel header.
 *   4. execute() from useQueryExecution fires POST /api/query.
 *   5. Results land in the active tab slot in the Zustand store.
 *   6. DataGrid reads loading/result/error from the active tab selector.
 *
 * RESIZE MECHANIC:
 *   The editor/results split is controlled by `editorHeightPct` (0–1).
 *   Dragging the 4 px divider bar updates this ratio by tracking the mouse
 *   position relative to the center column's bounding rect.
 *   Min heights prevent both panels from collapsing to zero.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { StatusBar } from "./components/StatusBar";
import { SqlEditor } from "./components/Editor/SqlEditor";
import { EditorTabs } from "./components/Editor/EditorTabs";
import { DataGrid } from "./components/Results/DataGrid";
import { ExplainView } from "./components/Results/ExplainView";
import { ChartView } from "./components/Results/ChartView";
import { SchemaTree } from "./components/Schema/SchemaTree";
import { QueryHistoryPanel } from "./components/History/QueryHistoryPanel";
import { useQueryExecution } from "./hooks/useQuery";
import { useExplain } from "./hooks/useExplain";
import { useSchema } from "./hooks/useSchema";
import { useAppStore } from "./stores/app";
import { formatSql } from "./utils/formatSql";

// ===== LAYOUT CONSTANTS =====

/** Fixed pixel width of the left schema sidebar. */
const SIDEBAR_WIDTH_PX = 244;

/** Minimum height in pixels for the SQL editor panel (tab bar + content). */
const MIN_EDITOR_PX = 80;

/** Minimum height in pixels for the query results panel. */
const MIN_RESULTS_PX = 60;

// ===== COMPONENT =====

export default function App() {
  // ── Schema fetch (runs once on mount) ──────────────────────────────────────
  useSchema();

  // ── Query execution ─────────────────────────────────────────────────────────
  // execute() writes results into the active tab in the store.
  // App.tsx no longer owns loading/result/error as local state — they come
  // from the active tab selector below.
  const { execute } = useQueryExecution();

  // ── EXPLAIN execution ───────────────────────────────────────────────────────
  // Parallel pipeline to execute() — explain() writes its result into a
  // separate slot on the active tab (explainData/explainError/explainLoading)
  // so the grid view and the explain view can each remember their last output.
  const { explain } = useExplain();

  // ── Active tab selector ──────────────────────────────────────────────────────
  // Single selector for the whole active tab object so we get one coherent
  // snapshot. Zustand's shallow equality on object identity avoids extra renders
  // when unrelated tabs update.
  const activeTab = useAppStore((s) => s.tabs[s.activeTabIndex]);
  const updateTab = useAppStore((s) => s.updateTab);

  // ── History panel ────────────────────────────────────────────────────────────
  // historyOpen drives the conditional render of the push-panel aside.
  // toggleHistory is also wired to Cmd+H below.
  const historyOpen = useAppStore((s) => s.historyOpen);
  const toggleHistory = useAppStore((s) => s.toggleHistory);

  // Cmd+H (Mac) / Ctrl+H (Win/Linux) — global shortcut to toggle the panel.
  // Registered on window so it fires regardless of which element has focus.
  // preventDefault() stops browsers that use Ctrl+H for "Find & Replace History".
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault();
        toggleHistory();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleHistory]);

  // ── Panel resize state ───────────────────────────────────────────────────────
  const [editorHeightPct, setEditorHeightPct] = useState(0.4);
  const centerColRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // ── Handlers ────────────────────────────────────────────────────────────────

  /**
   * handleEditorChange — syncs every keystroke into the active tab's sql field
   * in the Zustand store. This ensures the SQL survives tab switches; when the
   * user returns to this tab the editor reloads from tab.sql.
   *
   * Also resets the tab title to baseTitle when the user modifies SQL after
   * a successful query, since the row count is no longer valid.
   */
  const handleEditorChange = useCallback(
    (sql: string) => {
      if (activeTab) {
        updateTab(activeTab.id, { sql });
        // Reset title to baseTitle if we have a row count in the title
        if (activeTab.title !== activeTab.baseTitle) {
          updateTab(activeTab.id, { title: activeTab.baseTitle });
        }
      }
    },
    [activeTab, updateTab]
  );

  /**
   * handleRun — fires the query. Called from:
   *   a) SqlEditor's Cmd/Ctrl+Enter keymap (passes current doc string).
   *   b) The Run button in the panel header (passes activeTab.sql from store).
   */
  const handleRun = useCallback(
    (sql: string) => {
      void execute(sql);
    },
    [execute]
  );

  /**
   * handleRunButtonClick — Run button reads SQL from the active tab in the store
   * rather than from a ref, because the store is the source of truth for tab SQL.
   */
  const handleRunButtonClick = useCallback(() => {
    void execute(activeTab?.sql ?? "");
  }, [execute, activeTab]);

  /**
   * handleExplainClick — fires POST /api/explain for the active tab's SQL and
   * switches the result panel into "explain" view mode so the user sees the
   * loading / tree immediately.
   *
   * WHY we toggle viewMode here (not inside useExplain):
   *   The hook is a pure data layer — it shouldn't know about UI view modes.
   *   The view-mode flip is a UI decision triggered by the same click, so it
   *   belongs at the click handler.
   */
  const handleExplainClick = useCallback(() => {
    if (!activeTab) return;
    updateTab(activeTab.id, { viewMode: "explain" });
    void explain(activeTab.sql ?? "");
  }, [activeTab, updateTab, explain]);

  /**
   * handleFormatClick — formats the active tab's SQL by uppercasing keywords
   * and adding newlines after major clauses.
   */
  const handleFormatClick = useCallback(() => {
    if (!activeTab) return;
    const formatted = formatSql(activeTab.sql ?? "");
    updateTab(activeTab.id, { sql: formatted });
  }, [activeTab, updateTab]);

  /**
   * handleViewModeToggle — switches the active tab between the grid (rows)
   * and explain (plan) views without re-running anything. Each view keeps its
   * own last result so toggling is instantaneous.
   */
  const handleViewModeToggle = useCallback(
    (mode: "grid" | "chart" | "explain") => {
      if (!activeTab) return;
      updateTab(activeTab.id, { viewMode: mode });
    },
    [activeTab, updateTab]
  );

  /**
   * onDividerMouseDown — begins tracking the drag gesture.
   * Uses window-level listeners so the drag continues even if the cursor moves
   * faster than React can re-render.
   */
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !centerColRef.current) return;
      const rect = centerColRef.current.getBoundingClientRect();
      const totalH = rect.height;
      if (totalH === 0) return;

      const offsetY = ev.clientY - rect.top;
      const minPct = MIN_EDITOR_PX / totalH;
      const maxPct = (totalH - MIN_RESULTS_PX) / totalH;
      const clamped = Math.min(Math.max(offsetY / totalH, minPct), maxPct);
      setEditorHeightPct(clamped);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0a0a0f] text-[#ededf0] overflow-hidden">

      {/* ===== MAIN ROW: sidebar + center column ===== */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: SCHEMA SIDEBAR ──────────────────────────────────────── */}
        <aside
          className="flex flex-col shrink-0 border-r border-[#1f2033] bg-[#0c0c14] overflow-hidden"
          style={{ width: SIDEBAR_WIDTH_PX }}
        >
          <SchemaTree onPreview={handleRun} />
        </aside>

        {/* ── CENTER: TAB BAR + EDITOR + RESULTS (vertical stack) ──────── */}
        {/*
          flex-1 min-w-0: the center column shrinks naturally when the history
          push-panel aside is added to the flex row on the right. Nothing is
          ever covered — this is a true push layout, not an overlay.
        */}
        <div ref={centerColRef} className="flex flex-col flex-1 min-w-0 min-h-0">

          {/* ── SQL EDITOR PANEL (includes tab bar + editor body) ── */}
          <div
            className="flex flex-col min-h-0 overflow-hidden"
            style={{ height: `${editorHeightPct * 100}%` }}
          >
            {/* Tab bar — full-width row above the editor */}
            <EditorTabs />

            {/* Panel header: "SQL Editor" label + Run button */}
            <div className="flex items-center justify-between px-3 h-8 border-b border-[#1f2033] shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
                SQL Editor
              </span>

              <div className="flex items-center gap-2">
                {/*
                  Format button — formats the SQL by uppercasing keywords
                  and adding newlines after major clauses.
                */}
                <button
                  onClick={handleFormatClick}
                  className="flex items-center gap-1.5 px-2.5 h-5 text-[9px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] active:bg-[#22223d] text-[#9ca3af] border border-[#2a2a4a] transition-colors duration-100 select-none"
                  title="Format SQL"
                >
                  Format
                </button>

                {/*
                  Explain button — issues POST /api/explain for the current SQL
                  and flips the result panel to the plan-tree view. Disabled
                  while either pipeline is in flight so we don't fire
                  conflicting requests against the same tab.
                */}
                <button
                  onClick={handleExplainClick}
                  disabled={
                    (activeTab?.loading ?? false) ||
                    (activeTab?.explainLoading ?? false)
                  }
                  className="flex items-center gap-1.5 px-2.5 h-5 text-[9px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] active:bg-[#22223d] text-[#9ca3af] border border-[#2a2a4a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 select-none"
                  title="Show query plan"
                >
                  {activeTab?.explainLoading ? "Planning…" : "Explain"}
                </button>

                {/* Run button — alternative to Cmd/Ctrl+Enter */}
                <button
                  onClick={handleRunButtonClick}
                  disabled={activeTab?.loading ?? false}
                  className="flex items-center gap-1.5 px-2.5 h-5 text-[9px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] active:bg-[#22223d] text-[#7c85d6] border border-[#2a2a4a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 select-none"
                  title="Run query (Cmd+Enter)"
                >
                  {activeTab?.loading ? (
                    "Running…"
                  ) : (
                    <>
                      <span>Run</span>
                      <span className="text-[#4b5563]">⌘↵</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Editor body — CodeMirror 6 mounts here */}
            <div className="flex-1 overflow-hidden">
              {/*
                key={activeTab?.id}: intentionally NOT used here — we want a
                single persistent EditorView instance that hot-swaps its document
                via the tabId prop + the tab-switch effect inside SqlEditor.
                Using key= would destroy and recreate the CM instance on every
                tab switch, losing font rendering and causing a flash.
              */}
              <SqlEditor
                onRun={handleRun}
                onChange={handleEditorChange}
                initialDoc={activeTab?.sql ?? ""}
                tabId={activeTab?.id}
              />
            </div>
          </div>

          {/* ── RESIZE DIVIDER ── */}
          <div
            className="h-1 bg-[#1f2033] hover:bg-[#3b4070] cursor-ns-resize shrink-0 transition-colors duration-100"
            onMouseDown={onDividerMouseDown}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and results panels"
          />

          {/* ── QUERY RESULTS PANEL ── */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            <div className="flex items-center justify-between px-3 h-8 border-b border-[#1f2033] shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
                {activeTab?.viewMode === "explain"
                  ? "Plan"
                  : activeTab?.viewMode === "chart"
                  ? "Chart"
                  : "Results"}
              </span>

              {/*
                View-mode toggle — segmented control between rows (DataGrid)
                and plan (ExplainView). Each side keeps its own last output,
                so toggling is free (no re-fetch). The "Plan" tab is dim until
                the user has actually run an EXPLAIN to indicate it's empty.
              */}
              <div className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider">
                <button
                  type="button"
                  onClick={() => handleViewModeToggle("grid")}
                  className={`px-2 h-5 rounded border transition-colors duration-100 select-none ${
                    activeTab?.viewMode === "grid"
                      ? "bg-[#14142b] text-[#7c85d6] border-[#2a2a4a]"
                      : "bg-transparent text-[#4b5563] border-[#1f2033] hover:text-[#7c85d6]"
                  }`}
                  title="Show row results"
                >
                  Rows
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeToggle("chart")}
                  className={`px-2 h-5 rounded border transition-colors duration-100 select-none ${
                    activeTab?.viewMode === "chart"
                      ? "bg-[#14142b] text-[#7c85d6] border-[#2a2a4a]"
                      : "bg-transparent text-[#4b5563] border-[#1f2033] hover:text-[#7c85d6]"
                  }`}
                  title="Show chart visualization"
                >
                  Chart
                </button>
                <button
                  type="button"
                  onClick={() => handleViewModeToggle("explain")}
                  className={`px-2 h-5 rounded border transition-colors duration-100 select-none ${
                    activeTab?.viewMode === "explain"
                      ? "bg-[#14142b] text-[#7c85d6] border-[#2a2a4a]"
                      : "bg-transparent text-[#4b5563] border-[#1f2033] hover:text-[#7c85d6]"
                  }`}
                  title="Show query plan"
                >
                  Plan
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden">
              {/*
                Conditional render based on the active tab's viewMode.
                We mount only one of the two views at a time so the unmounted
                view's heavy children (e.g. TanStack virtualizer) don't
                continue running in the background.
              */}
              {activeTab?.viewMode === "explain" ? (
                <ExplainView
                  loading={activeTab?.explainLoading ?? false}
                  error={activeTab?.explainError ?? null}
                  data={activeTab?.explainData ?? null}
                />
              ) : activeTab?.viewMode === "chart" ? (
                <ChartView
                  result={activeTab?.result ?? null}
                  error={activeTab?.error ?? null}
                  loading={activeTab?.loading ?? false}
                />
              ) : (
                <DataGrid
                  result={activeTab?.result ?? null}
                  error={activeTab?.error ?? null}
                  loading={activeTab?.loading ?? false}
                />
              )}
            </div>
          </div>

        </div>
        {/* end center column */}

        {/* ── RIGHT: HISTORY PUSH-PANEL ─────────────────────────────────── */}
        {/*
          Conditionally rendered so the panel occupies zero layout space when
          closed — the center column reclaims the full remaining width.
          340 px matches the spec. shrink-0 prevents flex from collapsing it
          below that width when the editor content is wide.
          overflow-hidden: QueryHistoryPanel handles its own internal scroll.
        */}
        {historyOpen && (
          <aside
            className="flex flex-col w-[340px] shrink-0 border-l border-[#1f2033] bg-[#0c0c14] overflow-hidden"
            aria-label="Query history"
          >
            <QueryHistoryPanel />
          </aside>
        )}

      </div>
      {/* end main row */}

      {/* ===== BOTTOM: STATUS BAR ===== */}
      <StatusBar />

    </div>
  );
}
