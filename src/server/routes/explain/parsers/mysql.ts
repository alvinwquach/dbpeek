// ===== FILE PURPOSE =====
// MySQL-specific EXPLAIN parser.
//
// Issues `EXPLAIN FORMAT=JSON <sql>` and converts the resulting JSON document
// (returned as a single VARCHAR column) into the dialect-agnostic ExplainNode
// tree.
//
// Reference shape (single-table SELECT):
//   { "query_block": {
//       "select_id": 1,
//       "cost_info": { "query_cost": "3.67" },
//       "table": { "table_name": "country", "access_type": "range",
//                  "rows_examined_per_scan": 17,
//                  "cost_info": { "read_cost": "1.97", ... } } } }
//
// For joins, `table` is replaced by `nested_loop` (an array of { table }
// entries), and the block may be wrapped by ordering_operation /
// grouping_operation / duplicates_removal layers.
//
// [source: MySQL — 15.8.2 EXPLAIN Statement, FORMAT=JSON example]
// [source: MySQL — 10.8.2 EXPLAIN Output Format]

import type { ExplainNode, ExplainParser } from "../types.js";

// ===== PARSER ENTRY POINT =====

/**
 * mysqlParser — runs EXPLAIN FORMAT=JSON and normalizes the response.
 *
 * WHY FORMAT=JSON over plain EXPLAIN:
 *   Plain EXPLAIN returns the legacy tabular layout (one row per accessed
 *   table). JSON output gives the operator hierarchy in one document and is
 *   the only format that preserves nested_loop and the wrapper operations
 *   we need to render a tree.
 */
export const mysqlParser: ExplainParser = {
  async run(db, sql) {
    const raw = await db.raw(`EXPLAIN FORMAT=JSON ${sql}`);
    return { raw, parsed: parseMySQLPlan(raw) };
  },
};

// ===== PARSE PIPELINE =====

/**
 * Top-level parse — extracts the JSON text out of the driver envelope, parses
 * it, and recurses into `query_block`.
 */
function parseMySQLPlan(raw: unknown): ExplainNode {
  const jsonText = extractMySQLJsonText(raw);
  if (!jsonText) {
    throw new Error("MySQL EXPLAIN returned no JSON payload.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `MySQL EXPLAIN payload was not valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!parsed || typeof parsed !== "object" || !("query_block" in parsed)) {
    throw new Error("MySQL EXPLAIN result missing query_block.");
  }

  return convertMySQLNode(
    "Query Block",
    (parsed as { query_block: Record<string, unknown> }).query_block
  );
}

/**
 * MySQL drivers wrap the EXPLAIN payload in their own row envelope. We dig
 * through the known wrappings to extract the JSON text. The column name varies
 * by MySQL version: `EXPLAIN`, `EXPLAIN FORMAT=JSON`, or sometimes the first
 * (and only) string-valued field — so we fall back to "first string value" as
 * the last resort rather than hardcoding the column name.
 */
function extractMySQLJsonText(raw: unknown): string | null {
  if (raw == null) return null;

  // mysql2 returns `[rows, fields]`. Take the rows array.
  if (Array.isArray(raw) && raw.length >= 1 && Array.isArray(raw[0])) {
    return extractMySQLJsonText(raw[0]);
  }

  // Plain array of row objects.
  if (Array.isArray(raw) && raw.length > 0) {
    return extractMySQLJsonText(raw[0]);
  }

  // Single row object — find the first string-valued column.
  if (typeof raw === "object" && raw !== null) {
    for (const v of Object.values(raw as Record<string, unknown>)) {
      if (typeof v === "string") return v;
    }
  }

  return null;
}

// ===== NODE CONVERSION =====

/**
 * Recursively converts a MySQL plan-block object into a normalized node.
 *
 * Recognized child shapes (in order):
 *   - `nested_loop`:           array of { table: {...} } entries → one child each
 *   - `ordering_operation`:    object → wrap as a synthetic "Ordering" node
 *   - `grouping_operation`:    object → wrap as a synthetic "Grouping" node
 *   - `duplicates_removal`:    object → wrap as a synthetic "Distinct" node
 *   - `table`:                 object → terminal table-scan node
 *
 * The parsed cost (cost_info.query_cost) is promoted; all non-structural keys
 * pass into `details` verbatim so the UI can surface fields like access_type,
 * possible_keys, attached_condition, etc.
 */
function convertMySQLNode(
  syntheticType: string,
  block: Record<string, unknown>
): ExplainNode {
  const cost = parseMySQLCost(block["cost_info"]);
  const children: ExplainNode[] = [];

  // ── nested_loop: array of join inputs, each wrapping a `table`. ──────────
  if (Array.isArray(block["nested_loop"])) {
    for (const entry of block["nested_loop"] as unknown[]) {
      if (entry && typeof entry === "object" && "table" in entry) {
        const t = (entry as { table: Record<string, unknown> }).table;
        children.push(convertMySQLTable(t));
      }
    }
  }

  // ── Ordering / Grouping / Duplicates wrappers ────────────────────────────
  // Each contains either a nested operation or a terminal `table`. The wrapper
  // becomes a synthetic node and we recurse to find the next operator below.
  for (const [wrapKey, label] of [
    ["ordering_operation", "Ordering"],
    ["grouping_operation", "Grouping"],
    ["duplicates_removal", "Distinct"],
  ] as const) {
    const inner = block[wrapKey];
    if (inner && typeof inner === "object") {
      children.push(convertMySQLNode(label, inner as Record<string, unknown>));
    }
  }

  // ── Single table (no join) ───────────────────────────────────────────────
  if (block["table"] && typeof block["table"] === "object") {
    children.push(convertMySQLTable(block["table"] as Record<string, unknown>));
  }

  // Strip the structural keys from details so the user only sees the actual
  // data — the structural keys are already represented in the tree itself.
  const STRUCTURAL = new Set([
    "table",
    "nested_loop",
    "ordering_operation",
    "grouping_operation",
    "duplicates_removal",
    "cost_info",
  ]);
  const details: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(block)) {
    if (!STRUCTURAL.has(k)) details[k] = v;
  }

  return {
    type: syntheticType,
    table: null,
    cost,
    rows: null,
    details,
    children,
  };
}

