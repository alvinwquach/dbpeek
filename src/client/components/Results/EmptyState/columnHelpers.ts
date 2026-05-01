/**
 * src/client/components/Results/EmptyState/columnHelpers.ts
 *
 * ===== FILE PURPOSE =====
 * Pure, dialect-aware classifiers and a foreign-key normalizer used by the
 * suggestion builder to decide which columns are good candidates for each
 * suggestion kind (preview, distribution, aggregate, join).
 *
 * Why split out from buildSuggestions:
 *   buildSuggestions is mostly orchestration ("which table, which column, in
 *   what order"). The "is this column numeric?", "is this enum-like?",
 *   "what's the real shape of foreignKey?" questions are independent and
 *   each warrants its own commented helper. Isolating them keeps the builder
 *   readable and the helpers individually testable.
 *
 * Everything in here is dialect-aware in the sense that it accepts the type
 * strings reported by any of the supported dialects (Postgres, MySQL, SQLite,
 * MSSQL). We classify on the LEADING type token only because dialects pad
 * type strings with sizes ("varchar(255)"), modifiers ("int unsigned"), and
 * timezone qualifiers ("timestamp with time zone").
 */

import type { ColumnInfo } from "../../../hooks/useSchema";

// ===== TYPES =====

/**
 * Local-only foreign-key shape — the server's actual runtime shape, regardless
 * of what the stale client useSchema.ts type currently says.
 *
 * The client type for ColumnInfo.foreignKey says `string | null`, but the
 * server (src/server/routes/schema/types.ts) actually returns
 * `{ table: string; column: string } | null`. SchemaTree.tsx already reads
 * the object form at runtime; we mirror that here without touching the
 * unrelated stale client type.
 */
export interface ForeignKeyTarget {
  table: string;
  column: string;
}

// ===== FOREIGN KEY NORMALIZER =====

/**
 * normalizeForeignKey — coerces ColumnInfo.foreignKey into the object form
 * callers expect, regardless of how the runtime value happens to look.
 *
 * Why a function rather than a one-line cast at every call site:
 *   The cast acknowledges a known-but-tolerated type drift between the client
 *   useSchema.ts and the server schema/types.ts. Hiding it behind a named
 *   helper makes the intent explicit AND gives us a single place to delete
 *   once the client type is corrected upstream.
 *
 * How it decides:
 *   1. null/undefined → no FK on this column → return null.
 *   2. Object with string `table` and `column` properties → trust it.
 *   3. (Defensive) "table.column" string form → split on the first dot.
 *      The server has never sent this, but a future regression would otherwise
 *      crash when callers reach for `.table` / `.column`.
 *   4. Anything else → null. Better to drop a single weird FK than to throw.
 */
export function normalizeForeignKey(
  raw: ColumnInfo["foreignKey"]
): ForeignKeyTarget | null {
  if (raw == null) return null;

  if (
    typeof raw === "object" &&
    "table" in raw &&
    "column" in raw &&
    typeof (raw as ForeignKeyTarget).table === "string" &&
    typeof (raw as ForeignKeyTarget).column === "string"
  ) {
    return raw as ForeignKeyTarget;
  }

  if (typeof raw === "string") {
    const dot = raw.indexOf(".");
    if (dot > 0 && dot < raw.length - 1) {
      return { table: raw.slice(0, dot), column: raw.slice(dot + 1) };
    }
  }

  return null;
}

// ===== TYPE-STRING HEAD =====

/**
 * typeHead — pulls the leading type token off a column's database type string,
 * lowercased.
 *
 * Why split on `[\s(]`:
 *   Dialects emit type strings like "varchar(255)", "int unsigned",
 *   "timestamp with time zone", "TIMESTAMP(6)". The first whitespace OR open-
 *   paren marks the end of the leading token, which is the part we classify on.
 *
 * Mirrors the technique used by SchemaTree.shortTypeBadge so we classify the
 * same way the sidebar labels things — consistency for users who see a "int"
 * badge in the sidebar then expect the empty state to recognize that column
 * as numeric.
 */
export function typeHead(type: string): string {
  return type.toLowerCase().trim().split(/[\s(]/)[0] ?? "";
}

// ===== NUMERIC CLASSIFIER =====

/**
 * isNumericType — true for the broad numeric family across all supported
 * dialects (Postgres, MySQL, SQLite, MSSQL).
 *
 * Why an explicit allow-list rather than `/^(int|float|num)/`:
 *   Regex prefix matching would drag in non-numeric oddities like "interval"
 *   (Postgres time interval) and "time" (matches "ti..."). The allow-list is
 *   short, safe, and self-documenting — adding a new dialect is one line.
 */
export function isNumericType(type: string): boolean {
  const head = typeHead(type);
  return (
    head === "int" ||
    head === "integer" ||
    head === "bigint" ||
    head === "smallint" ||
    head === "tinyint" ||
    head === "mediumint" ||
    head === "int2" ||
    head === "int4" ||
    head === "int8" ||
    head === "serial" ||
    head === "bigserial" ||
    head === "smallserial" ||
    head === "numeric" ||
    head === "decimal" ||
    head === "dec" ||
    head === "real" ||
    head === "double" ||
    head === "float" ||
    head === "float4" ||
    head === "float8" ||
    head === "money" ||
    head === "smallmoney"
  );
}

// ===== ENUM-LIKE CLASSIFIER =====

/**
 * isEnumLikeType — true for types that the database itself flags as having
 * a small fixed set of values: Postgres ENUMs, booleans across dialects,
 * SQL Server BIT.
 *
 * Why type-level signals are limited:
 *   In MySQL, "status VARCHAR(32)" is a perfectly normal categorical column,
 *   but its TYPE is just varchar. We catch that case via the name allow-list
 *   below — type-only classification would miss most enum-shaped data.
 */
export function isEnumLikeType(type: string): boolean {
  const head = typeHead(type);
  if (head === "enum") return true;
  if (head === "bool" || head === "boolean") return true;
  if (head === "bit") return true;
  return false;
}

/**
 * Curated set of column-name tokens that almost always indicate a small
 * categorical domain in business schemas, regardless of the underlying type
 * (e.g. `status VARCHAR(32)` in MySQL, `role TEXT` in Postgres).
 *
 * Why a Set over a regex:
 *   Tiny exact-match check. Lookup is O(1), additions are obvious in a diff,
 *   and the set is trivially testable.
 */
const ENUM_LIKE_NAMES = new Set([
  "status",
  "state",
  "type",
  "kind",
  "role",
  "category",
  "level",
  "tier",
  "stage",
  "phase",
  "priority",
  "severity",
  "visibility",
  "active",
  "enabled",
  "is_active",
  "is_enabled",
]);

/**
 * isEnumLikeColumn — true if the column is a good distribution candidate.
 *
 * A column qualifies when its TYPE looks categorical (enum/bool) OR its
 * NAME is in the curated allow-list. Either signal is enough — we'd rather
 * over-suggest distribution queries (worst case: a slightly boring result)
 * than under-suggest them (worst case: empty state has no #2 row).
 *
 * Why we filter out primary keys:
 *   A PK distribution is "every value once". The query runs, the user sees
 *   N rows of (id, 1) tuples, and they learn nothing about their data.
 */
export function isEnumLikeColumn(col: ColumnInfo): boolean {
  if (col.isPrimaryKey) return false;
  if (isEnumLikeType(col.type)) return true;
  if (ENUM_LIKE_NAMES.has(col.name.toLowerCase())) return true;
  return false;
}
