// ===== FILE PURPOSE =====
// MySQL-specific schema introspection handler.
//
// Implements the SchemaHandler contract by querying MySQL's
// information_schema.* views. Restricted to the currently selected database
// (DATABASE()) — users connected to a single database expect to see only its
// tables, not every database on the server.

import type { SchemaHandler } from "../types.js";
import { extractRows } from "../utils.js";

// ===== MYSQL HANDLER =====
//
// Reference: MySQL INFORMATION_SCHEMA tables.
//   - TABLES:               https://dev.mysql.com/doc/refman/8.4/en/information-schema-tables-table.html
//   - COLUMNS:              https://dev.mysql.com/doc/refman/8.4/en/information-schema-columns-table.html
//   - KEY_COLUMN_USAGE:     https://dev.mysql.com/doc/refman/8.4/en/information-schema-key-column-usage-table.html
//   - STATISTICS (indexes): https://dev.mysql.com/doc/refman/8.4/en/information-schema-statistics-table.html
//   - DATABASE() returns the currently selected schema, which is the only
//     schema we want to surface (mirrors the Postgres "public" decision).

export const mysqlHandler: SchemaHandler = {
  /**
   * Lists user tables in the currently-selected database.
   *
   * WHY TABLE_TYPE = 'BASE TABLE':
   *   information_schema.TABLES also lists VIEWs and SYSTEM VIEWs.
   *   Restricting to 'BASE TABLE' gives us only real, queryable tables —
   *   the same set a developer thinks of when they say "the tables in my
   *   database". Views are a future enhancement with their own endpoint.
   *
   * WHY COALESCE on TABLE_ROWS:
   *   For empty or newly-created tables MySQL may report TABLE_ROWS = NULL
   *   until the storage engine has had a chance to populate the stat.
   *   Coercing NULL to 0 keeps the API contract `rowCount: number`.
   */
  async listTables(db) {
    const result = await db.raw(`
      SELECT
        TABLE_NAME AS name,
        COALESCE(TABLE_ROWS, 0) AS row_count
      FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);
    return extractRows<{ name: string; row_count: number | string }>(
      result
    ).map((row) => ({
      name: row.name,
      rowCount: Number(row.row_count),
    }));
  },

  /**
   * Describes columns for one table.
   *
   * WHY we still query KEY_COLUMN_USAGE for PKs even though COLUMN_KEY
   * already exposes 'PRI':
   *   COLUMN_KEY conflates PK / UNIQUE / MUL into a single column and is
   *   awkward to interpret for composite or partial uniqueness scenarios.
   *   Going through KEY_COLUMN_USAGE with CONSTRAINT_NAME = 'PRIMARY' is
   *   the documented, unambiguous way and parallels how the Postgres
   *   handler is structured (consistency reduces future bugs).
   */
  async describeTable(db, tableName) {
    const colResult = await db.raw(
      `
      SELECT
        COLUMN_NAME AS name,
        COLUMN_TYPE AS type,
        IS_NULLABLE AS nullable,
        COLUMN_DEFAULT AS default_value
      FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION
    `,
      [tableName]
    );
    const cols = extractRows<{
      name: string;
      type: string;
      nullable: string; // 'YES' | 'NO'
      default_value: string | null;
    }>(colResult);

    if (cols.length === 0) return [];

    const pkResult = await db.raw(
      `
      SELECT COLUMN_NAME AS name
      FROM information_schema.key_column_usage
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
    `,
      [tableName]
    );
    const pkSet = new Set(
      extractRows<{ name: string }>(pkResult).map((r) => r.name)
    );

    // Foreign keys: REFERENCED_TABLE_NAME is non-NULL only for FK constraints.
    const fkResult = await db.raw(
      `
      SELECT
        COLUMN_NAME AS name,
        REFERENCED_TABLE_NAME AS ref_table,
        REFERENCED_COLUMN_NAME AS ref_column
      FROM information_schema.key_column_usage
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND REFERENCED_TABLE_NAME IS NOT NULL
    `,
      [tableName]
    );
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const r of extractRows<{
      name: string;
      ref_table: string;
      ref_column: string;
    }>(fkResult)) {
      fkMap.set(r.name, { table: r.ref_table, column: r.ref_column });
    }

    // Indexed columns: STATISTICS lists every (index, column) pair, including
    // multi-column indexes. DISTINCT collapses to "this column appears in at
    // least one index", which is what `isIndexed` represents.
    const idxResult = await db.raw(
      `
      SELECT DISTINCT COLUMN_NAME AS name
      FROM information_schema.statistics
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
    `,
      [tableName]
    );
    const idxSet = new Set(
      extractRows<{ name: string }>(idxResult).map((r) => r.name)
    );

    return cols.map((c) => ({
      name: c.name,
      type: c.type,
      nullable: c.nullable === "YES",
      defaultValue: c.default_value,
      isPrimaryKey: pkSet.has(c.name),
      foreignKey: fkMap.get(c.name) ?? null,
      isIndexed: idxSet.has(c.name),
    }));
  },

  // ===== MYSQL CREATE TABLE VIA SHOW CREATE TABLE =====
  //
  // MySQL ships a built-in command that emits the canonical CREATE TABLE
  // string for any table:
  //   SHOW CREATE TABLE `tbl`
  // The result is a one-row, two-column resultset: { Table, "Create Table" }.
  // The DDL is exactly what mysqldump would write — fully quoted, with
  // engine, charset, and collation clauses preserved. Reconstructing this
  // from information_schema would be redundant and likely incomplete; we
  // pass the engine's own output through unchanged.
  //
  // SECURITY: SHOW CREATE TABLE cannot accept bind parameters for the table
  // name — the grammar requires a literal identifier. The route layer has
  // already whitelisted `:table` against listTables(), so the value reaching
  // this query is server-confirmed to exist. We additionally backtick-quote
  // and escape embedded backticks (`` ` `` → `` `` `` ``) for defense-in-depth
  // against an exotic table name (legal in MySQL when quoted).
  async getDdl(db, tableName) {
    const quoted = "`" + tableName.replace(/`/g, "``") + "`";
    const result = await db.raw(`SHOW CREATE TABLE ${quoted}`);
    // The mysql2 driver returns SHOW CREATE TABLE as the standard
    // [rows, fields] tuple. extractRows pulls the rows array.
    const rows = extractRows<Record<string, unknown>>(result);
    const row = rows[0];
    if (!row) return `-- Table "${tableName}" not found.`;

    // The DDL column is literally named "Create Table" (with a space).
    // Some driver versions or configs return it under different casing,
    // so we look for the first key that is not "Table" — that one holds
    // the DDL string.
    const ddl = row["Create Table"] ?? row["Create View"];
    if (typeof ddl === "string") return ddl;

    for (const [key, value] of Object.entries(row)) {
      if (key !== "Table" && typeof value === "string") return value;
    }
    return `-- Could not retrieve DDL for "${tableName}".`;
  },
};
