/**
 * src/client/components/Schema/ErdView.tsx — Entity Relationship Diagram overlay.
 *
 * ===== WHAT IT DOES =====
 * Renders every table in the connected database as a draggable node on a
 * zoomable ReactFlow canvas, with directed edges representing foreign-key
 * relationships between tables.
 *
 * Each node shows:
 *   • Table header (name + table icon) — clickable to navigate the sidebar.
 *   • Column rows with type badges, nullable "?" marker, and PK / FK badges.
 *
 * Edges are drawn from the source table (FK owner) to the target table
 * (referenced table), deduplicated to one edge per table-pair.
 *
 * ===== LAYOUT =====
 * Auto-layout is performed with the Dagre graph library (left-to-right ranking):
 *   1. Build a weighted directed graph of tables → FK targets.
 *   2. Run dagre.layout() to assign (x, y) positions.
 *   3. Translate Dagre's center-based coords to ReactFlow's top-left coords.
 * Users can drag any node after the initial layout; the layout only runs once
 * (when the component mounts, driven by useMemo on schemaColumns).
 *
 * ===== INTERACTION =====
 *   • Click a table header → close ERD, expand the table in the sidebar,
 *     and scroll the sidebar to that table.
 *   • Drag any node to rearrange.
 *   • Scroll / pinch to zoom.
 *   • Ctrl+drag (or trackpad pan) to pan the canvas.
 *   • Escape key or the ✕ button → close ERD.
 *
 * ===== ARCHITECTURE =====
 *   ErdView is conditionally rendered by App.tsx, driven by store.erdOpen.
 *   It renders as a fixed full-viewport overlay so the ERD has maximum canvas
 *   space without adjusting the main layout columns.
 *
 *   TableNode, shortTypeBadge, and the Dagre layout helper live in sub-modules
 *   (erd/TableNode.tsx and erd/layout.ts) to keep this file focused on React
 *   state, FK edge building, and canvas JSX.
 *
 * ===== DEPENDENCIES =====
 *   reactflow v11      — canvas, nodes, edges, controls, minimap
 *   @dagrejs/dagre     — auto-layout engine (via erd/layout.ts)
 *   erd/TableNode.tsx  — custom node component + TABLE_NODE_TYPES constant
 *   erd/layout.ts      — applyDagreLayout + node dimension constants
 */

import { useCallback, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  useEdgesState,
  useNodesState,
} from "reactflow";
import type { Edge, Node } from "reactflow";
// @ts-ignore — Vite resolves CSS side-effect imports at build time; the client
// tsconfig lacks `/// <reference types="vite/client" />` so TS reports 2882 here.
import "reactflow/dist/style.css";
import { useAppStore } from "../../stores/app";
import { TABLE_NODE_TYPES } from "./erd/TableNode";
import type { TableNodeData } from "./erd/TableNode";
import { applyDagreLayout, NODE_WIDTH, HEADER_HEIGHT, COLUMN_ROW_HEIGHT } from "./erd/layout";

// ===== SUB-COMPONENT: ErdHeader =====

/**
 * ErdHeader — the top toolbar bar for the ERD overlay.
 *
 * WHY a separate sub-component:
 *   ErdView's JSX is already dominated by the ReactFlow canvas setup. Pulling
 *   the header into its own function keeps ErdView's render body focused on
 *   the graph state and avoids a block of non-canvas JSX inside a canvas-
 *   focused component.
 */
