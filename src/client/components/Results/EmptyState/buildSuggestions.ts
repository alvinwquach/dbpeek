/**
 * src/client/components/Results/EmptyState/buildSuggestions.ts
 *
 * ===== FILE PURPOSE =====
 * Pure, schema-driven construction of up to four suggestions for the empty
 * state. No React, no DOM — just a function that turns three Zustand slices
 * (schemaMap, schemaColumns, rowCounts) into an ordered list of Suggestion
 * objects.
 *
 * The component layer (./index.tsx) memoizes this function on the three
 * inputs and renders the result. Splitting the logic out keeps the component
 * small and lets the suggestion engine be tested in isolation.
 *
 * ===== SUGGESTION CATALOG =====
 *
 *   1. PREVIEW LARGEST TABLE
 *      `SELECT * FROM <largest> LIMIT 20`
 *      Picks the table with the highest row count. Even brand-new users can
 *      orient themselves on the schema by glancing at the biggest fact table.
 *
 *   2. DISTRIBUTION ON ENUM-LIKE COLUMN
 *      `SELECT <col>, COUNT(*) AS count FROM <table> GROUP BY <col>
 *       ORDER BY count DESC`
 *      First column whose type is enum/bool OR whose name matches the
 *      curated allow-list (status, role, type, level, …).
 *
 *   3. AGGREGATES ON A NUMERIC COLUMN
 *      `SELECT MIN(<col>), MAX(<col>), AVG(<col>) FROM <table>`
 *      First numeric column that is NOT a PK and NOT an FK.
 *
 *   4. JOIN ON A FOREIGN KEY
 *      `SELECT * FROM <t1> JOIN <t2> ON <t1>.<col> = <t2>.<col> LIMIT 20`
 *      First non-self-referential FK in alphabetical-table order.
 *
 * Suggestions for which no schema target exists are omitted (e.g. a schema
 * with no FKs gets no JOIN row). Order is canonical: preview, distribution,
 * aggregate, join.
 */

import type {
  ColumnInfo,
  SchemaColumns,
  SchemaMap,
} from "../../../hooks/useSchema";
import {
  isEnumLikeColumn,
  isNumericType,
  normalizeForeignKey,
} from "./columnHelpers";

// ===== TYPES =====

/**
 * One concrete suggestion to render in the panel.
 *
 * `id` is used as the React key; suggestion KINDS are mutually exclusive but
 * the same kind in principle could appear twice (e.g. two distribution
 * candidates), so the id includes the table/column it targets to stay unique.
 */
export interface Suggestion {
  /** Stable React key. Combination of kind + table + column. */
  id: string;
  /** Single-letter glyph rendered in the icon tile (P, D, A, J). */
  letter: string;
  /** Tailwind text-color class for the icon tile (mid-tone, dark theme). */
  accentText: string;
  /** Tailwind border-color class for the icon tile. */
  accentBorder: string;
  /** Top-line label, e.g. "Preview largest table". */
  title: string;
  /** Sub-line that names the schema target, e.g. "users · 1.2M rows". */
  subtitle: string;
  /** SQL that gets loaded into the editor and auto-run on click. */
  sql: string;
}

/** Internal { table, column } pair — used by the picker helpers. */
interface ColumnRef {
  table: string;
  column: string;
}

