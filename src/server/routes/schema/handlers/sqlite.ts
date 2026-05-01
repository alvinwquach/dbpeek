// ===== FILE PURPOSE =====
// SQLite-specific schema introspection handler.
//
// SQLite has no information_schema. Metadata comes from two sources:
//   - sqlite_master (a system table with one row per object — table, view,
//     index, trigger).
//   - PRAGMA statements (table_info, foreign_key_list, index_list,
//     index_info) which return a fixed-shape result set per call.
//
// PRAGMA cannot accept bind parameters for the table name — the table name
// must be inlined into the SQL. The route layer whitelists `:table` against
// listTables() output BEFORE calling describeTable, so the value reaching
// the PRAGMA call is always a real table name. We additionally quote-escape
// any embedded quotes via `quoteSqliteIdentifier` for defense-in-depth.

import type { SchemaHandler, TableInfo } from "../types.js";
import { extractRows, quoteSqliteIdentifier } from "../utils.js";

// ===== SQLITE HANDLER =====
//
// Reference: SQLite has no information_schema. Metadata comes from two
// sources:
//   - sqlite_master (a system table with one row per object — table, view,
//     index, trigger).
//   - PRAGMA statements (table_info, foreign_key_list, index_list,
//     index_info) which return a fixed-shape result set per call.
//
// PRAGMA cannot accept bind parameters for the table name — the table
// name must be inlined into the SQL. The route layer whitelists `:table`
// against listTables() output BEFORE calling describeTable, so the value
// reaching the PRAGMA call is always a real table name. We additionally
// quote-escape any embedded quotes for defense-in-depth: a table name
// containing a quote (legal in SQLite if quoted) would otherwise prematurely
// terminate the PRAGMA's string literal.

export const sqliteHandler: SchemaHandler = {
  /**
   * Lists user tables (excluding internal sqlite_* tables) and runs
   * COUNT(*) per table for an exact row count.
   *
   * WHY COUNT(*) per table (an N+1 query):
   *   SQLite has no stored row-count statistic to read from. Running
   *   COUNT(*) on each table is exact but does N+1 round-trips. For a
   *   localhost dev tool browsing maybe a few dozen tables, this is fine
   *   (better-sqlite3 is synchronous and in-process — there is no network
   *   round-trip cost). For a database with thousands of tables this
   *   becomes slow; a future enhancement could cap at the first 100 tables
   *   or use sqlite_stat1 if ANALYZE has been run.
   *
   * WHY the name LIKE 'sqlite_%' filter:
   *   sqlite_master is itself a table; sqlite_sequence appears in any DB
   *   with an AUTOINCREMENT column; sqlite_stat* appears after ANALYZE.
   *   None of these are user tables — surfacing them in autocomplete would
   *   be confusing.
   */
  async listTables(db) {
    const tablesResult = await db.raw(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);
    const tables = extractRows<{ name: string }>(tablesResult);

    const out: TableInfo[] = [];
    for (const t of tables) {
      // Quote the table name to handle reserved words and unusual identifiers.
      // The name came from sqlite_master so it's a real, server-confirmed
      // table — but we still escape embedded quotes per the function comment.
      const countResult = await db.raw(
        `SELECT COUNT(*) AS c FROM ${quoteSqliteIdentifier(t.name)}`
      );
      const rows = extractRows<{ c: number | string }>(countResult);
      out.push({ name: t.name, rowCount: Number(rows[0]?.c ?? 0) });
    }
    return out;
  },

  /**
   * Describes columns for one table using PRAGMA statements.
   *
   * PRAGMA table_info returns one row per column with:
   *   { cid, name, type, notnull, dflt_value, pk }
   *
   * PRAGMA foreign_key_list returns one row per FK column with:
   *   { id, seq, table, from, to, on_update, on_delete, match }
   *
   * PRAGMA index_list returns one row per index, then PRAGMA index_info
   * gives the columns of that index. We expand both to build the
   * `isIndexed` set.
   */
  async describeTable(db, tableName) {
    const quoted = quoteSqliteIdentifier(tableName);

    const colResult = await db.raw(`PRAGMA table_info(${quoted})`);
    const cols = extractRows<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>(colResult);

    if (cols.length === 0) return [];

    const fkResult = await db.raw(`PRAGMA foreign_key_list(${quoted})`);
    const fkMap = new Map<string, { table: string; column: string }>();
    for (const r of extractRows<{
      from: string;
      table: string;
      to: string;
    }>(fkResult)) {
      fkMap.set(r.from, { table: r.table, column: r.to });
    }

    // Build the indexed-columns set by walking each index and collecting
    // the columns it covers.
    const indexListResult = await db.raw(`PRAGMA index_list(${quoted})`);
    const indexes = extractRows<{ name: string }>(indexListResult);
    const idxSet = new Set<string>();
    for (const ix of indexes) {
      const indexInfoResult = await db.raw(
        `PRAGMA index_info(${quoteSqliteIdentifier(ix.name)})`
      );
      for (const r of extractRows<{ name: string }>(indexInfoResult)) {
        idxSet.add(r.name);
      }
    }

    return cols.map((c) => ({
      name: c.name,
      type: c.type,
      // PRAGMA's notnull is 1 when NOT NULL is set — invert for `nullable`.
      nullable: c.notnull === 0,
      defaultValue: c.dflt_value,
      // PRAGMA's pk is non-zero (1, 2, ...) for PK columns indicating order
      // in a composite key. Truthy check is sufficient.
      isPrimaryKey: c.pk > 0,
      foreignKey: fkMap.get(c.name) ?? null,
      isIndexed: idxSet.has(c.name),
    }));
  },
};
