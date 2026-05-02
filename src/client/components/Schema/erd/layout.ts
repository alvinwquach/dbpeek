/**
 * src/client/components/Schema/erd/layout.ts
 *
 * ===== FILE PURPOSE =====
 * Shared layout constants and the Dagre auto-layout helper for the ERD view.
 *
 * Extracting these from ErdView.tsx keeps the main component focused on React
 * state and JSX while this module owns the graph-positioning math. Any future
 * change to node sizing or layout algorithm only touches this file.
 *
 * ===== DEPENDENCIES =====
 *   @dagrejs/dagre — directed-graph layout engine (left-to-right ranking)
 *   reactflow      — type imports only (Node, Edge)
 */

import { graphlib as Graphlib, layout as dagreLayout } from "@dagrejs/dagre";
import type { Node, Edge } from "reactflow";

// ===== LAYOUT CONSTANTS =====

/**
 * Fixed pixel width for every table node on the ERD canvas.
 *
 * WHY 220 px:
 *   Wide enough for most table names and column names without truncation;
 *   narrow enough for a typical 10–30-table schema to fit in the viewport
 *   without aggressive zooming. Dagre uses this value to prevent overlapping
 *   nodes when computing horizontal positions.
 */
export const NODE_WIDTH = 220;

/**
 * Height of the table name header row inside a node.
 *
 * WHY 34 px:
 *   Gives the table name + icon sufficient vertical padding (≈ 11 px top/bottom)
 *   while remaining clearly distinct from the 22 px column rows below it.
 *   Dagre adds this to the per-column rows to determine the total node height.
 */
export const HEADER_HEIGHT = 34;

/**
 * Height of each column row inside a node.
 *
 * WHY 22 px:
 *   Tight enough to show 8–12 columns without the node growing too tall, yet
 *   large enough for the 10 px type-badge and 10.5 px column-name text to sit
 *   comfortably without line-height collisions. Dagre multiplies this by the
 *   column count when computing the total node height used for overlap avoidance.
 */
export const COLUMN_ROW_HEIGHT = 22;

// ===== DAGRE LAYOUT CONSTANTS =====

/** Horizontal gap between Dagre rank layers (columns of tables). */
const DAGRE_RANKSEP = 100;

/** Vertical gap between Dagre nodes within the same rank layer. */
const DAGRE_NODESEP = 50;

// ===== DAGRE AUTO-LAYOUT =====

/**
 * Runs the Dagre graph layout algorithm over the provided nodes and edges,
 * returning new node objects with computed (x, y) positions.
 *
 * HOW IT WORKS:
 *   1. Create a Dagre directed graph and configure left-to-right ranking.
 *   2. Register every node with its pixel width/height so Dagre can compute
 *      non-overlapping ranks.
 *   3. Register every FK edge (source → target).
 *   4. Call dagre.layout(g) — this mutates the graph in place, writing
 *      center-based (x, y) onto each node.
 *   5. Translate center coords to top-left corner coords for ReactFlow
 *      (ReactFlow's `position` is the top-left corner of the node).
 *
 * WHY `rankdir: "LR"` (left-to-right):
 *   Most schemas have a "core entities on the left, dependent/join tables on
 *   the right" topology. LR layout naturally matches that mental model and
 *   makes FK arrows read as "belongs to / references" flowing left-to-right.
 *
 * WHY this function is generic over `T`:
 *   ErdView uses `Node<TableNodeData>` but the layout logic is pure geometry —
 *   it only needs node ids and dimensions. Keeping it generic means the helper
 *   is reusable for any ReactFlow node type without needing to import
 *   TableNodeData here, avoiding a circular dependency.
 *
 * @param nodes  Raw nodes with width/height set but positions at (0, 0).
 * @param edges  FK edges used for adjacency information (layout only).
 * @returns New node array with positions filled in by Dagre.
 */
export function applyDagreLayout<T>(
  nodes: Node<T>[],
  edges: Edge[]
): Node<T>[] {
  // Create a new directed Dagre graph for this layout run.
  const g = new Graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: "LR",
    ranksep: DAGRE_RANKSEP,
    nodesep: DAGRE_NODESEP,
    marginx: 40,
    marginy: 40,
  });

  // Register nodes with their pixel dimensions so Dagre prevents overlaps.
  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.width ?? NODE_WIDTH,
      height: node.height ?? HEADER_HEIGHT,
    });
  }

  // Register FK edges (source → target). Dagre only uses adjacency here;
  // the actual edge rendering is handled by ReactFlow separately.
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run the layout algorithm (mutates `g` in place).
  dagreLayout(g);

  // Translate Dagre's center-based positions to ReactFlow's top-left coords.
  // Dagre places (x, y) at the center of the node; ReactFlow expects the
  // top-left corner. Subtracting half-width / half-height converts between them.
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    const w = node.width ?? NODE_WIDTH;
    const h = node.height ?? HEADER_HEIGHT;
    return {
      ...node,
      position: {
        x: dagreNode.x - w / 2,
        y: dagreNode.y - h / 2,
      },
    };
  });
}
