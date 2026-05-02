/**
 * src/client/utils/buildUpdateSql.ts
 *
 * WHAT:
 *   Builds a human-readable, dialect-correctly-quoted UPDATE statement string
 *   for the cell-edit confirmation dialog AND for the query history entry.
 *
 * WHY this lives on the client even though the server also formats the SQL:
 *   The confirmation dialog needs to show the SQL BEFORE the request fires —
 *   that's the whole point of the confirmation. The server's formatted SQL
 *   is only available on the response. So we build the same string twice:
 *     1. Client (here): for the pre-execution preview shown to the user.
 *     2. Server (data route): for the post-execution log returned in the
 *        success body. The two MUST match — if the server's quoting differs
 *        from this file's, the history entry would silently disagree with
 *        what the user just confirmed. The format helpers in both files use
 *        the same rules: identifiers quoted, NULL/TRUE/FALSE bare, strings
 *        single-quoted with '' escape, JSON for object values.
 *
 * NOTE: this is a DISPLAY string only. Execution always goes through PUT
 * /api/data/:table which uses parameter binding — this string is never sent
 * to the database. That asymmetry is what lets us use a friendlier (more
 * readable) format here without compromising injection safety.
 */

import type { Dialect } from "../../types/connection";

// ===== HELPERS =====

/**
 * quoteIdent — wraps an identifier in the dialect's quoting characters so
 * the rendered SQL is paste-runnable in the same dialect's CLI.
 *
 * Postgres / SQLite / MSSQL  → "double quotes"
 * MySQL                       → `backticks`
 *
 * Doubles up any embedded quote character defensively. Identifiers reaching
 * this function have already passed the schema whitelist on the server, but
 * the doubled escape is cheap insurance against any future code path that
 * forgets to whitelist first.
 */
function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * formatLiteral — renders a JS value as a SQL literal for display.
 *
 *   null / undefined  →  NULL
 *   true / false      →  TRUE / FALSE
 *   number            →  bare number
 *   object / array    →  '{…}' (JSON, single-quoted with '' escape)
 *   string            →  '…' (single-quoted with '' escape)
 *
 * WHY single-quote escape (replace ' with ''):
 *   That's the SQL-standard string-literal escape. A user who pastes the
 *   confirmation SQL into psql / mysql / sqlite3 should get an identical
 *   result. Backslash escapes are MySQL-specific and break elsewhere.
 */
function formatLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// ===== PUBLIC API =====

/** Inputs for buildUpdateSql. */
export interface BuildUpdateSqlInput {
  /** Active dialect — picks the identifier quote style. */
  dialect: Dialect;
  /** Target table name (schema-confirmed by the caller). */
  table: string;
  /** Column being edited (schema-confirmed by the caller). */
  column: string;
  /** New value for the cell (any JSON-serialisable value, including null). */
  value: unknown;
  /**
   * Map of primary-key column name → current row value. Order is preserved
   * in the WHERE clause for predictable, diff-friendly history entries.
   */
  pk: Record<string, unknown>;
}

/**
 * buildUpdateSql — composes the UPDATE preview shown in the confirmation
 * dialog and stored in the query history.
 *
 * Output shape:
 *   UPDATE <table> SET <col> = <value> WHERE <pk1> = <v1> AND <pk2> = <v2>
 *
 * The output is intentionally one line — the confirmation dialog renders
 * it inside a `<code>` block with horizontal scroll, and the history panel
 * applies its own line-clamp. Multi-line formatting would fight both.
 */
export function buildUpdateSql({
  dialect,
  table,
  column,
  value,
  pk,
}: BuildUpdateSqlInput): string {
  const qTable = quoteIdent(table, dialect);
  const qCol = quoteIdent(column, dialect);
  // Object.entries preserves insertion order in every modern JS engine, so
  // the WHERE clause renders in the same order the caller supplied. That
  // matters for composite PKs where the convention is (parent_id, seq).
  const where = Object.entries(pk)
    .map(([k, v]) => `${quoteIdent(k, dialect)} = ${formatLiteral(v)}`)
    .join(" AND ");
  return `UPDATE ${qTable} SET ${qCol} = ${formatLiteral(value)} WHERE ${where}`;
}
