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

  // ===== POSTGRES CREATE TABLE RECONSTRUCTION =====
  //
  // Postgres has no built-in "show me the DDL for this table" command (unlike
  // MySQL's SHOW CREATE TABLE). We reconstruct the DDL from the system catalogs:
  //
  //   - pg_attribute  + format_type()       → columns with full type modifiers
  //                                           (e.g. varchar(255), numeric(10,2))
  //   - pg_attrdef    + pg_get_expr()       → DEFAULT expressions
  //   - pg_constraint + pg_get_constraintdef() → PK / FK / UNIQUE / CHECK
  //                                           printed as canonical constraint text
  //                                           (no manual quoting on our side)
  //   - pg_indexes.indexdef                 → CREATE INDEX statements,
  //                                           filtered to NON-constraint indexes
  //                                           so we don't redundantly emit the
  //                                           PK/UNIQUE backing index after the
  //                                           ALTER TABLE that already created it
  //
  // WHY use pg_get_constraintdef / pg_get_indexdef:
  //   They emit the exact, fully-quoted SQL that pg itself would round-trip.
  //   That spares us from re-implementing identifier quoting, composite-key
  //   formatting, and ON DELETE / ON UPDATE clauses. Anything we hand-format
  //   is a future bug; anything pg formats for us is by definition correct.
  async getDdl(db, tableName) {
    // ── Columns ────────────────────────────────────────────────────────────
    // format_type(atttypid, atttypmod) collapses the catalog's separate type +
    // modifier columns into the dialect-spelling we want ("character varying(255)",
    // "numeric(10,2)", etc.). attnum > 0 filters out system columns (oid, ctid).
    // attisdropped excludes columns that pg keeps as tombstones after a DROP
    // COLUMN — they're invisible to applications and shouldn't appear in DDL.
    const colResult = await db.raw(
      `
      SELECT
        a.attname AS name,
        format_type(a.atttypid, a.atttypmod) AS type,
        a.attnotnull AS not_null,
        pg_get_expr(d.adbin, d.adrelid) AS default_value
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attrdef d
        ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE n.nspname = 'public'
        AND c.relname = ?
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    `,
      [tableName]
    );
    const cols = extractRows<{
      name: string;
      type: string;
      not_null: boolean;
      default_value: string | null;
    }>(colResult);

    if (cols.length === 0) {
      // Empty result means the table vanished between the route's whitelist
      // check and this query (rare race). Return a placeholder so the UI shows
      // a clear, non-empty message instead of a blank editor.
      return `-- Table "${tableName}" not found.`;
    }

    // ── Constraints ────────────────────────────────────────────────────────
    // pg_get_constraintdef(oid) returns canonical constraint text such as:
    //   PRIMARY KEY (id)
    //   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    //   UNIQUE (email)
    //   CHECK ((age >= 0))
    // Combined with the ALTER TABLE prefix below, this produces ready-to-run
    // SQL without us having to spell out any of the constraint-specific syntax.
    const conResult = await db.raw(
      `
      SELECT
        conname AS name,
        pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = ?
      ORDER BY c.contype, c.conname
    `,
      [tableName]
    );
    const constraints = extractRows<{ name: string; def: string }>(conResult);

    // ── Indexes (excluding those backing a constraint) ─────────────────────
    // PK and UNIQUE constraints both create an underlying index, and that
    // index also appears in pg_index. Emitting both the constraint AND the
    // backing CREATE INDEX would produce broken DDL (duplicate index name).
    // The NOT EXISTS filter keeps only "real" indexes — those the user
    // created with CREATE INDEX, not the implicit ones.
    const idxResult = await db.raw(
      `
      SELECT pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ?
        AND NOT i.indisprimary
        AND NOT EXISTS (
          SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid
        )
      ORDER BY i.indexrelid
    `,
      [tableName]
    );
    const indexes = extractRows<{ def: string }>(idxResult);

    // ── Assemble the DDL ───────────────────────────────────────────────────
    // Format each column line as: "  "name" type [NOT NULL] [DEFAULT expr],
    // Identifier quoting via "..." is the SQL-standard form Postgres prefers.
    const colLines = cols.map((c) => {
      const parts = [`"${c.name}"`, c.type];
      if (c.not_null) parts.push("NOT NULL");
      if (c.default_value != null) parts.push(`DEFAULT ${c.default_value}`);
      return `  ${parts.join(" ")}`;
    });

    const lines: string[] = [];
    lines.push(`CREATE TABLE "${tableName}" (`);
    lines.push(colLines.join(",\n"));
    lines.push(`);`);

    // Append ALTER TABLE statements for each constraint. We emit them as
    // separate statements (rather than inline column constraints) for two
    // reasons: composite keys can't be expressed inline, and the separation
    // keeps the column block tidy and grep-friendly.
    for (const con of constraints) {
      lines.push("");
      lines.push(
        `ALTER TABLE "${tableName}" ADD CONSTRAINT "${con.name}" ${con.def};`
      );
    }

    // Append CREATE INDEX statements last. pg_get_indexdef already includes
    // the trailing semicolon-less form, so we add it ourselves.
    for (const ix of indexes) {
      lines.push("");
      lines.push(`${ix.def};`);
    }

    return lines.join("\n");
  },
};
