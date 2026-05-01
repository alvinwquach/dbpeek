// ===== FILE PURPOSE =====
// PostgreSQL-specific schema introspection handler.
//
// Implements the SchemaHandler contract by querying Postgres system catalogs
// (pg_class, pg_index, pg_attribute, pg_namespace) and information_schema
// views. Restricted to the `public` schema — multi-schema support is a future
// enhancement that needs its own UI (a schema picker) before it's worth
// surfacing dozens of internal pg_catalog tables in the sidebar.

import type { SchemaHandler } from "../types.js";
import { extractRows } from "../utils.js";

// ===== POSTGRES HANDLER =====
//
// Reference: PostgreSQL system catalogs and information_schema.
//   - pg_tables view:  https://www.postgresql.org/docs/current/view-pg-tables.html
//   - pg_class:        https://www.postgresql.org/docs/current/catalog-pg-class.html
//   - reltuples is the planner's row estimate, updated by VACUUM/ANALYZE.
//     A value of -1 means "never analyzed"; we coerce that to 0 so the UI
//     gets a non-negative number.

export const postgresHandler: SchemaHandler = {
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
