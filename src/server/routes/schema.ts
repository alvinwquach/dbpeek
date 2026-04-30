// ===== FILE PURPOSE =====
// Schema introspection routes — exposes metadata about the connected database
// so the UI can render a tree of tables and columns and use it to power
// SQL autocomplete.
//
//   GET /api/schema           → list of tables + estimated row counts
//   GET /api/schema/:table    → list of columns + PK/FK/index metadata
//
// ===== WHY THIS FILE EXISTS AS A SEPARATE MODULE =====
//
// Schema introspection is the ONE part of the application where dialect
// portability completely breaks down. Each of the four supported engines
// (Postgres, MySQL, SQLite, MSSQL) stores its own metadata in a different
// place, with a different schema, returned in a different shape:
//
//   - Postgres exposes catalogs (pg_class, pg_constraint, pg_index, ...).
//   - MySQL exposes the SQL-standard information_schema.* views.
//   - SQLite has no catalog tables — only PRAGMA statements that return
//     a fixed-shape result set per call (PRAGMA table_info, PRAGMA
//     foreign_key_list, PRAGMA index_list).
//   - MSSQL has its own sys.* catalog views (sys.tables, sys.columns, ...).
//
// Bundling all four implementations into the query/status route files
// would drown the security-critical bits in dialect plumbing. Keeping
// schema in its own module:
//   1. Makes the dialect-specific quirks easy to find and audit.
//   2. Lets the query route stay focused on the security boundary.
//   3. Keeps the test surface for each route file small and focused.
//
// ===== WHY GETTING THIS RIGHT MATTERS =====
//
// The output of these endpoints feeds the SQL autocomplete in CodeMirror.
// A typo in a table or column name returned here means the editor will
// suggest names that DON'T EXIST in the user's database — the worst kind
// of silent failure for a developer tool. Each dialect's query is therefore
// pinned to documented system catalogs (cited in the comment above each
// implementation) rather than driver shortcuts that may change.
//
// ===== RESPONSE CONTRACT =====
//
//   GET /api/schema (200):
//     {
//       "tables": [
//         { "name": string, "rowCount": number }   // rowCount is an estimate
//                                                  // (may be 0 if statistics
//                                                  // have never been gathered)
//       ]
//     }
//
//   GET /api/schema/:table (200):
//     {
//       "columns": [
//         {
//           "name":          string,
//           "type":          string,         // dialect-native type label
//           "nullable":      boolean,
//           "defaultValue":  string | null,  // raw default expression
//           "isPrimaryKey":  boolean,
//           "foreignKey":    { "table": string, "column": string } | null,
//           "isIndexed":     boolean
//         }
//       ]
//     }
//
//   GET /api/schema/:table (404):
//     { "error": "Table not found: <name>" }
//
//   GET /api/schema/:table (400):
//     { "error": <database error message> }
//
// ===== WHY :table IS WHITELISTED, NOT BIND-PARAMETERIZED =====
//
// SQLite's PRAGMA statements (table_info, foreign_key_list, index_list,
// index_info) cannot accept bind parameters for the table name — the
// PRAGMA grammar requires a literal identifier or quoted string at parse
// time. Postgres, MySQL, and MSSQL CAN bind the name, but we use the same
// whitelisting strategy in all four for consistency and defense-in-depth:
//
//   1. Call listTables() to get the canonical list of tables in the
//      database.
//   2. Reject the request with 404 if `:table` is not in that list.
//   3. Only then call describeTable(), passing the validated name.
//
// This guarantees `:table` is always a real, server-confirmed identifier
// before it reaches any dialect's introspection query — closing the door
// on PRAGMA injection in SQLite while keeping the four implementations
// uniform.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../db.js";
import type { ConnectionConfig, Dialect } from "../../types/connection.js";

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
interface TableInfo {
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
interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  foreignKey: { table: string; column: string } | null;
  isIndexed: boolean;
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
interface SchemaHandler {
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
}

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
function extractRows<T = Record<string, unknown>>(result: unknown): T[] {
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

// ===== POSTGRES HANDLER =====
//
// Reference: PostgreSQL system catalogs and information_schema.
//   - pg_tables view:  https://www.postgresql.org/docs/current/view-pg-tables.html
//   - pg_class:        https://www.postgresql.org/docs/current/catalog-pg-class.html
//   - reltuples is the planner's row estimate, updated by VACUUM/ANALYZE.
//     A value of -1 means "never analyzed"; we coerce that to 0 so the UI
//     gets a non-negative number.

const postgresHandler: SchemaHandler = {
  /**
   * Lists user tables in the `public` schema with their estimated row counts.
   *
   * WHY restricted to schemaname = 'public':
   *   The vast majority of application databases keep their tables in the
   *   default `public` schema. Surfacing every schema (including pg_catalog
   *   and information_schema) would flood the UI tree with hundreds of
   *   internal entries and make autocomplete unusable. Multi-schema support
   *   is a future enhancement that would need its own UI (a schema picker).
   *
   * WHY a LEFT JOIN on pg_class:
   *   pg_tables.tablename gives the name; pg_class.reltuples gives the
   *   estimate. We join on the relation name AND nspname='public' so we
   *   don't accidentally pick up a pg_class entry from a different schema
   *   that happens to share the table name.
   */
  async listTables(db) {
    const result = await db.raw(`
      SELECT
        t.tablename AS name,
        COALESCE(NULLIF(c.reltuples, -1), 0)::bigint AS row_count
      FROM pg_tables t
      LEFT JOIN pg_namespace n ON n.nspname = t.schemaname
      LEFT JOIN pg_class c ON c.relname = t.tablename AND c.relnamespace = n.oid
      WHERE t.schemaname = 'public'
      ORDER BY t.tablename
    `);
    return extractRows<{ name: string; row_count: string | number }>(
      result
    ).map((row) => ({
      name: row.name,
      // pg returns bigint as string in the JS driver to avoid precision
      // loss above 2^53. For row count estimates this is fine to coerce —
      // a table with > 2^53 rows is not realistic on a single server.
      rowCount: Number(row.row_count),
    }));
  },

  /**
   * Describes columns for one table. Aggregates four pieces of information:
   *   - basic column metadata from information_schema.columns
   *   - primary key flag from information_schema.table_constraints joined
   *     with key_column_usage
   *   - foreign key info from the same constraint tables (constraint_type
   *     = 'FOREIGN KEY') joined with constraint_column_usage for the
   *     referenced column
   *   - index membership from pg_index joined with pg_attribute
   *
   * WHY four queries instead of one mega-join:
   *   The information_schema joins required to combine all of this in one
   *   query become unreadable and rely on Postgres-specific behavior
   *   (e.g. correctly correlating constraint_column_usage rows). Four
   *   small, single-purpose queries are easier to audit, easier to test,
   *   and on a localhost dev tool the round-trip cost is negligible.
   */
  async describeTable(db, tableName) {
    const colResult = await db.raw(
      `
      SELECT
        column_name AS name,
        data_type AS type,
        is_nullable AS nullable,
        column_default AS default_value
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ?
      ORDER BY ordinal_position
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

    // Primary key columns
    const pkResult = await db.raw(
      `
      SELECT kcu.column_name AS name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ?
    `,
      [tableName]
    );
    const pkSet = new Set(
      extractRows<{ name: string }>(pkResult).map((r) => r.name)
    );

    // Foreign keys: column → referenced (table, column).
    const fkResult = await db.raw(
      `
      SELECT
        kcu.column_name AS name,
        ccu.table_name AS ref_table,
        ccu.column_name AS ref_column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
        AND tc.table_name = ?
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

    // Indexed columns. pg_index.indkey is an int2vector of attribute numbers;
    // unnesting it and joining pg_attribute resolves to attribute names. We
    // include PK indexes — the UI's "indexed" flag means "has an index of
    // any kind", which is what users care about for autocomplete hints.
    const idxResult = await db.raw(
      `
      SELECT DISTINCT a.attname AS name
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
      WHERE n.nspname = 'public' AND c.relname = ?
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
};

// ===== MYSQL HANDLER =====
//
// Reference: MySQL INFORMATION_SCHEMA tables.
//   - TABLES:               https://dev.mysql.com/doc/refman/8.4/en/information-schema-tables-table.html
//   - COLUMNS:              https://dev.mysql.com/doc/refman/8.4/en/information-schema-columns-table.html
//   - KEY_COLUMN_USAGE:     https://dev.mysql.com/doc/refman/8.4/en/information-schema-key-column-usage-table.html
//   - STATISTICS (indexes): https://dev.mysql.com/doc/refman/8.4/en/information-schema-statistics-table.html
//   - DATABASE() returns the currently selected schema, which is the only
//     schema we want to surface (mirrors the Postgres "public" decision).

const mysqlHandler: SchemaHandler = {
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
};

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
function quoteSqliteIdentifier(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

const sqliteHandler: SchemaHandler = {
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

// ===== MSSQL HANDLER =====
//
// Reference: SQL Server system catalog views (sys.*).
//   - sys.tables, sys.columns, sys.types, sys.indexes, sys.index_columns,
//     sys.foreign_keys, sys.foreign_key_columns, sys.partitions.
//   - SCHEMA_NAME(schema_id) = 'dbo' filters to the default schema, the
//     same decision Postgres ('public') and MySQL (DATABASE()) make.

const mssqlHandler: SchemaHandler = {
  /**
   * Lists user tables in the dbo schema with row counts from sys.partitions.
   *
   * WHY index_id IN (0, 1):
   *   sys.partitions has one row per index per table per partition. Heaps
   *   are index_id 0; clustered indexes are index_id 1. Either represents
   *   the actual data pages — exactly one of them exists per partition.
   *   Including non-clustered indexes (index_id >= 2) would double-count.
   */
  async listTables(db) {
    const result = await db.raw(`
      SELECT
        t.name AS name,
        SUM(p.rows) AS row_count
      FROM sys.tables t
      INNER JOIN sys.partitions p ON p.object_id = t.object_id
      WHERE p.index_id IN (0, 1)
        AND SCHEMA_NAME(t.schema_id) = 'dbo'
      GROUP BY t.name
      ORDER BY t.name
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
   * WHY four queries instead of one mega-join:
   *   Same reasoning as the Postgres handler — readability and audit
   *   surface trump query-count micro-optimization for an interactive dev
   *   tool. Each query targets one well-defined system view.
   *
   * WHY parameter binding via ? placeholders:
   *   The tedious driver translates ? to its native @p1 binding form when
   *   the query goes through knex.raw with a bindings array. This is the
   *   standard knex pattern that works across all four supported drivers.
   */
  async describeTable(db, tableName) {
    const colResult = await db.raw(
      `
      SELECT
        c.name AS name,
        TYPE_NAME(c.user_type_id) AS type,
        c.is_nullable AS nullable,
        dc.definition AS default_value
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      LEFT JOIN sys.default_constraints dc ON dc.object_id = c.default_object_id
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name = ?
      ORDER BY c.column_id
    `,
      [tableName]
    );
    const cols = extractRows<{
      name: string;
      type: string;
      nullable: boolean | number;
      default_value: string | null;
    }>(colResult);

    if (cols.length === 0) return [];

    // Primary key columns: index with is_primary_key = 1.
    const pkResult = await db.raw(
      `
      SELECT c.name AS name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      WHERE i.is_primary_key = 1
        AND SCHEMA_NAME(t.schema_id) = 'dbo'
        AND t.name = ?
    `,
      [tableName]
    );
    const pkSet = new Set(
      extractRows<{ name: string }>(pkResult).map((r) => r.name)
    );

    // Foreign keys: each row links a parent column to its referenced column
    // and table.
    const fkResult = await db.raw(
      `
      SELECT
        pc.name AS name,
        rt.name AS ref_table,
        rc.name AS ref_column
      FROM sys.foreign_key_columns fkc
      INNER JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
      INNER JOIN sys.columns pc
        ON pc.object_id = fkc.parent_object_id
        AND pc.column_id = fkc.parent_column_id
      INNER JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
      INNER JOIN sys.columns rc
        ON rc.object_id = fkc.referenced_object_id
        AND rc.column_id = fkc.referenced_column_id
      WHERE SCHEMA_NAME(pt.schema_id) = 'dbo' AND pt.name = ?
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

    // Indexed columns. Includes PK indexes and other clustered/non-clustered
    // indexes; matches the "any index" semantics used by the other dialects.
    const idxResult = await db.raw(
      `
      SELECT DISTINCT c.name AS name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name = ?
    `,
      [tableName]
    );
    const idxSet = new Set(
      extractRows<{ name: string }>(idxResult).map((r) => r.name)
    );

    return cols.map((c) => ({
      name: c.name,
      type: c.type,
      // tedious returns is_nullable as boolean; some other paths return 1/0.
      // Coerce to boolean explicitly to insulate the API contract from that.
      nullable: Boolean(c.nullable),
      defaultValue: c.default_value,
      isPrimaryKey: pkSet.has(c.name),
      foreignKey: fkMap.get(c.name) ?? null,
      isIndexed: idxSet.has(c.name),
    }));
  },
};

// ===== DISPATCH TABLE =====

/**
 * Per-dialect schema introspection handlers.
 *
 * `Record<Dialect, SchemaHandler>` is the same exhaustiveness pattern used
 * by DIALECT_TO_KNEX_CLIENT in src/server/db.ts — adding a new dialect to
 * the union without supplying a handler here is a compile error rather than
 * a runtime "unknown dialect" surprise.
 */
const HANDLERS: Record<Dialect, SchemaHandler> = {
  postgres: postgresHandler,
  mysql: mysqlHandler,
  sqlite: sqliteHandler,
  mssql: mssqlHandler,
};

// ===== ROUTE FACTORY =====

/**
 * Builds the Express Router that serves the schema introspection endpoints.
 *
 * WHY a factory function rather than a module-level Router:
 *   The router needs `config.dialect` (to dispatch into HANDLERS) and `db`
 *   (to run the queries) — both determined at CLI startup, not at module
 *   import. A factory captures them in a closure so tests can pass a mock
 *   ConnectionConfig and a mock Knex without any module-level state to
 *   reset between tests. Mirrors the pattern in createQueryRouter and
 *   createStatusRouter.
 *
 * @param config - The resolved ConnectionConfig. Only `dialect` is used by
 *   this route; the rest is ignored.
 * @param db - Knex instance to execute introspection queries against.
 */
export function createSchemaRouter(
  config: ConnectionConfig,
  db: Knex
): Router {
  const router = Router();
  const handler = HANDLERS[config.dialect];

  // ── GET /api/schema ─────────────────────────────────────────────────────
  // Lists all tables with estimated row counts.
  router.get("/", async (_req: Request, res: Response): Promise<void> => {
    try {
      const tables = await handler.listTables(db);
      res.status(200).json({ tables });
    } catch (err: unknown) {
      // Any error here is a database/connectivity problem (the route has no
      // user input to validate). 500 is correct: a healthy database with a
      // valid connection should always return a table list.
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/schema/:table ──────────────────────────────────────────────
  // Describes one table's columns. Whitelists `:table` against listTables()
  // before invoking describeTable — see the file header for the security
  // rationale.
  router.get(
    "/:table",
    async (req: Request, res: Response): Promise<void> => {
      // WHY the explicit narrowing instead of trusting req.params.table to
      // be a string:
      //   With `noUncheckedIndexedAccess` enabled in tsconfig, Express's
      //   req.params is typed as Record<string, string | undefined>. The
      //   route pattern guarantees `:table` is set at runtime, but
      //   TypeScript can't see that. A defensive empty-string check costs
      //   nothing and keeps the type clean for the downstream calls.
      const tableName = req.params.table;
      if (!tableName) {
        res.status(400).json({ error: "Missing table name in URL." });
        return;
      }

      try {
        // Whitelist check: the requested table MUST appear in the result of
        // listTables(). This guards against PRAGMA injection in SQLite and
        // is the canonical 404 trigger for the other dialects too.
        const tables = await handler.listTables(db);
        const exists = tables.some((t) => t.name === tableName);
        if (!exists) {
          res.status(404).json({ error: `Table not found: ${tableName}` });
          return;
        }

        const columns = await handler.describeTable(db, tableName);
        res.status(200).json({ columns });
      } catch (err: unknown) {
        // Errors past the whitelist check are database failures. 400 is the
        // right code (mirrors the query route) — a malformed table name that
        // somehow passed the whitelist would be a client bug, not a server
        // bug, and surfacing the raw driver message helps the user diagnose.
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    }
  );

  return router;
}
