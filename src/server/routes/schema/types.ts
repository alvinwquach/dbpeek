// ===== FILE PURPOSE =====
// Type contracts for the schema introspection routes.
//
// Defines the public response shapes (TableInfo, ColumnInfo, ColumnStats) and
// the internal SchemaHandler interface that every per-dialect handler
// implements. Splitting the types into their own module lets the handlers,
// the route layer, and the stats utilities all import from one place without
// pulling in dialect SQL or aggregate logic transitively.

import type { Knex } from "../../db.js";

// ===== PUBLIC TYPES =====

/**
 * One entry in the GET /api/schema response.
 *
 * WHY rowCount is `number` and may be an ESTIMATE rather than an exact count:
 *   Postgres and MySQL expose row count via planner statistics
 *   (pg_class.reltuples, information_schema.tables.TABLE_ROWS) — these are
 *   updated by VACUUM/ANALYZE and may lag behind reality. SQLite has no
 *   stored estimate at all, so we run COUNT(*) per table; for a localhost
 *   dev tool this is acceptable. MSSQL uses sys.partitions.rows which is
 *   maintained by the engine. Calling it "rowCount" is honest: it is the
 *   row count the engine reports — not necessarily the value a fresh
 *   COUNT(*) would return.
 */
export interface TableInfo {
  name: string;
  rowCount: number;
}

/**
 * One column entry in the GET /api/schema/:table response.
 *
 * WHY foreignKey is `{ table, column } | null` rather than a separate
 * `referencesTable` / `referencesColumn` pair of optional fields:
 *   The UI either shows an FK badge ("→ users.id") or it doesn't. Bundling
 *   both fields together as one nullable object reflects the all-or-nothing
 *   nature of the data in the type and makes the consumer code (a single
 *   `if (col.foreignKey)`) trivial.
 */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  foreignKey: { table: string; column: string } | null;
  isIndexed: boolean;
}

/**
 * Aggregate statistics for a single column, returned by
 * GET /api/schema/:table/:column/stats.
 *
 * WHY a discriminated shape with optional `min/max/avg` vs `topValues` rather
 * than a tagged union:
 *   The two value sets are mutually exclusive (numeric → min/max/avg present,
 *   non-numeric → topValues present), but a tagged union ({ kind: "numeric" }
 *   vs { kind: "string" }) would force the client to switch on `kind` everywhere.
 *   With optional fields the client can render with `if (stats.min != null) ...`
 *   or `if (stats.topValues) ...` — same type narrowing, less ceremony.
 *
 * WHY `nullPct` is on a 0–100 scale (a percentage) and not 0–1 (a fraction):
 *   The UI label is "X% null" with a horizontal bar. Storing the value as
 *   a percentage keeps the UI math trivial (`width: ${nullPct}%`) and aligns
 *   with the field name — the postfix "Pct" is read as "percent".
 *
 * WHY `value` in topValues is `unknown`:
 *   The column might be a string, integer, boolean, date, or a JSON blob —
 *   anything that can land in a non-numeric column. Forcing `string` would
 *   either lie about the runtime type or push String() coercion into the
 *   server. Letting JSON serialization handle whatever the driver returns is
 *   simpler and gives the client room to format types it recognizes.
 */
export interface ColumnStats {
  /** Number of distinct non-NULL values in the column. */
  distinct: number;
  /** Percentage of rows where the column is NULL, scaled 0–100. */
  nullPct: number;
  /** Numeric column: minimum value, or null if the table is empty / all NULL. */
  min?: number | null;
  /** Numeric column: maximum value, or null if the table is empty / all NULL. */
  max?: number | null;
  /** Numeric column: average value, or null if the table is empty / all NULL. */
  avg?: number | null;
  /**
   * Non-numeric column: up to 5 most common values with their occurrence count,
   * ordered by count descending. Empty array if the table has no non-NULL rows.
   */
  topValues?: Array<{ value: unknown; count: number }>;
}

// ===== INTERNAL TYPES =====

/**
 * The dialect-specific introspection contract. Every supported dialect
 * implements this interface; the route layer is dialect-agnostic and
 * dispatches on `config.dialect`.
 *
 * WHY a dispatch table over a switch statement:
 *   The same exhaustiveness reasoning used by DIALECT_TO_KNEX_CLIENT
 *   in src/server/db.ts — declaring `Record<Dialect, SchemaHandler>`
 *   means adding a new Dialect value to the union without supplying a
 *   handler is a compile-time error. A switch statement would silently
 *   fall through to a default branch and ship a runtime "unknown
 *   dialect" error in production.
 */
export interface SchemaHandler {
  /**
   * Lists all user tables in the database with an estimated row count.
   * Excludes system catalogs / information_schema / sqlite_* tables.
   */
  listTables: (db: Knex) => Promise<TableInfo[]>;

  /**
   * Describes the columns of a single table. Returns an empty array if
   * the table does not exist — the route layer translates that into 404.
   * (We additionally whitelist `:table` against listTables() before
   * calling this, so the empty-array case mainly protects against races
   * where a table is dropped between the two calls.)
   */
  describeTable: (db: Knex, tableName: string) => Promise<ColumnInfo[]>;

  /**
   * Returns the table's CREATE TABLE DDL as a single SQL string ready to
   * paste into a script.
   *
   * WHY a string and not a structured payload:
   *   The UI renders this verbatim in a read-only CodeMirror with SQL
   *   highlighting. Returning a structured object would force the client
   *   to re-serialize back to SQL, duplicating each dialect's quoting
   *   rules. Each dialect already knows how to spell its own DDL — let
   *   the server do it once and ship a string.
   *
   * DIALECT STRATEGY:
   *   - MySQL / SQLite: the engine itself produces DDL (SHOW CREATE TABLE
   *     for MySQL, the original `sql` text in sqlite_master for SQLite).
   *     We pass it through unchanged.
   *   - Postgres / MSSQL: there is no built-in "give me the DDL" command,
   *     so we reconstruct it from system catalogs (pg_attribute /
   *     pg_constraint / pg_indexes for Postgres, sys.columns / sys.indexes
   *     / sys.foreign_keys for MSSQL). The reconstruction is correct for
   *     the common shapes (tables, PK/FK/UNIQUE/CHECK constraints, indexes)
   *     but may not capture every esoteric feature (per-column collations,
   *     tablespaces, partitioning) — for a developer browsing tool that's
   *     a deliberate trade-off for legibility.
   */
  getDdl: (db: Knex, tableName: string) => Promise<string>;
}