/**
 * Converts a MySQL `table` block into a leaf-style node.
 *
 * Terminology mapping (MySQL → normalized):
 *   table_name              → table
 *   access_type             → folded into type label, e.g. "Table Scan (range)"
 *   rows_examined_per_scan  → rows
 *   cost_info.read_cost     → cost
 *
 * WHY fold access_type into the type label:
 *   The UI's color-coded cost bars use `cost`, but the access_type ("ALL",
 *   "range", "ref", "index") is what tells a user whether the scan is the
 *   problem. Showing it in the node title means it's visible at a glance
 *   without expanding the details panel.
 */
function convertMySQLTable(t: Record<string, unknown>): ExplainNode {
  const accessType =
    typeof t["access_type"] === "string" ? (t["access_type"] as string) : null;
  const tableName =
    typeof t["table_name"] === "string" ? (t["table_name"] as string) : null;
  const rows =
    typeof t["rows_examined_per_scan"] === "number"
      ? (t["rows_examined_per_scan"] as number)
      : null;
  const cost = parseMySQLCost(t["cost_info"]);

  // Strip promoted + structural keys from details.
  const STRUCTURAL = new Set([
    "table_name",
    "access_type",
    "rows_examined_per_scan",
    "cost_info",
  ]);
  const details: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) {
    if (!STRUCTURAL.has(k)) details[k] = v;
  }

  return {
    type: accessType ? `Table Scan (${accessType})` : "Table Scan",
    table: tableName,
    cost,
    rows,
    details,
    children: [],
  };
}

/**
 * Parse the cost out of a MySQL `cost_info` object.
 *
 * MySQL stores costs as decimal STRINGS ("3.67"), not numbers. We parse with
 * Number() and reject NaN. Both `query_cost` (block-level) and `read_cost`
 * (table-level) are accepted, in that order of preference, so this helper is
 * usable from both convertMySQLNode and convertMySQLTable.
 */
function parseMySQLCost(info: unknown): number | null {
  if (!info || typeof info !== "object") return null;
  const c = info as Record<string, unknown>;
  for (const key of ["query_cost", "read_cost"]) {
    const value = c[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
