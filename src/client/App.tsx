/**
 * src/client/App.tsx — Root layout component.
 *
 * LAYOUT:
 *   ┌──────────────┬──────────────────────────────────────┐
 *   │ Schema       │  SQL Editor                          │
 *   │ Sidebar      │  (resizable — drag the divider bar)  │
 *   │ 244 px wide  ├──────────────────────────────────────┤
 *   │              │  Query Results                       │
 *   │              │  (grows to fill remaining space)     │
 *   ├──────────────┴──────────────────────────────────────┤
 *   │ Status Bar (24 px)                                  │
 *   └─────────────────────────────────────────────────────┘
 *
 * RESIZE MECHANIC:
 *   The editor/results split is controlled by `editorHeightPct` (0–1).
 *   Dragging the 4 px divider bar updates this ratio by tracking the mouse
 *   position relative to the center column's bounding rect.
 *   Min heights prevent both panels from collapsing to zero.
 *
 * QUERY EXECUTION FLOW:
 *   1. User types SQL into the CodeMirror editor (SqlEditor).
 *   2. SqlEditor.onChange fires on every keystroke → stored in currentSqlRef.
 *   3. User presses Cmd/Ctrl+Enter → SqlEditor.onRun fires with the current doc.
 *      Alternatively, user clicks the "Run" button in the editor panel header.
 *   4. execute() from useQueryExecution fires POST /api/query.
 *   5. loading / result / error flow down as props to DataGrid.
 *
 * ARCHITECTURE:
 *   - No router. dbpeek is a single-screen tool; panels are toggled in-place.
 *   - State (connectionInfo, tabs, history) lives in the Zustand store.
 *     App.tsx manages: divider drag (local), current SQL ref (local bridge).
 */

import { useState, useRef, useCallback } from "react";
import { StatusBar } from "./components/StatusBar";
import { SqlEditor } from "./components/Editor/SqlEditor";
import { DataGrid } from "./components/Results/DataGrid";
import { SchemaTree } from "./components/Schema/SchemaTree";
import { useQueryExecution } from "./hooks/useQuery";
import { useSchema } from "./hooks/useSchema";

// ===== LAYOUT CONSTANTS =====

/** Fixed pixel width of the left schema sidebar. */
const SIDEBAR_WIDTH_PX = 244;

/** Minimum height in pixels for the SQL editor panel. */
const MIN_EDITOR_PX = 80;

/** Minimum height in pixels for the query results panel. */
const MIN_RESULTS_PX = 60;

// ===== COMPONENT =====

