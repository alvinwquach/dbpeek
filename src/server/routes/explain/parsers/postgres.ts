// ===== FILE PURPOSE =====
// Postgres-specific EXPLAIN parser.
//
// Issues `EXPLAIN (FORMAT JSON) <sql>` and converts the resulting one-row,
// one-column JSON document into the dialect-agnostic ExplainNode tree.
//
// Reference shape (single Seq Scan):
//   [ { "Plan": { "Node Type": "Seq Scan", "Relation Name": "foo",
//                 "Total Cost": 155.00, "Plan Rows": 10000 } } ]
//
// [source: PostgreSQL — Examples of EXPLAIN with FORMAT JSON]
// [source: PostgreSQL — 14.1.1 EXPLAIN Basics]

import type { ExplainNode, ExplainParser } from "../types.js";

// ===== PARSER ENTRY POINT =====

/**
 * postgresParser — runs EXPLAIN (FORMAT JSON) and normalizes the response.
 *
 * WHY EXPLAIN (FORMAT JSON) and not plain EXPLAIN:
 *   Plain EXPLAIN returns text intended for `psql` display — parsing it would
 *   require a full text-grammar walker that breaks any time PG tweaks its
 *   formatting. FORMAT JSON is the documented machine-readable alternative;
 *   it has been stable across PG releases.
 *
 * WHY NOT EXPLAIN ANALYZE:
 *   ANALYZE actually runs the statement to gather real timings — turning a
 *   "show me the plan" click into "execute this DELETE." We deliberately
 *   stick to plan-only EXPLAIN so the route remains side-effect free even
 *   when the user passes a write statement under --write or --full mode.
 */
export const postgresParser: ExplainParser = {
  async run(db, sql) {
    const raw = await db.raw(`EXPLAIN (FORMAT JSON) ${sql}`);
    return { raw, parsed: parsePostgresPlan(raw) };
  },
};

// ===== PARSE PIPELINE =====

/**
 * Top-level parse — pulls the `[{ Plan: ... }]` array out of whatever shape
 * the driver returned and recurses into the root Plan object.
 */
function parsePostgresPlan(raw: unknown): ExplainNode {
  const planArray = extractPostgresPlanArray(raw);
  if (!planArray || planArray.length === 0) {
    throw new Error("Postgres EXPLAIN returned no plan.");
  }
  const wrapper = planArray[0] as { Plan?: unknown };
  if (!wrapper || typeof wrapper !== "object" || !("Plan" in wrapper)) {
    throw new Error("Postgres EXPLAIN result missing top-level Plan.");
  }
  return convertPostgresNode(wrapper.Plan as Record<string, unknown>);
}

/**
 * Reach into the various shapes Postgres + knex may produce to find the
 * underlying `[{ "Plan": ... }]` array.
 *
 * Three observed shapes:
 *   1. `{ rows: [{ "QUERY PLAN": [{Plan:{}}] }], fields: [...] }` — raw pg result
 *   2. `[{ "QUERY PLAN": [{Plan:{}}] }]`                          — array of row objects
 *   3. `[{Plan:{}}]`                                              — already unwrapped
 *
 * WHY check all three:
 *   The route's normalizer in routes/query.ts already collapses pg result
 *   objects into row arrays, but this parser is called BEFORE that normalizer
 *   (we receive the raw knex.raw() output). Different knex versions and
 *   driver configurations have produced shapes 1 and 2 in the wild; shape 3
 *   is what tests sometimes pass directly.
 */
function extractPostgresPlanArray(raw: unknown): unknown[] | null {
  if (raw == null) return null;

  // Shape 1: pg-native object with .rows
  if (typeof raw === "object" && raw !== null && "rows" in raw) {
    const rows = (raw as { rows: unknown }).rows;
    if (Array.isArray(rows) && rows.length > 0) {
      const firstRow = rows[0];
      if (firstRow && typeof firstRow === "object" && "QUERY PLAN" in firstRow) {
        const inner = (firstRow as Record<string, unknown>)["QUERY PLAN"];
        if (Array.isArray(inner)) return inner;
      }
    }
  }

  // Shape 2 / 3: top-level array
  if (Array.isArray(raw) && raw.length > 0) {
    const first = raw[0];
    // Shape 2: row object { "QUERY PLAN": [...] }
    if (first && typeof first === "object" && "QUERY PLAN" in first) {
      const inner = (first as Record<string, unknown>)["QUERY PLAN"];
      if (Array.isArray(inner)) return inner;
    }
    // Shape 3: already the [{Plan:{}}] array
    if (first && typeof first === "object" && "Plan" in first) {
      return raw;
    }
  }

  return null;
}

/**
 * Recursively converts one Postgres plan node into the normalized shape.
 *
 * `details` excludes the four promoted fields (Node Type, Relation Name,
 * Total Cost, Plan Rows) and the recursion field (Plans). Everything else
 * — Index Cond, Filter, Hash Cond, Sort Key, Plan Width, Startup Cost, etc.
 * — flows through verbatim so the UI's expand panel can show it.
 *
 * WHY we don't enumerate every PG field:
 *   Postgres exposes dozens of node-type-specific fields. Hand-mapping each
 *   one into a strongly typed shape would balloon this file and miss future
 *   additions. The promoted-vs-details split keeps the contract narrow while
 *   leaving a verbatim escape hatch for power users.
 */
function convertPostgresNode(node: Record<string, unknown>): ExplainNode {
  const PROMOTED = new Set([
    "Node Type",
    "Relation Name",
    "Total Cost",
    "Plan Rows",
    "Plans",
  ]);

  const details: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!PROMOTED.has(k)) details[k] = v;
  }

  const childrenRaw = Array.isArray(node["Plans"])
    ? (node["Plans"] as unknown[])
    : [];
  const children = childrenRaw.map((c) =>
    convertPostgresNode(c as Record<string, unknown>)
  );

  return {
    type:
      typeof node["Node Type"] === "string"
        ? (node["Node Type"] as string)
        : "Unknown",
    table:
      typeof node["Relation Name"] === "string"
        ? (node["Relation Name"] as string)
        : null,
    cost:
      typeof node["Total Cost"] === "number"
        ? (node["Total Cost"] as number)
        : null,
    rows:
      typeof node["Plan Rows"] === "number"
        ? (node["Plan Rows"] as number)
        : null,
    details,
    children,
  };
}
