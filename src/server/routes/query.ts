// ===== FILE PURPOSE =====
// POST /api/query — the single endpoint that executes user-supplied SQL.
//
// This is the busiest data path in the application. The browser sends a SQL
// string; this route validates it against the active permission mode, runs it
// through Knex, normalizes the dialect-specific result shape into a uniform
// envelope, and returns it (or a structured error) to the client.
//
// ===== REQUEST / RESPONSE CONTRACT =====
//
//   Request:
//     POST /api/query
//     Content-Type: application/json
//     Body: { "sql": string }
//
//   Success (200):
//     {
//       "columns":       string[],   // ordered column names
//       "rows":          any[][],    // rows as arrays in column order
//       "rowCount":      number,     // number of rows returned
//       "executionTime": number      // milliseconds (driver round-trip)
//     }
//
//   Permission denied (403):
//     { "error": "DELETE not allowed in read-only mode. Start with --write to enable." }
//
//   Bad request (400):
//     { "error": "Request body must contain a non-empty \"sql\" string." }
//     { "error": "Table not found: users" }
//     { "error": "SQL syntax error near: FORM" }
//
// ===== WHY rows-as-arrays INSTEAD OF rows-as-objects =====
//
//   Two reasons the response uses `rows: any[][]` (arrays) rather than
//   `rows: Record<string, any>[]` (objects keyed by column name):
//
//   1. Order preservation. When the user writes `SELECT id, name FROM users`,
//      they expect `id` first and `name` second in the rendered table. JSON
//      objects technically preserve insertion order in modern engines, but
//      relying on that for a UI contract is fragile — a future serializer or
//      proxy might re-key. Arrays make column order explicit.
//
//   2. Duplicate column names. `SELECT u.id, o.id FROM users u JOIN orders o`
//      yields two columns both named `id`. An object representation collapses
//      them into one (the second overwrites the first). An array preserves
//      both values; the `columns` array carries the (duplicated) names.
//
// ===== WHY a Router instead of app.get/app.post =====
//
//   A Router is mounted at `/api/query` in routes/index.ts. Mounting at a
//   subpath lets us add sub-routes later (e.g. POST /api/query/explain) without
//   touching the registration code. It also encapsulates the closure over `db`
//   and `mode` — the route handlers capture them at registration time, so
//   tests can pass mock instances without any module-level state.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../db.js";
import type { PermissionMode } from "../../types/connection.js";
import { validateQuery } from "../permissions.js";

// ===== RESULT NORMALIZATION =====

/**
 * Knex returns wildly different shapes depending on the underlying dialect.
 * This is the contract every dialect goes through before reaching the client.
 *
 * WHY a uniform shape:
 *   The React UI is one component — it cannot branch on dialect to know
 *   whether to read `result.rows` (pg) or `result[0]` (mysql2). Normalizing
 *   server-side keeps the client dialect-agnostic and lets us swap drivers
 *   in the future without touching the UI.
 */
interface NormalizedResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
}

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
 *       oid:      null,
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
 *   Probe the result shape from most-specific to least-specific so a more
 *   generic check does not swallow a structured driver response.
 *
 *   1. pg: has both `.rows` (array) AND `.fields` (array of {name}).
 *   2. mysql2: a 2-tuple [rows, fields] where fields[0].name is a string.
 *   3. plain array of row objects (sqlite, mssql).
 *   4. anything else (a non-rows command): return an empty result envelope.
 */
function normalizeResult(result: unknown): NormalizedResult {
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
  // (The drivers don't expose column metadata in this code path. If we ever
  // need empty-result schema, we'd have to switch to a prepared-statement
  // API per dialect — out of scope for this route.)
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

/**
 * Type-narrowing helper: checks that the value is a non-null object.
 *
 * WHY a helper rather than inlining `typeof x === "object" && x !== null`:
 *   The two-part check has to be repeated at every property access where we
 *   want TypeScript to narrow `unknown` to `object`. Wrapping it in a function
 *   with a `: x is object` predicate gives us the same narrowing in one
 *   readable call.
 */
function isObject(x: unknown): x is object {
  return typeof x === "object" && x !== null;
}

// ===== ERROR MAPPING =====

/**
 * Maps a raw driver error to a short, human-friendly message suitable for the
 * UI's error toast.
 *
 * WHY any mapping at all:
 *   Driver error messages are noisy and dialect-specific. A Postgres "table
 *   not found" reads `relation "users" does not exist`, while MySQL says
 *   `Table 'mydb.users' doesn't exist` and SQLite says `no such table: users`.
 *   The UI shouldn't have to recognize all three. We translate them into
 *   consistent phrases — "Table not found: users" — across dialects.
 *
 * WHY only a handful of cases are mapped, with a fallthrough for the rest:
 *   The three common categories (missing table, missing column, syntax error)
 *   account for the vast majority of user errors. Mapping every conceivable
 *   driver error would be a maintenance burden and would mask details that
 *   power users WANT to see. The fallthrough returns the original message
 *   verbatim, so unmapped errors still reach the user — just less prettily.
 *
 * WHY return a string rather than throwing a typed error:
 *   The route handler is the only caller, and it always converts the result
 *   into a 400 response body. A thrown error would force a try/catch around
 *   one line of code with no benefit.
 */
function mapDatabaseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // ── Missing table ──────────────────────────────────────────────────────
  // Postgres: relation "users" does not exist
  let m = raw.match(/relation\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) {
    return `Table not found: ${m[1]}`;
  }
  // MySQL: Table 'mydb.users' doesn't exist
  m = raw.match(/Table\s+'([^']+)'\s+doesn'?t exist/i);
  if (m) {
    return `Table not found: ${m[1]}`;
  }
  // SQLite: no such table: users
  m = raw.match(/no such table:\s+(\S+)/i);
  if (m) {
    return `Table not found: ${m[1]}`;
  }

  // ── Missing column ─────────────────────────────────────────────────────
  // Postgres: column "name" does not exist
  m = raw.match(/column\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) {
    return `Column not found: ${m[1]}`;
  }
  // MySQL: Unknown column 'name' in 'field list'
  m = raw.match(/Unknown column\s+'([^']+)'/i);
  if (m) {
    return `Column not found: ${m[1]}`;
  }
  // SQLite: no such column: name
  m = raw.match(/no such column:\s+(\S+)/i);
  if (m) {
    return `Column not found: ${m[1]}`;
  }

  // ── SQL syntax error ───────────────────────────────────────────────────
  // Postgres: syntax error at or near "FORM"
  // MySQL:    You have an error in your SQL syntax; ... near 'FORM' at line 1
  m = raw.match(/syntax error\s+(?:at or near|near)\s+["']([^"']+)["']/i);
  if (m) {
    return `SQL syntax error near: ${m[1]}`;
  }
  if (/syntax error/i.test(raw) || /SQL syntax/i.test(raw)) {
    return `SQL syntax error: ${raw}`;
  }

  // ── Fallthrough: surface the raw message unchanged. ────────────────────
  return raw;
}

