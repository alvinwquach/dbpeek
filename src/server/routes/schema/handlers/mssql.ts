// ===== FILE PURPOSE =====
// SQL Server (MSSQL) specific schema introspection handler.
//
// Implements the SchemaHandler contract by querying SQL Server's sys.* system
// catalog views. Restricted to the `dbo` schema — the same default-schema
// decision as Postgres ('public') and MySQL (DATABASE()), and consistent with
// how T-SQL tooling presents the database when no schema is specified.

import type { SchemaHandler } from "../types.js";
import { extractRows } from "../utils.js";

// ===== MSSQL HANDLER =====
//
// Reference: SQL Server system catalog views (sys.*).
//   - sys.tables, sys.columns, sys.types, sys.indexes, sys.index_columns,
//     sys.foreign_keys, sys.foreign_key_columns, sys.partitions.
//   - SCHEMA_NAME(schema_id) = 'dbo' filters to the default schema, the
//     same decision Postgres ('public') and MySQL (DATABASE()) make.

export const mssqlHandler: SchemaHandler = {
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