/** Internal join-target shape — a FK that points at a different table. */
interface JoinRef {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

// ===== ROW-COUNT FORMATTER =====

/**
 * formatRowCount — humanizes large counts for the "users · 1.2M rows" subtitle.
 *
 *   < 1_000          → "42"
 *   < 1_000_000      → "12.3k"
 *   < 1_000_000_000  → "4.5M"
 *   else             → "1.2B"
 *
 * Why a local copy rather than importing SchemaTree's version:
 *   SchemaTree's formatRowCount is a private helper; exporting it solely so a
 *   sibling component can read it would couple two otherwise-independent files.
 *   Duplicating ~10 lines is preferable to a cross-folder import for a
 *   universally-known formatting routine.
 */
function formatRowCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

// ===== TABLE / COLUMN PICKERS =====

/**
 * pickLargestTable — returns the table with the highest row count, ties
 * broken alphabetically for stability.
 *
 * Returns null only when the schema has no tables at all. An all-empty
 * schema still gets a winner (the alphabetically-first table) — previewing
 * an empty table is a valid "nothing to find" result, not a UX failure.
 *
 * Why a stable secondary sort:
 *   Without it, two app loads against the same database could pick
 *   different "largest" tables when several tables tie at zero rows
 *   (which happens often on freshly migrated schemas).
 */
function pickLargestTable(
  tableNames: string[],
  rowCounts: Record<string, number>
): string | null {
  return (
    [...tableNames].sort((a, b) => {
      const ca = rowCounts[a] ?? 0;
      const cb = rowCounts[b] ?? 0;
      if (ca !== cb) return cb - ca;
      return a.localeCompare(b);
    })[0] ?? null
  );
}

/**
 * findFirstColumn — walks tables in two passes (populated first, then any)
 * and returns the first { table, column } pair whose column passes `predicate`.
 *
 * Why two passes:
 *   Examples that run against a populated table teach the user more than
 *   ones that come back empty. Preferring populated tables when a candidate
 *   exists gives the user a more pedagogical first interaction. Falling back
 *   to any table prevents the suggestion from disappearing on a freshly
 *   migrated schema where every table has zero rows.
 *
 * Why the table iteration order is the caller's responsibility:
 *   The caller passes a deterministic, alphabetical `tableNames` array. We
 *   don't sort here — that's the orchestrator's job, performed once and
 *   shared across all pickers so they all agree on "first".
 */
function findFirstColumn(
  tableNames: string[],
  schemaColumns: SchemaColumns,
  rowCounts: Record<string, number>,
  predicate: (col: ColumnInfo) => boolean
): ColumnRef | null {
  // Pass 1: tables with rows.
  for (const t of tableNames) {
    if ((rowCounts[t] ?? 0) === 0) continue;
    const cols = schemaColumns[t];
    if (!cols) continue;
    const hit = cols.find(predicate);
    if (hit) return { table: t, column: hit.name };
  }
  // Pass 2: any table.
  for (const t of tableNames) {
    const cols = schemaColumns[t];
    if (!cols) continue;
    const hit = cols.find(predicate);
    if (hit) return { table: t, column: hit.name };
  }
  return null;
}

/**
 * findFirstForeignKey — first column with a non-self-referential FK, in
 * alphabetical-table order.
 *
 * Why we skip self-references:
 *   A table whose FK points at itself (e.g. employees.manager_id →
 *   employees.id) is valid SQL, but the suggestion copy "JOIN <t1> ... <t2>"
 *   implies two distinct tables. Skipping self-references keeps the rendered
 *   tile honest without reworking the copy for a corner case.
 */
function findFirstForeignKey(
  tableNames: string[],
  schemaColumns: SchemaColumns
): JoinRef | null {
  for (const t of tableNames) {
    const cols = schemaColumns[t];
    if (!cols) continue;
    for (const c of cols) {
      const fk = normalizeForeignKey(c.foreignKey);
      if (fk == null) continue;
      if (fk.table === t) continue;
      return {
        fromTable: t,
        fromColumn: c.name,
        toTable: fk.table,
        toColumn: fk.column,
      };
    }
  }
  return null;
}

// ===== SUGGESTION FACTORIES =====
//
// Each factory returns a finished Suggestion for one kind. Splitting them
// from the orchestrator keeps the SQL templates and accent colors next to
// each other (visually paired) without the orchestrator having to know any
// of the rendering details.

/**
 * makePreviewSuggestion — "Preview largest table" tile.
 *
 * Subtitle behavior:
 *   - With a known nonzero row count: "<table> · 1.2M rows"
 *   - With zero / unknown:            "<table>"
 *   The bare-name fallback avoids an awkward "users · 0 rows" subtitle on a
 *   freshly migrated schema.
 */
function makePreviewSuggestion(
  table: string,
  rowCount: number | undefined
): Suggestion {
  return {
    id: `preview:${table}`,
    letter: "P",
    accentText: "text-[#7c85d6]",
    accentBorder: "border-[#2a2a4a]",
    title: "Preview largest table",
    subtitle:
      rowCount != null && rowCount > 0
        ? `${table} · ${formatRowCount(rowCount)} ${rowCount === 1 ? "row" : "rows"}`
        : table,
    sql: `SELECT * FROM ${table} LIMIT 20`,
  };
}

/**
 * makeDistributionSuggestion — "Show distribution" tile.
 * Renders the canonical `GROUP BY <col> ORDER BY count DESC` template.
 */
function makeDistributionSuggestion(
  table: string,
  column: string
): Suggestion {
  return {
    id: `distribution:${table}.${column}`,
    letter: "D",
    accentText: "text-[#34d399]",
    accentBorder: "border-[#1f3d2c]",
    title: "Show distribution",
    subtitle: `${table}.${column}`,
    sql:
      `SELECT ${column}, COUNT(*) AS count\n` +
      `FROM ${table}\n` +
      `GROUP BY ${column}\n` +
      `ORDER BY count DESC`,
  };
}

/**
 * makeAggregateSuggestion — "Aggregate numeric column" tile.
 * Renders MIN/MAX/AVG side by side so the user sees the column's full numeric
 * range at a glance.
 */
function makeAggregateSuggestion(table: string, column: string): Suggestion {
  return {
    id: `aggregate:${table}.${column}`,
    letter: "A",
    accentText: "text-[#f59e0b]",
    accentBorder: "border-[#3d2c14]",
    title: "Aggregate numeric column",
    subtitle: `${table}.${column}`,
    sql:
      `SELECT MIN(${column}) AS min,\n` +
      `       MAX(${column}) AS max,\n` +
      `       AVG(${column}) AS avg\n` +
      `FROM ${table}`,
  };
}

/**
 * makeJoinSuggestion — "Join on a foreign key" tile.
 * Renders an explicit INNER JOIN bounded by LIMIT 20 so the user doesn't pull
 * an entire denormalized table on accident.
 */
function makeJoinSuggestion(join: JoinRef): Suggestion {
  return {
    id: `join:${join.fromTable}.${join.fromColumn}→${join.toTable}.${join.toColumn}`,
    letter: "J",
    accentText: "text-[#a78bfa]",
    accentBorder: "border-[#2b1f4d]",
    title: "Join on a foreign key",
    subtitle: `${join.fromTable} → ${join.toTable}`,
    sql:
      `SELECT *\n` +
      `FROM ${join.fromTable}\n` +
      `JOIN ${join.toTable}\n` +
      `  ON ${join.fromTable}.${join.fromColumn} = ${join.toTable}.${join.toColumn}\n` +
      `LIMIT 20`,
  };
}

// ===== ORCHESTRATOR =====

/**
 * buildSuggestions — top-level orchestrator. Composes the table / column
 * pickers and the suggestion factories into the canonical list rendered by
 * the empty state.
 *
 * @returns up to four Suggestion objects in canonical order:
 *          preview, distribution, aggregate, join. Suggestions for which no
 *          schema target exists are simply omitted (a schema with no FKs
 *          gets no JOIN row, etc.). May be empty when the schema has no
 *          tables at all — the caller renders a quiet fallback in that case.
 *
 * Why we sort tableNames once at the top:
 *   Every picker needs a deterministic iteration order for "first hit" picks.
 *   Sorting once and passing the array around makes the deterministic-order
 *   guarantee a property of the orchestrator, not each picker. Pickers stay
 *   honest as long as they iterate `tableNames` in the order received.
 */
export function buildSuggestions(
  schemaMap: SchemaMap,
  schemaColumns: SchemaColumns,
  rowCounts: Record<string, number>
): Suggestion[] {
  const tableNames = Object.keys(schemaMap).sort((a, b) => a.localeCompare(b));
  if (tableNames.length === 0) return [];

  const out: Suggestion[] = [];

  // ── 1. preview largest table ────────────────────────────────────────────
  const largest = pickLargestTable(tableNames, rowCounts);
  if (largest != null) {
    out.push(makePreviewSuggestion(largest, rowCounts[largest]));
  }

  // ── 2. distribution on enum-like column ─────────────────────────────────
  const distribution = findFirstColumn(
    tableNames,
    schemaColumns,
    rowCounts,
    isEnumLikeColumn
  );
  if (distribution != null) {
    out.push(
      makeDistributionSuggestion(distribution.table, distribution.column)
    );
  }

  // ── 3. aggregate on numeric column (skip PKs and FKs) ───────────────────
  // Skip primary keys: MIN/MAX/AVG of a surrogate id is noise.
  // Skip foreign keys for the same reason — a FK is just another id.
  const aggregate = findFirstColumn(
    tableNames,
    schemaColumns,
    rowCounts,
    (c) =>
      isNumericType(c.type) &&
      !c.isPrimaryKey &&
      normalizeForeignKey(c.foreignKey) == null
  );
  if (aggregate != null) {
    out.push(makeAggregateSuggestion(aggregate.table, aggregate.column));
  }

  // ── 4. join on a foreign key ────────────────────────────────────────────
  const join = findFirstForeignKey(tableNames, schemaColumns);
  if (join != null) {
    out.push(makeJoinSuggestion(join));
  }

  return out;
}
