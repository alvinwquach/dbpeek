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
 * ARCHITECTURE:
 *   - No router. dbpeek is a single-screen tool; panels are toggled in-place.
 *   - State (connectionInfo, tabs, history) lives in the Zustand store.
 *     App.tsx only manages the divider drag, which is purely local UI state.
 */

import { useState, useRef, useCallback } from "react";
import { StatusBar } from "./components/StatusBar";

// ===== LAYOUT CONSTANTS =====

/** Fixed pixel width of the left schema sidebar. */
const SIDEBAR_WIDTH_PX = 244;

/** Minimum height in pixels for the SQL editor panel. */
const MIN_EDITOR_PX = 80;

/** Minimum height in pixels for the query results panel. */
const MIN_RESULTS_PX = 60;

// ===== COMPONENT =====

export default function App() {
  // editorHeightPct is the fraction of the center column's height given to the
  // SQL editor. The results panel gets the remaining (1 - editorHeightPct).
  // 0.4 = 40% editor / 60% results on first load.
  const [editorHeightPct, setEditorHeightPct] = useState(0.4);

  // ref to the center column div so we can measure its height during drag.
  const centerColRef = useRef<HTMLDivElement>(null);

  // isDragging is a ref (not state) because changing it must not cause a render.
  const isDragging = useRef(false);

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
        <aside
          className="flex flex-col shrink-0 border-r border-[#1f2033] bg-[#0c0c14] overflow-y-auto"
          style={{ width: SIDEBAR_WIDTH_PX }}
        >
          {/* Section header */}
          <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[#4b5563] border-b border-[#1f2033] shrink-0">
            Schema
          </div>

          {/* Placeholder — will be replaced with schema tree component */}
          <div className="flex-1 flex items-center justify-center text-[#2d3047] text-xs italic">
            No schema loaded
          </div>
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
              <span className="text-[10px] text-[#2d3047]">
                Query 1
              </span>
            </div>

            {/* Editor body — textarea placeholder */}
            {/*
              bg-[#0a0a0f]: match the root background so the editor feels
              integrated with the page (no "card" appearance).
              resize-none: the textarea must not show its own resize handle;
              the divider bar controls resizing instead.
            */}
            <div className="flex-1 overflow-hidden">
              <textarea
                className="w-full h-full bg-transparent resize-none outline-none text-[#ededf0] font-mono text-sm p-3 placeholder:text-[#2d3047] leading-relaxed"
                placeholder={"-- Connect to a database and run a query\nSELECT * FROM ..."}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
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

            {/* Results body — empty state */}
            <div className="flex-1 overflow-auto flex items-center justify-center">
              <p className="text-[#2d3047] text-xs italic">
                Run a query to see results
              </p>
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
