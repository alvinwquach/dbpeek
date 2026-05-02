/**
 * src/client/components/Schema/erd/TableNode.tsx
 *
 * ===== FILE PURPOSE =====
 * Custom ReactFlow node that renders a single database table in the ERD canvas.
 *
 * Exporting TABLE_NODE_TYPES at module scope rather than constructing the object
 * inside ErdView guarantees a single stable reference for the life of the app,
 * which prevents ReactFlow's "nodeTypes changed" warning and avoids expensive
 * node remounts on re-renders.
 *
 * ===== STRUCTURE =====
 *   TableNode.tsx
 *     ├─ shortTypeBadge()    — converts verbose DB type to short badge text
 *     ├─ ErdTableIcon()      — 12×12 SVG table icon for the node header
 *     ├─ TableNode()         — the actual ReactFlow custom node component
 *     └─ TABLE_NODE_TYPES    — exported module-level nodeTypes constant
 *
 * ===== DEPENDENCIES =====
 *   reactflow           — Handle, Position, NodeProps, NodeTypes
 *   ../../../hooks/useSchema — ColumnInfo type
 *   ./layout                 — NODE_WIDTH, HEADER_HEIGHT, COLUMN_ROW_HEIGHT
 */

import { Handle, Position } from "reactflow";
import type { NodeProps, NodeTypes } from "reactflow";
import type { ColumnInfo } from "../../../hooks/useSchema";
import { NODE_WIDTH, HEADER_HEIGHT, COLUMN_ROW_HEIGHT } from "./layout";

// ===== TYPES =====

/**
 * Data payload stored inside each ReactFlow table node.
 *
 * WHY onTableClick lives in data (not as a prop):
 *   ReactFlow custom nodes receive their dynamic data through the `data` field.
 *   There is no mechanism to pass arbitrary props. Putting the callback in
 *   `data` means TableNode has everything it needs from one source and the
 *   parent only needs to build the `nodes` array — no separate prop threading.
 */
export interface TableNodeData {
  /** The table's name as it appears in the database. */
  tableName: string;
  /** Full column metadata for this table. */
  columns: ColumnInfo[];
  /**
   * Called when the user clicks the node header.
   * Received at build-time (useMemo in ErdView) and stable for the ERD's lifetime.
   */
  onTableClick: (tableName: string) => void;
}

// ===== HELPER: short type label =====

/**
 * Converts a verbose database type string into a 2–7 character badge label.
 *
 * WHY short labels:
 *   A 220 px node has limited horizontal space. "character varying(255)" or
 *   "TIMESTAMP WITHOUT TIME ZONE" would overflow or crowd out the column name.
 *   A 4–7 char token lets the reader quickly categorise the column as "is this
 *   text? a number? a date?" without needing the full type in the ERD view.
 *   The full type string is always available in the column row's title tooltip.
 *
 * STRATEGY:
 *   1. Lowercase + take the head token (prefix up to whitespace or `(`).
 *   2. Map known heads to canonical short labels.
 *   3. Fallback: truncate to 7 chars so novel types still fit in the badge.
 */