export default function App() {
  // ── Schema fetch (runs once on mount) ─────────────────────────────────────
  // Fetches GET /api/schema + GET /api/schema/:table for every table, then
  // writes the combined result into the Zustand store.  SqlEditor subscribes
  // to schemaMap in the store and reconfigures its autocomplete extension when
  // the data lands.  The sidebar (Phase 3) will use schemaColumns the same way.
  useSchema();

  // ── Query execution state ──────────────────────────────────────────────────
  // useQueryExecution manages the fetch lifecycle (loading, result, error) and
  // pushes entries to the Zustand history array on each execution.
  const { execute, loading, result, error } = useQueryExecution();

  // currentSqlRef mirrors the live editor content so the Run button in the
  // panel header can call execute() without having to reach into the CodeMirror
  // view imperatively. The ref (not state) avoids re-renders on every keystroke.
  const currentSqlRef = useRef<string>("");

  // ── Panel resize state ─────────────────────────────────────────────────────
  // editorHeightPct is the fraction of the center column's height given to the
  // SQL editor. The results panel gets the remaining (1 - editorHeightPct).
  // 0.4 = 40% editor / 60% results on first load.
  const [editorHeightPct, setEditorHeightPct] = useState(0.4);

  // ref to the center column div so we can measure its height during drag.
  const centerColRef = useRef<HTMLDivElement>(null);

  // isDragging is a ref (not state) because changing it must not cause a render.
  const isDragging = useRef(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * handleEditorChange — keeps currentSqlRef in sync with the CodeMirror doc.
   * Called by SqlEditor.onChange on every keystroke.
   *
   * WHY a ref instead of useState:
   *   We only need the SQL when the user fires "Run" — not on every character.
   *   Storing it in state would cause App to re-render on every keystroke, which
   *   would re-render SqlEditor and DataGrid unnecessarily. A ref is zero-cost.
   */
  const handleEditorChange = useCallback((sql: string) => {
    currentSqlRef.current = sql;
  }, []);

  /**
   * handleRun — fires the query with the SQL string passed directly from the
   * Cmd+Enter keymap inside SqlEditor (which passes view.state.doc.toString()).
   */
  const handleRun = useCallback(
    (sql: string) => {
      void execute(sql);
    },
    [execute]
  );

  /**
   * handleRunButtonClick — Run button reads from the ref because the button is
   * in App.tsx and doesn't have direct access to the CodeMirror document.
   */
  const handleRunButtonClick = useCallback(() => {
    void execute(currentSqlRef.current);
  }, [execute]);

  /**
   * onDividerMouseDown — begins tracking the drag gesture.
   *
   * Uses window-level mousemove/mouseup listeners (not the divider element)
   * so the drag continues even if the cursor moves faster than React can
   * re-render, which would otherwise "lose" the divider.
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
    // Root: full viewport, dark background, no scrollbars on the shell itself.
    <div className="flex flex-col h-screen w-screen bg-[#0a0a0f] text-[#ededf0] overflow-hidden">

      {/* ===== MAIN ROW: sidebar + center column ===== */}
      {/*
        flex-1 min-h-0: allow this row to shrink so the StatusBar at the bottom
        is never pushed off screen. Without min-h-0, a flex child with flex-1
        will not shrink below its content size.
      */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: SCHEMA SIDEBAR ──────────────────────────────────────── */}
        {/*
          The SchemaTree component owns its own header, search input,
          loading / error / empty states, and the column-stats popover.
          App.tsx is responsible only for sizing the column and forwarding
          the preview action — clicking the eye icon on a table row fires
          `execute("SELECT * FROM <table> LIMIT 100")`.

          WHY the wrapper <aside> still exists:
            It establishes the fixed sidebar width and the right border that
            visually separates the sidebar from the editor. Putting that
            chrome inside SchemaTree would couple the component to the App
            layout (it could not be reused in a different shell).

          WHY no overflow-y-auto on the aside:
            SchemaTree manages its own internal scroll container so the
            search bar can stay pinned while the table list scrolls.
            overflow-y-auto here would create a second, redundant scrollbar.
        */}
        <aside
          className="flex flex-col shrink-0 border-r border-[#1f2033] bg-[#0c0c14] overflow-hidden"
          style={{ width: SIDEBAR_WIDTH_PX }}
        >
          <SchemaTree onPreview={handleRun} />
        </aside>

        {/* ── CENTER: EDITOR + RESULTS (vertical split) ────────────────── */}
        {/*
          min-w-0: without this, a flex child in a row won't shrink below its
          intrinsic content width, which can cause horizontal overflow.
          min-h-0: same reasoning for the vertical axis.
        */}
        <div ref={centerColRef} className="flex flex-col flex-1 min-w-0 min-h-0">

          {/* ── SQL EDITOR PANEL ── */}
          {/*
            height is set as a percentage so that dragging the divider adjusts
            both panels simultaneously via a single state value.
          */}
          <div
            className="flex flex-col min-h-0 overflow-hidden"
            style={{ height: `${editorHeightPct * 100}%` }}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 h-8 border-b border-[#1f2033] shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
                SQL Editor
              </span>

              {/* Run button — alternative to Cmd/Ctrl+Enter */}
              {/*
                Disabled while loading to prevent concurrent query submissions.
                The keyboard hint ("⌘↵") teaches new users the shortcut by
                surfacing it in the UI they're already looking at.
              */}
              <button
                onClick={handleRunButtonClick}
                disabled={loading}
                className="flex items-center gap-1.5 px-2.5 h-5 text-[9px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] active:bg-[#22223d] text-[#7c85d6] border border-[#2a2a4a] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100 select-none"
                title="Run query (Cmd+Enter)"
              >
                {loading ? (
                  "Running…"
                ) : (
                  <>
                    <span>Run</span>
                    {/* Keyboard shortcut hint in muted color */}
                    <span className="text-[#4b5563]">⌘↵</span>
                  </>
                )}
              </button>
            </div>

            {/* Editor body — CodeMirror 6 mounts here */}
            {/*
              overflow-hidden prevents the CodeMirror DOM from escaping the panel
              bounds. The editor handles its own scroll via .cm-scroller.
            */}
            <div className="flex-1 overflow-hidden">
              <SqlEditor
                onRun={handleRun}
                onChange={handleEditorChange}
              />
            </div>
          </div>

          {/* ── RESIZE DIVIDER ── */}
          {/*
            h-1 (4 px) draggable bar between the editor and results panels.
            cursor-ns-resize: signals to the user that this is a drag handle.
            hover:bg-[#3b4070]: a subtle highlight on hover for discoverability.
          */}
          <div
            className="h-1 bg-[#1f2033] hover:bg-[#3b4070] cursor-ns-resize shrink-0 transition-colors duration-100"
            onMouseDown={onDividerMouseDown}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize editor and results panels"
          />

          {/* ── QUERY RESULTS PANEL ── */}
          {/* flex-1: takes all remaining space after the editor + divider. */}
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 h-8 border-b border-[#1f2033] shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-[#4b5563]">
                Results
              </span>
            </div>

            {/* Results body — DataGrid fills the remaining space */}
            {/*
              overflow-hidden here because DataGrid manages its own internal
              scroll container. overflow-auto here would create a double scrollbar.
            */}
            <div className="flex-1 overflow-hidden">
              <DataGrid
                result={result}
                error={error}
                loading={loading}
              />
            </div>
          </div>

        </div>
        {/* end center column */}

      </div>
      {/* end main row */}

      {/* ===== BOTTOM: STATUS BAR ===== */}
      {/*
        StatusBar fetches /api/status on mount and writes the result to the
        Zustand store. It is rendered here (at App level) so it is always
        visible regardless of which panel is focused.
      */}
      <StatusBar />

    </div>
  );
}
