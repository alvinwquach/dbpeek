// ===== FILE PURPOSE =====
// SQLite-specific EXPLAIN parser.
//
// Issues `EXPLAIN QUERY PLAN <sql>` and reconstructs the operator tree from
// the resulting id/parent/detail rows.
//
// Reference shape:
//   { id: 1, parent: 0, notused: 0, detail: "SCAN TABLE foo" }
//   { id: 2, parent: 1, notused: 0, detail: "SEARCH TABLE bar USING INDEX i" }
//
// WHY no costs:
//   SQLite's planner doesn't expose numeric cost estimates via EXPLAIN QUERY
//   PLAN — the human-readable `detail` column is all we get. We set cost=null
//   and the UI degrades gracefully (tree without color bars).

import type { ExplainNode, ExplainParser } from "../types.js";

// ===== PARSER ENTRY POINT =====

export const sqliteParser: ExplainParser = {
  async run(db, sql) {
    const raw = await db.raw(`EXPLAIN QUERY PLAN ${sql}`);
    return { raw, parsed: parseSQLitePlan(raw) };
  },
};

// ===== PARSE PIPELINE =====

/**
 * Reconstruct the operator tree from id/parent rows.
 *
 * WHY a virtual root:
 *   A query may produce multiple top-level rows (parent=0). To keep the API
 *   contract single-rooted, we attach all top-level rows under a synthetic
 *   "Query" root, then unwrap when there's exactly one — the typical case.
 */
function parseSQLitePlan(raw: unknown): ExplainNode {
  const rows = extractSQLiteRows(raw);
  if (rows.length === 0) {
    throw new Error("SQLite EXPLAIN returned no rows.");
  }

  const root: ExplainNode = {
    type: "Query",
    table: null,
    cost: null,
    rows: null,
    details: {},
    children: [],
  };

  // Map of id → node so we can attach children under the right parent.
  const byId = new Map<number, ExplainNode>();

  for (const row of rows) {
    const node: ExplainNode = {
      type: extractSQLiteOperation(row.detail),
      table: extractSQLiteTable(row.detail),
      cost: null,
      rows: null,
      details: { detail: row.detail },
      children: [],
    };
    byId.set(row.id, node);
    const parent = row.parent === 0 ? root : byId.get(row.parent) ?? root;
    parent.children.push(node);
  }

  // If the virtual root has exactly one child, unwrap it — typical case.
  if (root.children.length === 1) return root.children[0]!;
  return root;
}

/**
 * Pulls the typed row list out of whatever shape the SQLite knex driver
 * returned. better-sqlite3 returns plain row objects.
 */
function extractSQLiteRows(
  raw: unknown
): Array<{ id: number; parent: number; detail: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: number; parent: number; detail: string }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    if (typeof o["id"] === "number" && typeof o["parent"] === "number") {
      out.push({
        id: o["id"],
        parent: o["parent"],
        detail:
          typeof o["detail"] === "string"
            ? o["detail"]
            : String(o["detail"] ?? ""),
      });
    }
  }
  return out;
}

/**
 * Extracts the operation (first one or two tokens) from a SQLite plan detail
 * string. e.g. "SCAN TABLE foo" → "SCAN", "USE TEMP B-TREE FOR ORDER BY" → "USE".
 *
 * WHY a small allowlist instead of just "first token":
 *   The allowlist normalizes case ("scan" → "SCAN") only for the operations
 *   we recognize. For anything else (e.g. driver-specific or SQLite-version
 *   additions), we fall back to the raw first token rather than uppercasing
 *   blindly, so unfamiliar operations stay readable.
 */
function extractSQLiteOperation(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) return "Unknown";
  const m = trimmed.match(
    /^(SCAN|SEARCH|USE|CO-?ROUTINE|MATERIALIZE|COMPOUND|MERGE)/i
  );
  if (m && m[1]) return m[1].toUpperCase();
  // Fallback: first whitespace-delimited token. With noUncheckedIndexedAccess
  // the [0] access is `string | undefined`, so we coerce explicitly.
  const firstToken = trimmed.split(/\s+/)[0];
  return firstToken ?? "Unknown";
}

/**
 * Extracts the table name from a SQLite plan detail string when present.
 * Patterns supported:
 *   "SCAN TABLE foo"
 *   "SEARCH TABLE foo USING INDEX idx (col=?)"
 *   "SCAN foo"             (modern SQLite often omits the TABLE keyword)
 *
 * Returns null when no table is referenced (subquery materializations, etc.).
 */
function extractSQLiteTable(detail: string): string | null {
  const m =
    detail.match(/(?:SCAN|SEARCH)\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)/i) ??
    detail.match(/(?:SCAN|SEARCH)\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s|$)/i);
  // m[1] is `string | undefined` under noUncheckedIndexedAccess; coerce to null.
  return m && m[1] ? m[1] : null;
}