// ===== ROUTE FACTORY =====

/**
 * Builds the Express Router that serves POST /api/query.
 *
 * WHY a factory function rather than a module-level Router:
 *   The router needs access to `db` and `mode`, which are determined at CLI
 *   startup, not at module-import time. A factory accepts both as parameters
 *   and captures them in a closure — meaning the same module can be loaded
 *   in tests (with a mock Knex and a different mode) and in production (with
 *   the real Knex and the user-selected mode) without any module-level state.
 *
 * @param db   - The Knex instance to execute the SQL through. The router
 *               does not own the lifecycle of this instance — the CLI creates
 *               and destroys it. The router only borrows it for the duration
 *               of each request.
 * @param mode - The permission mode set at CLI launch. Captured here so each
 *               request validates against the SAME mode the user explicitly
 *               opted into. Critically, this value is NEVER read from the
 *               request — there is no API to escalate it.
 */
export function createQueryRouter(db: Knex, mode: PermissionMode): Router {
  const router = Router();

  router.post("/", async (req: Request, res: Response) => {
    // ── Step 1: shape-check the request body ───────────────────────────────
    // We accept exactly { sql: string }. Anything else is a 400 — we do not
    // try to coerce numbers to strings or to look at alternative field names.
    // Strict input validation here means downstream code never has to handle
    // `undefined` or non-string SQL.
    const body = req.body as { sql?: unknown } | undefined;
    const sql = body?.sql;

    if (typeof sql !== "string" || sql.trim() === "") {
      return res.status(400).json({
        error: 'Request body must contain a non-empty "sql" string.',
      });
    }

    // ── Step 2: enforce the permission mode ────────────────────────────────
    // The validateQuery() return is a discriminated union, so TypeScript
    // narrows `validation.reason` to a string only inside the `!allowed`
    // branch. This is the security boundary — DO NOT add a bypass here.
    const validation = validateQuery(sql, mode);
    if (!validation.allowed) {
      return res.status(403).json({ error: validation.reason });
    }

    // ── Step 3: execute and time the query ─────────────────────────────────
    // process.hrtime.bigint() returns nanoseconds as a BigInt. We measure
    // around the awaited db.raw() call so the elapsed value reflects the
    // round-trip to the database, not the full request lifecycle (which
    // would include JSON parsing, validation, and serialization). Using
    // hrtime over Date.now() avoids wall-clock skew from NTP corrections —
    // a one-millisecond NTP step during a long query would otherwise show
    // up as a negative or jumpy duration.
    const start = process.hrtime.bigint();

    try {
      const rawResult = await db.raw(sql);
      const end = process.hrtime.bigint();

      // BigInt → number conversion: nanoseconds / 1e6 = milliseconds.
      // For queries shorter than 9_007_199 seconds (~104 days) the result
      // fits in Number.MAX_SAFE_INTEGER, so the conversion is lossless for
      // any realistic query. We choose milliseconds (a float, with sub-ms
      // resolution) over integer microseconds because the UI displays
      // "12.3 ms" — a human-readable unit.
      const executionTime = Number(end - start) / 1_000_000;

      const { columns, rows, rowCount } = normalizeResult(rawResult);

      return res.status(200).json({ columns, rows, rowCount, executionTime });
    } catch (err: unknown) {
      // Any error reaching this catch is a database-level failure (the
      // permission check already passed, and the body shape was validated).
      // We map it to a 400 because the typical cause is a user-authored
      // query mistake (typo, missing table, etc.) — NOT a server bug. A 500
      // would be misleading and would trip alarms in any deployment that
      // monitors 5xx rates.
      return res.status(400).json({ error: mapDatabaseError(err) });
    }
  });

  return router;
}
