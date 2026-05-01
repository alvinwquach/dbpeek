// ===== FILE PURPOSE =====
// Result normalizer — converts the wildly different shapes that Knex returns
// per dialect into one uniform { columns, rows, rowCount } envelope.
//
// WHY isolated here:
//   Normalization is pure (no I/O, no side-effects) and has its own test surface.
//   Keeping it in a dedicated file lets us unit-test each dialect branch without
//   spinning up a real database or Express router.

// ===== EXPORTED TYPES =====

/**
 * The uniform result shape that every dialect is normalized into.
 *
 * WHY rows-as-arrays instead of rows-as-objects:
 *   1. Order preservation — `SELECT id, name` must render `id` first; arrays
 *      make column order explicit and can't be silently re-keyed by a serializer.
 *   2. Duplicate column names — `SELECT u.id, o.id FROM users u JOIN orders o`
 *      yields two columns both named `id`. An object collapses them; an array
 *      preserves both, with the `columns` array carrying the (duplicated) names.
 */
export interface NormalizedResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

// ===== INTERNAL HELPERS =====

/**
 * Type-narrowing helper: checks that a value is a non-null object.
 *
 * WHY a helper rather than inlining `typeof x === "object" && x !== null`:
 *   The two-part check must be repeated at every property access where we want
 *   TypeScript to narrow `unknown` to `object`. A function with a `: x is object`
 *   predicate gives us the same narrowing in one readable call.
 */
function isObject(x: unknown): x is object {
  return typeof x === "object" && x !== null;
}

// ===== NORMALIZATION =====

/**
 * Converts a knex.raw() result into the uniform { columns, rows, rowCount }
 * shape regardless of which driver produced it.
 *
 * KNOWN DRIVER SHAPES (verified against the four supported dialects):
 *
 *   Postgres (pg, via knex.raw):
 *     {
 *       command:  "SELECT",
 *       rowCount: 3,
 *       rows:     [{ id: 1, name: "Alice" }, ...],
 *       fields:   [{ name: "id", ... }, { name: "name", ... }]
 *     }
 *
 *   MySQL (mysql2, via knex.raw):
 *     [
 *       [{ id: 1, name: "Alice" }, ...],   // rows
 *       [{ name: "id", ... }, ...]         // fields
 *     ]
 *
 *   SQLite (better-sqlite3, via knex.raw):
 *     [{ id: 1, name: "Alice" }, ...]      // plain array of row objects
 *
 *   SQL Server (tedious, via knex.raw):
 *     [{ id: 1, name: "Alice" }, ...]      // plain array of row objects
 *
 *   No-rows commands (e.g. INSERT in --write mode) may return undefined,
 *   an empty array, or a driver-specific object with rowCount but no rows.
 *
 * STRATEGY:
 *   Probe from most-specific to least-specific so a more generic check does
 *   not accidentally swallow a structured driver response.
 *
 *   1. pg: has both `.rows` (array) AND `.fields` (array of {name}).
 *   2. mysql2: a 2-tuple [rows, fields] where fields[0].name is a string.
 *   3. plain array of row objects (sqlite, mssql).
 *   4. anything else (a non-rows command): return an empty result envelope.
 */
export function normalizeResult(result: unknown): NormalizedResult {
  // ── 1. Postgres shape: { rows: [...], fields: [...] } ─────────────────────
  // We check this first because pg's `.rows` could otherwise look like the
  // generic-array case if we only inspected one property.
  if (
    isObject(result) &&
    Array.isArray((result as { rows?: unknown }).rows) &&
    Array.isArray((result as { fields?: unknown }).fields)
  ) {
    const pgResult = result as {
      rows: Record<string, unknown>[];
      fields: { name: string }[];
      rowCount?: number;
    };
    const columns = pgResult.fields.map((f) => f.name);
    const rows = pgResult.rows.map((row) => columns.map((col) => row[col]));
    return {
      columns,
      rows,
      // Prefer pg's reported rowCount because it is authoritative for non-SELECT
      // operations (e.g. INSERT returning the affected count). Fall back to
      // rows.length when not provided.
      rowCount: pgResult.rowCount ?? rows.length,
    };
  }

  // ── 2. mysql2 shape: [rows, fields] tuple ─────────────────────────────────
  // We require BOTH that the second element is an array AND that its first
  // element looks like a field descriptor (has a string `name`). Without the
  // field-descriptor check, a plain array-of-arrays returned by some custom
  // raw query could be falsely classified as mysql2 output.
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    Array.isArray(result[1]) &&
    isObject(result[1][0]) &&
    typeof (result[1][0] as { name?: unknown }).name === "string"
  ) {
    const [rowObjects, fields] = result as [
      Record<string, unknown>[],
      { name: string }[],
    ];
    const columns = fields.map((f) => f.name);
    const rows = rowObjects.map((row) => columns.map((col) => row[col]));
    return { columns, rows, rowCount: rows.length };
  }

  // ── 3. Plain array of row objects (sqlite, mssql) ─────────────────────────
  // Column names come from the keys of the first row. This means a query that
  // returns zero rows yields an empty `columns` array, which is correct: with
  // no rows we genuinely do not know which columns the SELECT projected.
  if (Array.isArray(result)) {
    if (result.length === 0) {
      return { columns: [], rows: [], rowCount: 0 };
    }
    if (isObject(result[0])) {
      const columns = Object.keys(result[0] as Record<string, unknown>);
      const rows = (result as Record<string, unknown>[]).map((row) =>
        columns.map((col) => row[col])
      );
      return { columns, rows, rowCount: rows.length };
    }
  }

  // ── 4. Fallback for non-rows commands or unknown shapes ───────────────────
  // INSERT/UPDATE/DELETE on some drivers returns a status object with no rows.
  // We surface an empty envelope rather than an error — the operation succeeded
  // (no exception was thrown), it just had no tabular result to display.
  return { columns: [], rows: [], rowCount: 0 };
}