function shortTypeBadge(type: string): string {
  const head = type.toLowerCase().trim().split(/[\s(]/)[0] ?? "";

  if (head === "uuid") return "uuid";
  if (head === "json" || head === "jsonb") return "json";
  if (head.startsWith("timestamp")) return "ts";
  if (head === "datetime" || head === "datetime2") return "dt";
  if (head === "date") return "date";
  if (head === "time") return "time";
  if (head === "bool" || head === "boolean" || head === "bit") return "bool";
  if (
    ["int", "integer", "bigint", "smallint", "tinyint", "mediumint",
      "int2", "int4", "int8"].includes(head)
  ) return "int";
  if (["serial", "bigserial", "smallserial"].includes(head)) return "serial";
  if (["numeric", "decimal", "dec"].includes(head)) return "num";
  if (["real", "double", "float", "float4", "float8"].includes(head)) return "float";
  if (["text", "longtext", "mediumtext", "tinytext"].includes(head)) return "text";
  if (["varchar", "nvarchar", "character"].includes(head)) return "varchar";
  if (head === "char" || head === "nchar") return "char";
  if (["blob", "bytea", "varbinary"].includes(head)) return "blob";
  if (head === "enum") return "enum";
  if (head === "interval") return "interval";
  if (head === "money" || head === "smallmoney") return "money";

  // Fallback: truncate to 7 chars so any novel type still fits in the badge.
  return head.slice(0, 7) || type.slice(0, 7);
}

// ===== INLINE ICON =====

/**
 * Table icon used in the ERD node header.
 * Three horizontal bars suggest "rows of data" — same icon as SchemaTree's TableIcon,
 * used here to maintain visual consistency between the sidebar and the ERD canvas.
 */
function ErdTableIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-[#6b7280]"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="9" height="7" rx="1" stroke="currentColor" strokeWidth="1" />
      <line x1="1.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="0.75" />
      <line x1="1.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

// ===== CUSTOM TABLE NODE =====

/**
 * TableNode — the custom ReactFlow node that renders a single database table.
 *
 * STRUCTURE:
 *   ┌─────────────────────────────────┐   ← NODE_WIDTH (220 px)
 *   │ ▦ table_name               [←→]│   ← HEADER_HEIGHT (34 px), clickable
 *   ├─────────────────────────────────┤
 *   │ [int]  id                  [PK] │   ← COLUMN_ROW_HEIGHT (22 px) each
 *   │ [int]  user_id          [FK][…] │
 *   │ [text] description?            │
 *   └─────────────────────────────────┘
 *
 * WHY Handle components are invisible:
 *   ReactFlow requires Handle elements to define where edges attach to nodes.
 *   We use a single target handle (left center) and source handle (right center).
 *   Rendering them invisible (transparent, no border) keeps the node visually
 *   clean while still giving ReactFlow valid attachment points for FK edges.
 *
 * WHY defined at module scope (not inside ErdView):
 *   ReactFlow re-creates node types on every render if `nodeTypes` is defined
 *   inline or via a new object in the render body. Module-level placement makes
 *   the reference stable, preventing the "nodeTypes changed" warning and
 *   avoiding expensive node remounts.
 */
function TableNode({ data }: NodeProps) {
  const { tableName, columns, onTableClick } = data as TableNodeData;

  return (
    <div
      className="rounded border border-[#1f2033] overflow-hidden"
      style={{ width: NODE_WIDTH, background: "#0d0d17" }}
    >
      {/* ── Invisible connection handles ── */}
      {/*
        Position.Left = FK target (this table is referenced by another table).
        Position.Right = FK source (this table has an outgoing FK).
        The handles are always present so ReactFlow can route any edge type to/from
        this node, even for tables that have no FKs at all.
      */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: "transparent", border: "none", width: 8, height: 8 }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: "transparent", border: "none", width: 8, height: 8 }}
      />

      {/* ── Table header ── */}
      {/*
        Clicking the header navigates the sidebar to this table and closes the ERD.
        role=button + onKeyDown make it accessible to keyboard users.
      */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onTableClick(tableName)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onTableClick(tableName);
          }
        }}
        className="flex items-center gap-1.5 px-2 cursor-pointer hover:bg-[#1a1a27] transition-colors duration-100 border-b border-[#1f2033]"
        style={{ height: HEADER_HEIGHT, background: "#14142b" }}
        title={`Navigate to ${tableName} in sidebar`}
      >
        <ErdTableIcon />
        <span className="flex-1 min-w-0 truncate text-[11px] font-mono font-semibold text-[#ededf0]">
          {tableName}
        </span>
      </div>

      {/* ── Column rows ── */}
      {columns.map((col) => (
        <div
          key={col.name}
          className="flex items-center gap-1.5 px-2 border-b border-[#0f0f1a] last:border-b-0"
          style={{ height: COLUMN_ROW_HEIGHT }}
          title={`${col.name} : ${col.type}${col.nullable ? "" : " NOT NULL"}${
            col.foreignKey
              ? ` → ${col.foreignKey.table}.${col.foreignKey.column}`
              : ""
          }`}
        >
          {/* Type badge — short token so it fits the narrow column. */}
          <span className="shrink-0 px-1 h-3.5 inline-flex items-center rounded text-[7.5px] font-mono uppercase tracking-wider text-[#6b7280] bg-[#0a0a0f] border border-[#1a1a27]">
            {shortTypeBadge(col.type)}
          </span>

          {/* Column name with nullable "?" suffix. */}
          <span className="flex-1 min-w-0 truncate text-[10px] font-mono text-[#9ca3af]">
            {col.name}
            {col.nullable && (
              <span className="text-[#374151]" aria-hidden="true">?</span>
            )}
          </span>

          {/* PK badge — amber, matches SchemaTree's visual language. */}
          {col.isPrimaryKey && (
            <span
              className="shrink-0 inline-flex items-center justify-center w-5 h-3.5 rounded text-[7.5px] font-mono font-semibold tracking-wider uppercase text-[#f59e0b] border border-[#3d2c14] bg-[#0d0d17]"
              aria-label="Primary key"
            >
              PK
            </span>
          )}

          {/* FK badge — blue, only shown if the column references another table. */}
          {col.foreignKey != null && (
            <span
              className="shrink-0 inline-flex items-center justify-center w-5 h-3.5 rounded text-[7.5px] font-mono font-semibold tracking-wider uppercase text-[#60a5fa] border border-[#1e2f4d] bg-[#0d0d17]"
              aria-label="Foreign key"
            >
              FK
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ===== NODE TYPES CONSTANT =====

/**
 * Module-level constant for the ReactFlow `nodeTypes` prop.
 *
 * WHY a module-level constant instead of useMemo inside ErdView:
 *   ReactFlow uses object identity to detect if nodeTypes changed. A new
 *   object on every render — even with useMemo — can cause unnecessary node
 *   remounts in some React versions. Defining at module scope guarantees
 *   a single stable reference for the lifetime of the application.
 */
export const TABLE_NODE_TYPES: NodeTypes = { tableNode: TableNode };
