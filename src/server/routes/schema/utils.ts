// ===== FILE PURPOSE =====
// Shared helpers used by every per-dialect schema handler and by the stats
// endpoint:
//
//   - extractRows()          : strips the driver-specific wrapper around a
//                              knex.raw() result down to a plain row array.
//   - quoteSqliteIdentifier(): SQL-quotes an identifier for inlining inside a
//                              SQLite PRAGMA literal (the only dialect that
//                              cannot bind PRAGMA arguments).
//   - isNumericType()        : decides whether a dialect-native type label
//                              names a numeric column (gates the MIN/MAX/AVG
//                              vs. top-values branch in computeColumnStats).
//   - computeColumnStats()   : runs the dialect-portable aggregate queries
//                              that produce a ColumnStats payload for one
//                              (table, column) pair.
//
// Splitting these out of the per-dialect handler files keeps each handler
// focused on its own SQL and lets the stats route reuse the helpers without
// importing any handler concretely.

import type { Knex } from "../../db.js";
import type { Dialect } from "../../../types/connection.js";
import type { ColumnStats } from "./types.js";

// ===== KNEX RESULT EXTRACTION =====
//
// knex.raw() returns dialect-specific shapes — see the long comment block
// in src/server/routes/query.ts:normalizeResult for the full taxonomy.
// Because the queries in THIS file are written by us (not the user), we
// know exactly which shape each dialect returns. extractRows() strips the
// driver wrapper down to a plain array of row objects so the per-dialect
// handlers below can treat the result uniformly.

/**
 * Extracts row objects from a knex.raw() result, regardless of which
 * driver produced it.
 *
 * STRATEGY (mirrors normalizeResult in query.ts but returns row objects
 * instead of building a tabular envelope):
 *   1. Postgres (pg): { rows: [...], fields: [...] } → result.rows.
 *   2. MySQL (mysql2): [rows, fields] tuple             → result[0].
 *   3. SQLite (better-sqlite3): plain row array         → result.
 *   4. MSSQL (tedious): plain row array                 → result.
 *
 * @returns Array of row objects, or [] for any unrecognized shape.
 */
export function extractRows<T = Record<string, unknown>>(
  result: unknown
): T[] {
  // Postgres
  if (
    result &&
    typeof result === "object" &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }

  // MySQL: tuple of [rows, fields]. Distinguished from a generic array by
  // the second element being an array of field descriptors.
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    Array.isArray(result[1])
  ) {
    return result[0] as T[];
  }

  // SQLite / MSSQL: plain row array.
  if (Array.isArray(result)) {
    return result as T[];
  }

  return [];
}

// ===== SQLITE IDENTIFIER QUOTING =====
//
// PRAGMA cannot accept bind parameters for the table name — the table
// name must be inlined into the SQL. The route layer whitelists `:table`
// against listTables() output BEFORE calling describeTable, so the value
// reaching the PRAGMA call is always a real table name. We additionally
// quote-escape any embedded quotes for defense-in-depth: a table name
// containing a quote (legal in SQLite if quoted) would otherwise prematurely
// terminate the PRAGMA's string literal.

/**
 * Quotes a SQLite identifier for use inside a PRAGMA literal.
 *
 * WHY this exists despite the whitelisting:
 *   The whitelist guarantees `name` came from sqlite_master — but it could
 *   still legally contain a single quote if the original CREATE TABLE used
 *   a quoted name. Doubling embedded quotes (`'` → `''`) is the standard
 *   SQL escape and prevents the PRAGMA literal from being prematurely
 *   terminated. Combined with the whitelist this is belt-and-suspenders.
 */
