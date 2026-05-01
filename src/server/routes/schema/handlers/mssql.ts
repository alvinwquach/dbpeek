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

  // ===== MSSQL CREATE TABLE RECONSTRUCTION =====
  //
  // SQL Server has no first-party "give me the DDL" command at the SQL layer
  // (sp_helptext is for procedures; the SMO library lives in C#/.NET, not
  // T-SQL). We reconstruct from the sys.* catalogs:
  //
  //   - sys.columns + sys.types (+ length / precision / scale) → columns with
  //     full type modifiers (varchar(255), decimal(10,2), nvarchar(max), …)
  //   - sys.default_constraints                                → DEFAULT exprs
  //   - sys.identity_columns                                   → IDENTITY(s, i)
  //   - sys.indexes is_primary_key=1 + sys.index_columns       → PK clause
  //   - sys.foreign_key_columns + sys.tables/columns            → FK clauses
  //   - sys.indexes (non-PK) + sys.index_columns                → CREATE INDEX
  //
  // The output uses bracket-quoted identifiers ([col]) which is T-SQL's
  // canonical quoting form and correctly handles reserved words / spaces.
  //
  // KNOWN LIMITATIONS:
  //   - CHECK constraints, computed columns, filtered indexes, included
  //     columns, and partitioning are not emitted. Capturing every such
  //     feature would balloon this function; the common-case DDL is
  //     enough for an interactive browse-and-copy workflow.
  async getDdl(db, tableName) {
    // ── Columns ───────────────────────────────────────────────────────────
    // Build the dialect-spelled type string in SQL itself — it's the only
    // place where the precision / scale / max-length rules for each base
    // type are encoded. Doing this in SQL keeps the JS side dumb (just join
    // pre-formatted strings) and avoids a per-type switch on the client.
    //
    // Length rules: char/varchar (and their nchar/nvarchar variants) carry
    // a length; max_length is in bytes for char/varchar and 2× chars for
    // n-prefixed types, and -1 means MAX. Numeric types carry precision
    // and scale. Everything else is a plain type name.
    const colResult = await db.raw(
      `
      SELECT
        c.name AS name,
        CASE
          WHEN tp.name IN ('char','varchar','binary','varbinary')
            THEN tp.name + '(' +
                 CASE WHEN c.max_length = -1 THEN 'max'
                      ELSE CAST(c.max_length AS VARCHAR(10)) END + ')'
          WHEN tp.name IN ('nchar','nvarchar')
            THEN tp.name + '(' +
                 CASE WHEN c.max_length = -1 THEN 'max'
                      ELSE CAST(c.max_length / 2 AS VARCHAR(10)) END + ')'
          WHEN tp.name IN ('decimal','numeric')
            THEN tp.name + '(' + CAST(c.precision AS VARCHAR(10)) + ',' +
                                  CAST(c.scale AS VARCHAR(10)) + ')'
          ELSE tp.name
        END AS type,
        c.is_nullable AS nullable,
        c.is_identity AS is_identity,
        ic.seed_value AS seed_value,
        ic.increment_value AS increment_value,
        dc.definition AS default_value
      FROM sys.columns c
      INNER JOIN sys.tables t ON t.object_id = c.object_id
      INNER JOIN sys.types tp ON tp.user_type_id = c.user_type_id
      LEFT JOIN sys.default_constraints dc
        ON dc.object_id = c.default_object_id
      LEFT JOIN sys.identity_columns ic
        ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo' AND t.name = ?
      ORDER BY c.column_id
    `,
      [tableName]
    );
    const cols = extractRows<{
      name: string;
      type: string;
      nullable: boolean | number;
      is_identity: boolean | number;
      seed_value: number | string | null;
      increment_value: number | string | null;
      default_value: string | null;
    }>(colResult);

    if (cols.length === 0) return `-- Table "${tableName}" not found.`;

    // ── Primary key (composite-aware) ─────────────────────────────────────
    // ic.key_ordinal preserves the column order inside a composite key,
    // which matters for index lookups — re-ordering would change the index.
    const pkResult = await db.raw(
      `
      SELECT c.name AS name, i.name AS pk_name
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      WHERE i.is_primary_key = 1
        AND SCHEMA_NAME(t.schema_id) = 'dbo'
        AND t.name = ?
      ORDER BY ic.key_ordinal
    `,
      [tableName]
    );
    const pkRows = extractRows<{ name: string; pk_name: string }>(pkResult);

    // ── Foreign keys (grouped by constraint) ──────────────────────────────
    // A composite FK has multiple rows in sys.foreign_key_columns, one per
    // column-pair. We group by constraint_object_id so each FK is emitted
    // as ONE clause referencing all its columns at once.
    const fkResult = await db.raw(
      `
      SELECT
        fkc.constraint_object_id AS fk_id,
        fk.name AS fk_name,
        pc.name AS column_name,
        rt.name AS ref_table,
        rc.name AS ref_column,
        fkc.constraint_column_id AS ord
      FROM sys.foreign_key_columns fkc
      INNER JOIN sys.foreign_keys fk
        ON fk.object_id = fkc.constraint_object_id
      INNER JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
      INNER JOIN sys.columns pc
        ON pc.object_id = fkc.parent_object_id
        AND pc.column_id = fkc.parent_column_id
      INNER JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
      INNER JOIN sys.columns rc
        ON rc.object_id = fkc.referenced_object_id
        AND rc.column_id = fkc.referenced_column_id
      WHERE SCHEMA_NAME(pt.schema_id) = 'dbo' AND pt.name = ?
      ORDER BY fkc.constraint_object_id, fkc.constraint_column_id
    `,
      [tableName]
    );
    const fkRows = extractRows<{
      fk_id: number;
      fk_name: string;
      column_name: string;
      ref_table: string;
      ref_column: string;
      ord: number;
    }>(fkResult);

    // ── Non-PK indexes ────────────────────────────────────────────────────
    // We exclude the PK index (already covered by the inline CONSTRAINT
    // clause emitted above) and heaps (index_id = 0; they're not indexes
    // at all but the table's own page chain). is_unique_constraint = 1
    // indexes are also excluded — they're emitted as CONSTRAINT ... UNIQUE
    // alongside the PK rather than as standalone CREATE INDEX statements,
    // but for simplicity we currently emit them as CREATE [UNIQUE] INDEX too.
    const idxResult = await db.raw(
      `
      SELECT
        i.name AS index_name,
        i.is_unique AS is_unique,
        i.type_desc AS type_desc,
        c.name AS column_name,
        ic.key_ordinal AS ord,
        ic.is_descending_key AS is_desc
      FROM sys.indexes i
      INNER JOIN sys.index_columns ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      INNER JOIN sys.columns c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
      INNER JOIN sys.tables t ON t.object_id = i.object_id
      WHERE SCHEMA_NAME(t.schema_id) = 'dbo'
        AND t.name = ?
        AND i.is_primary_key = 0
        AND i.index_id > 0
      ORDER BY i.name, ic.key_ordinal
    `,
      [tableName]
    );
    const idxRows = extractRows<{
      index_name: string;
      is_unique: boolean | number;
      type_desc: string;
      column_name: string;
      ord: number;
      is_desc: boolean | number;
    }>(idxResult);

    // ── Assemble ──────────────────────────────────────────────────────────
    // Build column lines first. The format is:
    //   [name] type [IDENTITY(s,i)] [NOT NULL | NULL] [DEFAULT (expr)]
    // T-SQL's canonical column form is to ALWAYS spell NULL or NOT NULL
    // (rather than relying on the database default), which keeps the DDL
    // unambiguous when re-run against a server with a different ANSI_NULLS.
    const colLines = cols.map((c) => {
      const parts = [`[${c.name}]`, c.type];
      if (c.is_identity) {
        const seed = c.seed_value ?? 1;
        const inc = c.increment_value ?? 1;
        parts.push(`IDENTITY(${seed},${inc})`);
      }
      parts.push(c.nullable ? "NULL" : "NOT NULL");
      if (c.default_value != null) parts.push(`DEFAULT ${c.default_value}`);
      return `  ${parts.join(" ")}`;
    });

    // Inline PK constraint inside the CREATE TABLE ( ... ) — composite PKs
    // can't be expressed as inline column constraints, and emitting it here
    // keeps the table definition self-contained.
    if (pkRows.length > 0) {
      const pkName = pkRows[0]!.pk_name;
      const pkCols = pkRows.map((r) => `[${r.name}]`).join(", ");
      colLines.push(`  CONSTRAINT [${pkName}] PRIMARY KEY (${pkCols})`);
    }

    const lines: string[] = [];
    lines.push(`CREATE TABLE [dbo].[${tableName}] (`);
    lines.push(colLines.join(",\n"));
    lines.push(`);`);

    // FKs as ALTER TABLE statements. Group rows by fk_id so a composite FK
    // (multi-column) renders as one statement with parenthesized column lists.
    if (fkRows.length > 0) {
      const grouped = new Map<
        number,
        {
          name: string;
          cols: string[];
          refTable: string;
          refCols: string[];
        }
      >();
      for (const r of fkRows) {
        const existing = grouped.get(r.fk_id);
        if (existing) {
          existing.cols.push(r.column_name);
          existing.refCols.push(r.ref_column);
        } else {
          grouped.set(r.fk_id, {
            name: r.fk_name,
            cols: [r.column_name],
            refTable: r.ref_table,
            refCols: [r.ref_column],
          });
        }
      }
      for (const fk of grouped.values()) {
        const cols = fk.cols.map((c) => `[${c}]`).join(", ");
        const refCols = fk.refCols.map((c) => `[${c}]`).join(", ");
        lines.push("");
        lines.push(
          `ALTER TABLE [dbo].[${tableName}] ADD CONSTRAINT [${fk.name}] ` +
            `FOREIGN KEY (${cols}) REFERENCES [dbo].[${fk.refTable}] (${refCols});`
        );
      }
    }

    // CREATE INDEX statements for the remaining (non-PK) indexes. Group by
    // index_name so a multi-column index produces one CREATE INDEX with all
    // its key columns in order.
    if (idxRows.length > 0) {
      const grouped = new Map<
        string,
        { unique: boolean; cols: { name: string; desc: boolean }[] }
      >();
      for (const r of idxRows) {
        const existing = grouped.get(r.index_name);
        if (existing) {
          existing.cols.push({
            name: r.column_name,
            desc: Boolean(r.is_desc),
          });
        } else {
          grouped.set(r.index_name, {
            unique: Boolean(r.is_unique),
            cols: [{ name: r.column_name, desc: Boolean(r.is_desc) }],
          });
        }
      }
      for (const [indexName, ix] of grouped.entries()) {
        const cols = ix.cols
          .map((c) => `[${c.name}]${c.desc ? " DESC" : ""}`)
          .join(", ");
        lines.push("");
        lines.push(
          `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX [${indexName}] ` +
            `ON [dbo].[${tableName}] (${cols});`
        );
      }
    }

    return lines.join("\n");
  },
};