function ErdHeader({
  onClose,
  tableCount,
}: {
  onClose: () => void;
  tableCount: number;
}) {
  return (
    <div className="flex items-center justify-between px-4 h-9 border-b border-[#1f2033] bg-[#0d0d17] shrink-0">
      {/* Left: title + table count */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4b5563]">
          ERD
        </span>
        {tableCount > 0 && (
          <span className="text-[9px] font-mono text-[#374151]">
            {tableCount} {tableCount === 1 ? "table" : "tables"}
          </span>
        )}
      </div>

      {/* Right: hints + close button */}
      <div className="flex items-center gap-3 text-[9px] font-mono text-[#4b5563]">
        <span>Click table header to open in sidebar</span>
        <span className="text-[#1f2033]">·</span>
        <span>Drag to rearrange</span>
        <span className="text-[#1f2033]">·</span>
        <span>Scroll to zoom</span>
        <button
          onClick={onClose}
          className="ml-1 flex items-center justify-center w-5 h-5 rounded border border-[#1f2033] text-[#4b5563] hover:text-[#ededf0] hover:border-[#3b4070] transition-colors duration-100"
          aria-label="Close ERD (Escape)"
          title="Close ERD (Escape)"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ===== MAIN COMPONENT =====

/**
 * ErdView — full-viewport Entity Relationship Diagram overlay.
 *
 * Called from App.tsx when `store.erdOpen` is true. Rendered as a fixed
 * overlay so the ERD canvas can fill the entire viewport without pushing
 * the sidebar, editor, or result panels out of the way.
 *
 * @param onClose  Callback that flips `store.erdOpen` back to false. Called
 *                 on Escape, ✕ button click, and table-node click (which also
 *                 navigates the sidebar via `store.sidebarFocusTable`).
 */
export function ErdView({ onClose }: { onClose: () => void }) {
  // ── Read schema data from Zustand ──────────────────────────────────────────
  // schemaColumns has the full column metadata needed for node rendering and
  // FK edge detection. schemaMap is not needed here — schemaColumns covers it.
  const schemaColumns = useAppStore((s) => s.schemaColumns);

  // setSidebarFocusTable triggers SchemaTree to expand and scroll to the
  // clicked table after the ERD is closed.
  const setSidebarFocusTable = useAppStore((s) => s.setSidebarFocusTable);

  // ── Table click handler ───────────────────────────────────────────────────
  /**
   * Handles clicking a table node header. Two things happen simultaneously:
   *   1. setSidebarFocusTable(tableName) — SchemaTree watches this and will
   *      expand + scroll to the table on its next render cycle.
   *   2. onClose() — closes the ERD overlay, revealing the sidebar with the
   *      now-expanded table.
   *
   * WHY useCallback: this function is captured inside the useMemo that builds
   * node data. It must be stable between renders so the memo doesn't rebuild
   * the entire node array on every render (useMemo's dep array includes it).
   * onClose and setSidebarFocusTable are both stable Zustand action references.
   */
  const handleTableClick = useCallback(
    (tableName: string) => {
      setSidebarFocusTable(tableName);
      onClose();
    },
    [setSidebarFocusTable, onClose]
  );

  // ── Build ReactFlow graph from schema data ────────────────────────────────
  /**
   * Converts the flat schemaColumns map into typed ReactFlow nodes and edges,
   * then runs the Dagre layout to assign initial positions.
   *
   * This runs exactly once when the ERD opens (schemaColumns and
   * handleTableClick are both stable after mount). Subsequent node position
   * changes (user dragging) are handled by ReactFlow's useNodesState internally
   * and do NOT re-trigger this memo.
   *
   * WHY build both nodes AND edges in the same memo:
   *   The Dagre layout needs both the nodes AND the edges at the same time to
   *   compute rank placements. Splitting them into two memos would require the
   *   edge memo to know node dimensions and the node memo to know edges —
   *   creating a circular dependency. A single memo that builds both and
   *   immediately applies the layout is the clean solution.
   */
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!schemaColumns) return { initialNodes: [], initialEdges: [] };

    const tableNames = Object.keys(schemaColumns).sort();

    // ── 1. Build raw nodes ─────────────────────────────────────────────────
    //
    // Node height is dynamic: header + one row per column. Dagre uses these
    // dimensions to ensure nodes don't overlap after layout.
    const rawNodes: Node<TableNodeData>[] = tableNames.map((tableName) => {
      const cols = schemaColumns[tableName] ?? [];
      const height = HEADER_HEIGHT + cols.length * COLUMN_ROW_HEIGHT;
      return {
        id: tableName,
        type: "tableNode",
        data: { tableName, columns: cols, onTableClick: handleTableClick },
        position: { x: 0, y: 0 }, // replaced by Dagre layout below
        width: NODE_WIDTH,
        height,
        // Prevent accidental deletion of nodes via the Delete key.
        deletable: false,
      };
    });

    // ── 2. Build FK edges ──────────────────────────────────────────────────
    //
    // Strategy: iterate all columns; emit one edge per unique (source, target)
    // table pair. Deduplication via a Set prevents multiple FK columns to the
    // same table from spawning parallel overlapping edges.
    //
    // WHY deduplicate at the table-pair level (not column level):
    //   A single table can have multiple FK columns pointing to the same target
    //   (e.g. `created_by` and `updated_by` both → users). Rendering two edges
    //   between the same pair creates visually confusing overlapping arrows.
    //   One arrow per pair is enough to convey "these tables are related"; the
    //   user can inspect individual FK columns in the node column list or in
    //   SchemaTree.
    const rawEdges: Edge[] = [];
    const emittedPairs = new Set<string>();

    for (const tableName of tableNames) {
      // Explicit annotation breaks the circular-inference chain (TS 7022) that
      // arises when noUncheckedIndexedAccess + a Zustand selector return type
      // prevent TS from resolving the element type without a hint.
      const cols: { foreignKey: { table: string; column: string } | null }[] =
        schemaColumns[tableName] ?? [];

      for (const col of cols) {
        if (!col.foreignKey) continue;

        // col.foreignKey is typed as { table: string; column: string } | null
        // per ColumnInfo in useSchema.ts — no casts needed.
        const fk: { table: string; column: string } = col.foreignKey;
        if (!fk.table || !(fk.table in schemaColumns)) continue;

        // Skip self-referential FK (table references itself — dagre doesn't
        // produce useful layouts for self-loops and they clutter the view).
        if (fk.table === tableName) continue;

        const pairKey = `${tableName}→${fk.table}`;
        if (emittedPairs.has(pairKey)) continue;
        emittedPairs.add(pairKey);

        rawEdges.push({
          id: `erd-${tableName}-${fk.table}`,
          source: tableName,
          target: fk.table,
          // smoothstep routing avoids sharp 90° bends while staying predictable.
          type: "smoothstep",
          // Filled arrowhead on the target (referenced) table to show direction.
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: "#374151",
            width: 14,
            height: 14,
          },
          style: { stroke: "#374151", strokeWidth: 1.5 },
          // deletable:false — edges are read-only schema info, not user-created.
          // (ReactFlow v11's Edge type does not include `selectable`; use the
          // canvas-level `elementsSelectable` prop if selection must be toggled.)
          deletable: false,
        });
      }
    }

    // ── 3. Apply Dagre layout ──────────────────────────────────────────────
    const layoutedNodes = applyDagreLayout(rawNodes, rawEdges);

    return { initialNodes: layoutedNodes, initialEdges: rawEdges };
  }, [schemaColumns, handleTableClick]);

  // ── ReactFlow state ───────────────────────────────────────────────────────
  // useNodesState / useEdgesState wire up the ReactFlow state machine that
  // tracks user drag operations. The initial values come from our Dagre layout;
  // after that ReactFlow owns position updates.
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);

  // ── Escape key dismissal ──────────────────────────────────────────────────
  /**
   * Dismiss the ERD on Escape. Registered on document so it fires regardless
   * of which element (ReactFlow canvas, node, control button) has focus.
   *
   * WHY useEffect not a keydown prop on the container div:
   *   The ReactFlow canvas captures keyboard events for its own pan/zoom
   *   shortcuts. A React keydown prop on the outer div would be swallowed by
   *   ReactFlow's event.stopPropagation() in some interaction states. Document-
   *   level listener fires before React's synthetic event system.
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Empty / loading state ─────────────────────────────────────────────────
  const tableCount = schemaColumns ? Object.keys(schemaColumns).length : 0;

  if (!schemaColumns || tableCount === 0) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]"
        role="dialog"
        aria-label="Entity Relationship Diagram"
        aria-modal="true"
      >
        <ErdHeader onClose={onClose} tableCount={0} />
        <div className="flex-1 flex items-center justify-center">
          <span className="text-[#374151] text-sm font-mono italic">
            {!schemaColumns ? "Schema is still loading…" : "No tables in this database."}
          </span>
        </div>
      </div>
    );
  }

  // ── Full ERD canvas ───────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0f]"
      role="dialog"
      aria-label="Entity Relationship Diagram"
      aria-modal="true"
    >
      {/* Toolbar header */}
      <ErdHeader onClose={onClose} tableCount={tableCount} />

      {/* ReactFlow canvas — flex-1 + min-h-0 fills the remaining viewport height. */}
      {/*
        ReactFlow REQUIRES the parent container to have an explicit height;
        it uses getBoundingClientRect() internally. flex-1 + min-h-0 gives it
        the remaining viewport height after the header bar.
      */}
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={TABLE_NODE_TYPES}
          // fitView pans/zooms on initial render so all nodes are visible.
          fitView
          fitViewOptions={{ padding: 0.08, includeHiddenNodes: false }}
          minZoom={0.05}
          maxZoom={2}
          // Match the app's dark canvas background.
          style={{ background: "#0a0a0f" }}
          // Disable the default click-to-select-node behaviour — clicking a
          // node header fires onTableClick via the node's own onClick, which
          // closes the ERD. We don't want ReactFlow's selection UI on top.
          selectNodesOnDrag={false}
          // Allow the user to connect edges manually (disabled by default).
          // We don't want that — this is a read-only schema view.
          nodesConnectable={false}
        >
          {/* Dot-grid background matching the dark theme border color. */}
          <Background
            color="#1f2033"
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
          />

          {/* Zoom + fit-view controls (bottom-left corner). */}
          <Controls
            style={{
              background: "#0d0d17",
              border: "1px solid #1f2033",
              borderRadius: 6,
            }}
          />

          {/* Mini-map for orientation in large schemas. */}
          <MiniMap
            style={{
              background: "#0d0d17",
              border: "1px solid #1f2033",
            }}
            nodeColor="#14142b"
            maskColor="rgba(10,10,15,0.75)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