export function quoteSqliteIdentifier(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

// ===== NUMERIC TYPE DETECTION =====
//
// The stats endpoint behaves differently for numeric vs. non-numeric columns:
//   - Numeric → MIN / MAX / AVG aggregates.
//   - Non-numeric → top-5 most common values.
//
// Detecting "numeric" purely from the dialect-native type label requires care
// because some non-numeric type names happen to start with letters that match
// a substring search. The classic trap: PostgreSQL's "interval" type begins
// with "int", so a naive `t.includes("int")` would mis-classify it as numeric.
//
// We avoid the trap by extracting the leading TYPE TOKEN — the prefix of the
// type string up to the first whitespace or open paren — and comparing it
// against an exact-match set. "double precision" → token "double" (matches);
// "integer" → token "integer" (matches); "interval" → token "interval"
// (correctly does not match); "decimal(10,2)" → token "decimal" (matches).

/**
 * Set of SQL numeric type names recognized across all four dialects.
 *
 * WHY a flat Set rather than per-dialect lists:
 *   The numeric type names overlap heavily across dialects (every engine uses
 *   "int", "bigint", "decimal", etc.). Maintaining four near-identical lists
 *   would invite drift. The unique entries are:
 *     - Postgres:  int2/int4/int8 (aliases), float4/float8, money, serial/bigserial/smallserial
 *     - MySQL:     mediumint, tinyint, double (everything else is shared)
 *     - SQLite:    real (and aliases of the others — SQLite is type-flexible)
 *     - MSSQL:     smallmoney
 *   A single union avoids the maintenance cost of four tables.
 *
 * WHY "number" is included:
 *   It is Oracle's canonical numeric type. We do not currently support Oracle
 *   but the cost of including "number" is one Set entry, and pre-emptively
 *   covering it future-proofs against an Oracle adapter without surprise.
 */
export const NUMERIC_TYPE_TOKENS: ReadonlySet<string> = new Set([
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "int2",
  "int4",
  "int8",
  "numeric",
  "decimal",
  "dec",
  "fixed",
  "real",
  "float",
  "float4",
  "float8",
  "double",
  "money",
  "smallmoney",
  "serial",
  "bigserial",
  "smallserial",
  "number",
]);

/**
 * Decides whether a dialect-native type label refers to a numeric column.
 *
 * @param type - The type string returned by `describeTable` for the column —
 *   e.g. "integer" (Postgres), "int(11)" (MySQL), "INTEGER" (SQLite, uppercase),
 *   "int" (MSSQL), "double precision" (Postgres).
 *
 * @returns true if the column holds numeric values, false otherwise.
 */
export function isNumericType(type: string): boolean {
  // Lowercase first so callers do not have to normalize. Then take the prefix
  // up to the first whitespace or "(" — that is the bare type name without
  // size modifiers ("(255)") or trailing keywords ("precision", "unsigned").
  const head = type.toLowerCase().trim().split(/[\s(]/)[0];
  return NUMERIC_TYPE_TOKENS.has(head ?? "");
}

// ===== STATS COMPUTATION =====
//
// Once the route layer has whitelisted the (table, column) pair against
// `listTables` + `describeTable`, we run two or three aggregate queries to
// produce a ColumnStats payload.
//
// SAFETY: identifiers (table name, column name) are passed via knex's `??`
// placeholder which dialect-correctly quotes them ("col" for Postgres / SQLite,
// `col` for MySQL, [col] for MSSQL). They have already been validated against
// the schema, so the `??` is belt-and-suspenders — the worst case is that a
// real-but-weird identifier (containing a quote, say) gets escaped properly.
//
// PORTABILITY: ANSI aggregate functions (COUNT, MIN, MAX, AVG, SUM, CASE) work
// identically across all four supported dialects. The only dialect-divergent
// piece is the row-limit syntax for top-values: Postgres / MySQL / SQLite
// accept `LIMIT 5`, MSSQL requires `SELECT TOP 5 ... ORDER BY ...`. We branch
// on dialect for that one statement.

/** How many top values to return for non-numeric columns. */
const TOP_VALUES_LIMIT = 5;

/**
 * Runs the dialect-specific aggregate queries that produce the ColumnStats
 * payload for one (table, column) pair.
 *
 * STRATEGY:
 *   1. Run the COMMON query: COUNT(DISTINCT col), COUNT(*), and SUM(CASE WHEN
 *      col IS NULL ...). One round-trip yields three numbers (distinct, total,
 *      nulls) from which `distinct` and `nullPct` are derived.
 *   2. Branch on `numeric`:
 *        a. Numeric → run MIN / MAX / AVG (one round-trip).
 *        b. Non-numeric → run a GROUP BY / ORDER BY / LIMIT top-values query.
 *
 * WHY `??` placeholders for identifiers:
 *   Knex translates `??` into the dialect's quoted-identifier form. Although
 *   the names are already whitelisted, double-quoting via `??` defends against
 *   weirdly-named-but-real columns (e.g. a column literally named "select" or
 *   one containing a hyphen) that would otherwise produce a syntax error when
 *   inlined unquoted.
 *
 * @param db          - Knex instance.
 * @param dialect     - Dialect under which `db` was built — used only to pick
 *                      the right top-values syntax (LIMIT vs. TOP).
 * @param tableName   - Whitelisted table name.
 * @param columnName  - Whitelisted column name.
 * @param numeric     - Whether the column holds numeric values (decided by
 *                      the caller via `isNumericType`).
 *
 * @returns Populated ColumnStats payload.
 */
export async function computeColumnStats(
  db: Knex,
  dialect: Dialect,
  tableName: string,
  columnName: string,
  numeric: boolean
): Promise<ColumnStats> {
  // ── Step 1: distinct + null counts (common to numeric and non-numeric) ────
  //
  // WHY SUM(CASE WHEN col IS NULL THEN 1 ELSE 0 END) instead of a separate
  // COUNT-NULLS query:
  //   COUNT(*) - COUNT(col) would give the null count in one shot, but mixing
  //   it with COUNT(DISTINCT col) into a single SELECT is the cleanest way to
  //   get all three numbers in ONE round-trip. SUM-CASE makes the null count
  //   explicit in the SQL and avoids relying on the COUNT/COUNT-non-null
  //   subtraction trick that some readers may not recognize at a glance.
  const baseResult = await db.raw(
    `SELECT
       COUNT(DISTINCT ??) AS distinct_count,
       COUNT(*)           AS total_count,
       SUM(CASE WHEN ?? IS NULL THEN 1 ELSE 0 END) AS null_count
     FROM ??`,
    [columnName, columnName, tableName]
  );
  const baseRows = extractRows<{
    distinct_count: number | string | null;
    total_count: number | string | null;
    null_count: number | string | null;
  }>(baseResult);
  // The aggregate query always returns exactly one row — even on an empty
  // table, MIN/MAX/COUNT return a single-row "scalar" result. The defensive
  // `?? { ... }` guards against unexpected driver behavior (e.g. an
  // unrecognized result envelope returning [] from extractRows).
  const baseRow = baseRows[0] ?? {
    distinct_count: 0,
    total_count: 0,
    null_count: 0,
  };

  // Coerce through Number(): some drivers (notably pg) return BIGINT counts
  // as strings to avoid precision loss above 2^53. For row counts on a single
  // table, that overflow is not realistic — losing precision around 9
  // quadrillion rows is acceptable for a stats panel.
  const distinct = Number(baseRow.distinct_count ?? 0);
  const total = Number(baseRow.total_count ?? 0);
  const nulls = Number(baseRow.null_count ?? 0);

  // Guard against divide-by-zero on an empty table. With total = 0 there are
  // no rows to be NULL, so 0% is the only sensible answer.
  const nullPct = total === 0 ? 0 : (nulls / total) * 100;

  // ── Step 2a: numeric branch — MIN / MAX / AVG ──────────────────────────────
  if (numeric) {
    const numResult = await db.raw(
      `SELECT
         MIN(??) AS min_v,
         MAX(??) AS max_v,
         AVG(??) AS avg_v
       FROM ??`,
      [columnName, columnName, columnName, tableName]
    );
    const numRows = extractRows<{
      min_v: number | string | null;
      max_v: number | string | null;
      avg_v: number | string | null;
    }>(numResult);
    const numRow = numRows[0] ?? { min_v: null, max_v: null, avg_v: null };

    return {
      distinct,
      nullPct,
      // MIN/MAX/AVG return NULL when the input set is empty or all-NULL.
      // Preserve null in the API contract — coercing to 0 would lie about the
      // distinction between "the average is zero" and "there is nothing to
      // average".
      min: numRow.min_v == null ? null : Number(numRow.min_v),
      max: numRow.max_v == null ? null : Number(numRow.max_v),
      avg: numRow.avg_v == null ? null : Number(numRow.avg_v),
    };
  }

  // ── Step 2b: non-numeric branch — top values by frequency ──────────────────
  //
  // WHY filter NULLs out (WHERE col IS NOT NULL):
  //   The null percentage is already reported separately. Including NULL as a
  //   "top value" duplicates information and crowds out a real (informative)
  //   value from the limited slot count.
  //
  // WHY dialect branch on TOP vs LIMIT:
  //   T-SQL (MSSQL) does not accept the trailing `LIMIT n` clause that the
  //   other three engines share — it requires `SELECT TOP n` immediately
  //   after the SELECT keyword. We could express the same intent via OFFSET
  //   FETCH (SQL Server 2012+) but TOP is shorter and more widely supported
  //   across older MSSQL versions.
  const topSql =
    dialect === "mssql"
      ? `SELECT TOP ${TOP_VALUES_LIMIT} ?? AS value, COUNT(*) AS count_v
         FROM ??
         WHERE ?? IS NOT NULL
         GROUP BY ??
         ORDER BY COUNT(*) DESC`
      : `SELECT ?? AS value, COUNT(*) AS count_v
         FROM ??
         WHERE ?? IS NOT NULL
         GROUP BY ??
         ORDER BY COUNT(*) DESC
         LIMIT ${TOP_VALUES_LIMIT}`;
  const topResult = await db.raw(topSql, [
    columnName,
    tableName,
    columnName,
    columnName,
  ]);
  const topRows = extractRows<{ value: unknown; count_v: number | string }>(
    topResult
  );

  return {
    distinct,
    nullPct,
    // Coerce count to number (pg may return as string for BIGINT). Keep
    // `value` as-is — letting the client format it preserves type fidelity
    // for booleans, dates, JSON blobs, etc.
    topValues: topRows.map((r) => ({
      value: r.value,
      count: Number(r.count_v),
    })),
  };
}
