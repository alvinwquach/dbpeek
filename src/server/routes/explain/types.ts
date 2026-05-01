// ===== FILE PURPOSE =====
// Shared types for the EXPLAIN route module.
//
// Splitting these into their own file (rather than living next to the route
// factory) lets the per-dialect parsers and the route factory both depend on
// them without either depending on the other — same separation pattern used
// by routes/schema/types.ts.

import type { Knex } from "../../db.js";

// ===== NORMALIZED TREE =====

/**
 * One node in the dialect-agnostic plan tree returned by POST /api/explain.
 *
 * WHY this exact shape:
 *   The four supported engines disagree on every detail of EXPLAIN output —
 *   field names, units, nesting, even whether the result is JSON, text, or
 *   XML. The UI cannot branch on dialect for every render decision; instead
 *   each per-dialect parser collapses its native shape into this single
 *   contract before the response leaves the server.
 *
 * WHY `details` is a free-form `Record<string, unknown>`:
 *   The four promoted fields (type/table/cost/rows) cover what the UI uses
 *   for cost-coloured bars and the seq-scan warning. Everything else (Index
 *   Cond, access_type, Filter, Sort Key, …) is dialect-specific and varies
 *   per-node. We pass the rest through verbatim so power users can expand a
 *   node and read the planner's own annotations without us having to
 *   enumerate every possible field across four engines.
 */
export interface ExplainNode {
  /** Human label, e.g. "Seq Scan", "Hash Join", "Table Scan (range)". */
  type: string;
  /** Relation/table name when the node touches a base relation; otherwise null. */
  table: string | null;
  /** Total estimated cost in planner units, or null when the dialect doesn't expose one. */
  cost: number | null;
  /** Estimated rows produced by this node, or null when the dialect doesn't expose one. */
  rows: number | null;
  /** Verbatim dialect-specific fields not promoted above. */
  details: Record<string, unknown>;
  /** Operator inputs — always an array, empty for leaf scans. */
  children: ExplainNode[];
}

/** Final response payload returned by POST /api/explain. */
export interface ExplainResponse {
  plan: ExplainNode;
  raw: string;
}

// ===== PARSER CONTRACT =====

/**
 * One per-dialect EXPLAIN driver. The `run` method owns BOTH the dialect's
 * EXPLAIN command syntax and the result parsing — keeping them in the same
 * function lets each parser file be read and tested as a single unit
 * (mirrors the SchemaHandler interface in routes/schema/types.ts).
 *
 * WHY `run` instead of separate `command` + `parse` fields:
 *   MSSQL needs to issue three statements (SET SHOWPLAN_XML ON / query / SET
 *   SHOWPLAN_XML OFF) so its `run` is not a one-shot db.raw() call. Folding
 *   command + parse into a single async function lets every parser have the
 *   same shape regardless of how many round-trips it needs.
 *
 * The route factory captures `db` once and threads the user's SQL through
 * `run`; the returned `raw` is also surfaced to the UI's "raw plan" toggle.
 */
export interface ExplainParser {
  run(db: Knex, sql: string): Promise<{ raw: unknown; parsed: ExplainNode }>;
}
