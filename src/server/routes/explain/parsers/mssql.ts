// ===== FILE PURPOSE =====
// SQL Server-specific EXPLAIN parser (initial-version stub).
//
// SQL Server returns its query plan as an XML document via SET SHOWPLAN_XML.
// A full XML walker is out of scope for this initial implementation; we
// surface a single synthetic node containing the raw XML in `details.xml`
// so the user can read it via the "raw plan" toggle in the UI.
//
// WHY a stub now instead of skipping the dialect:
//   The route still returns a 200 with the verbatim plan — so the Explain
//   button doesn't error out for MSSQL users. They get the raw XML, which
//   is more useful than a 501 Not Implemented while a future iteration adds
//   a proper sys.dm_exec_query_plan tree walker.

import type { ExplainNode, ExplainParser } from "../types.js";

// ===== PARSER ENTRY POINT =====

/**
 * mssqlParser — toggles SHOWPLAN_XML on, runs the user's SQL (the engine
 * returns the XML plan instead of executing it), then toggles it off.
 *
 * WHY three separate db.raw() calls:
 *   tedious cannot batch these reliably as a single statement string —
 *   SHOWPLAN_XML is a session setting that must be its own statement, and
 *   chaining them with semicolons doesn't survive every driver version.
 *
 * WHY a try/finally around the OFF toggle:
 *   If the inner db.raw(sql) throws (bad SQL, missing table, etc.), the
 *   pool slot would otherwise stay in SHOWPLAN_XML mode and return XML for
 *   the next regular query that uses it. The finally block guarantees the
 *   setting is always cleared before the connection returns to the pool.
 */
export const mssqlParser: ExplainParser = {
  async run(db, sql) {
    await db.raw("SET SHOWPLAN_XML ON");
    try {
      const raw = await db.raw(sql);
      return { raw, parsed: parseMSSQLPlan(raw) };
    } finally {
      await db.raw("SET SHOWPLAN_XML OFF");
    }
  },
};

// ===== STUB PARSER =====

/**
 * Wrap the raw XML in a single-node tree. The UI's "raw plan" toggle remains
 * the primary way users read the plan until tree-extraction is implemented.
 */
function parseMSSQLPlan(raw: unknown): ExplainNode {
  const xml = extractMSSQLXml(raw);
  return {
    type: "Showplan XML",
    table: null,
    cost: null,
    rows: null,
    details: { xml: xml ?? "(no plan returned)" },
    children: [],
  };
}

/**
 * Pull the first string-valued column out of the first row.
 * SHOWPLAN_XML's column name is "Microsoft SQL Server 2005 XML Showplan",
 * which is awkward to hardcode; first-string-value is robust.
 */
function extractMSSQLXml(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0];
  if (!first || typeof first !== "object") return null;
  for (const v of Object.values(first as Record<string, unknown>)) {
    if (typeof v === "string") return v;
  }
  return null;
}
