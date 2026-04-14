/**
 * src/server/routes/query.ts
 *
 * POST /api/query — execute ad-hoc SQL and return the results as JSON.
 *
 * ─── Responsibility ───────────────────────────────────────────────────────────
 * This route is the core of dbpeek: it takes raw SQL from the browser, checks
 * whether it is allowed under the current permission mode, executes it against
 * the connected database via Knex, and returns a structured JSON result that
 * the frontend can display in a table.
 *
 * ─── Request ─────────────────────────────────────────────────────────────────
 *   POST /api/query
 *   Content-Type: application/json
 *   { "sql": "SELECT * FROM users LIMIT 10" }
 *
 * ─── Response (success) ──────────────────────────────────────────────────────
 *   HTTP 200
 *   {
 *     "columns":       ["id", "name", "email"],   // column names in order
 *     "rows":          [{ "id": 1, "name": "…" }], // one object per row
 *     "rowCount":      1,                          // number of rows returned
 *     "executionTime": 3.14                        // wall-clock ms for the query
 *   }
 *
 * ─── Response (permission denied) ────────────────────────────────────────────
 *   HTTP 403
 *   { "error": "INSERT is not allowed in read-only mode. …" }
 *
 * ─── Response (database error) ───────────────────────────────────────────────
 *   HTTP 400
 *   { "error": "Table does not exist.", "code": "ER_NO_SUCH_TABLE" }
 *
 * ─── Response (invalid request) ──────────────────────────────────────────────
 *   HTTP 400
 *   { "error": "The 'sql' field is required and must be a non-empty string." }
 *
 * ─── Pseudocode ──────────────────────────────────────────────────────────────
 *   POST /:
 *     1. Validate that req.body.sql is a non-empty string → 400 if not.
 *     2. Read knex and mode from req.app.locals.
 *     3. Call validateQuery(sql, mode) → 403 if denied.
 *     4. Record start time with process.hrtime.bigint().
 *     5. Execute knex.raw(sql).
 *     6. Compute elapsed time in milliseconds.
 *     7. Normalise the raw result into { columns, rows }.
 *     8. Return { columns, rows, rowCount, executionTime }.
 *     On database error:
 *     9. Map the error code to a human message.
 *    10. Return 400 with { error, code, executionTime }.
 *
 * ─── Why process.hrtime.bigint()? ────────────────────────────────────────────
 * Date.now() returns milliseconds and has ~1 ms resolution — fine for humans
 * but noisy for queries that complete in <1 ms.  process.hrtime.bigint()
 * returns nanoseconds as a BigInt, giving sub-microsecond resolution.
 * We convert to ms at the end: Number(ns) / 1_000_000.
 *
 * ─── Why knex.raw()? ─────────────────────────────────────────────────────────
 * Knex's query builder (knex('table').select('*')) only works when you know
 * the table name at compile time. For an ad-hoc SQL editor, the user types
 * any SQL they like, so we pass it directly to the database driver via
 * knex.raw() which returns whatever the driver returns.
 *
 * ─── Result normalisation ────────────────────────────────────────────────────
 * Different database drivers return results in different shapes:
 *
 *   PostgreSQL (pg):
 *     { rows: [{col: val}], fields: [{name: 'col', ...}], rowCount: N }
 *
 *   MySQL (mysql2):
 *     [[{col: val}], [FieldPacket{name: 'col'}]]   ← tuple of two arrays
 *
 *   SQLite (better-sqlite3):
 *     [{col: val}, ...]                             ← flat array of row objects
 *     { changes: N, lastInsertRowid: id }           ← for non-SELECT statements
 *
 * normalizeResult() detects which shape it received and converts everything
 * to the uniform { columns: string[], rows: Record<string, unknown>[] } format.
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────
 *   default — Express Router with POST / registered
 */

import { Router } from 'express';
import type { Knex } from '../db.js';
import type { PermissionMode } from '../index.js';
import { validateQuery } from '../permissions.js';

// Create a mini-app that holds just the query-related routes.
// In routes/index.ts this router is mounted at '/query', making the full path
// POST /api/query when the API router is mounted at '/api' in server/index.ts.
const router = Router();

// ── Result normalisation ──────────────────────────────────────────────────────

/**
 * normalizeResult
 *
 * Converts the raw value returned by knex.raw() into a uniform shape.
 *
 * Pseudocode:
 *   if result is null or undefined → { columns: [], rows: [] }
 *   if result is a plain object with a 'rows' array → PostgreSQL format
 *     extract columns from 'fields' array (preferred) or object keys (fallback)
 *   if result is an array whose first two elements are both arrays → MySQL format
 *     first element is rows, second element is field descriptors
 *   if result is a flat array → SQLite SELECT format
 *     derive column names from the keys of the first row object
 *   otherwise (e.g. SQLite RunResult for INSERT/CREATE) → { columns: [], rows: [] }
 *
 * @param rawResult - the value knex.raw() resolved to
 * @returns           normalised { columns, rows }
 */
function normalizeResult(rawResult: unknown): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  // null / undefined — query returned nothing (e.g. some DDL in certain drivers).
  if (rawResult === null || rawResult === undefined) {
    return { columns: [], rows: [] };
  }

  // ── PostgreSQL shape: object with a 'rows' array ────────────────────────────
  // The pg driver returns a QueryResult object.  Knex wraps and passes it
  // through mostly intact.  We read columns from `fields` (which preserves the
  // SELECT order) and fall back to object keys if fields are missing.
  if (!Array.isArray(rawResult) && typeof rawResult === 'object') {
    const obj = rawResult as Record<string, unknown>;

    if ('rows' in obj && Array.isArray(obj['rows'])) {
      const rows = obj['rows'] as Record<string, unknown>[];
      let columns: string[] = [];

      if ('fields' in obj && Array.isArray(obj['fields'])) {
        // `fields` is an array of FieldInfo objects, each with a `.name` string.
        columns = (obj['fields'] as Array<{ name: string }>).map((f) => f.name);
      } else if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
        columns = Object.keys(rows[0]);
      }

      return { columns, rows };
    }

    // Object without a 'rows' property — likely a SQLite RunResult
    // ({ changes: N, lastInsertRowid: id }) from an INSERT/UPDATE/DELETE/DDL.
    // There is no tabular result to return.
    return { columns: [], rows: [] };
  }

  // ── MySQL shape: [[rows...], [fields...]] ───────────────────────────────────
  // mysql2 returns a two-element tuple: the first element is the rows array,
  // the second is an array of FieldPacket objects each with a `.name`.
  // We detect this by checking that both elements of the outer array are arrays.
  if (
    Array.isArray(rawResult) &&
    rawResult.length >= 2 &&
    Array.isArray(rawResult[0]) &&
    Array.isArray(rawResult[1])
  ) {
    const rows = rawResult[0] as Record<string, unknown>[];
    const fields = rawResult[1] as Array<{ name: string }>;
    const columns = fields.map((f) => f.name);
    return { columns, rows };
  }

  // ── SQLite shape: flat array of row objects ─────────────────────────────────
  // better-sqlite3 returns SELECT results as a plain array where each element
  // is a plain object keyed by column name.  We derive the column list from
  // the keys of the first row (or [] if the result set is empty).
  if (Array.isArray(rawResult)) {
    const rows = rawResult as Record<string, unknown>[];
    const columns =
      rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null
        ? Object.keys(rows[0])
        : [];
    return { columns, rows };
  }

  // Fallback: unknown shape — return empty to avoid crashing.
  return { columns: [], rows: [] };
}

// ── Error mapping ─────────────────────────────────────────────────────────────

/**
 * mapDbError
 *
 * Converts a raw database driver error into a human-readable message.
 *
 * Why does this exist?
 *   Raw driver errors are terse and technical:
 *     "SQLITE_ERROR: no such table: users"
 *     Error { code: '42P01', … }
 *   A junior developer or a non-DBA reading the UI deserves plain English.
 *   We keep the original error code so advanced users can look it up.
 *
 * Pseudocode:
 *   Extract the `code` property from the error object.
 *   Check against known PostgreSQL error codes (numeric strings like '42P01').
 *   Check against known MySQL error codes (strings like 'ER_NO_SUCH_TABLE').
 *   Check against SQLite error codes ('SQLITE_*').
 *   Fall back to the raw error message if nothing matched.
 *
 * @param error - the value caught in a try/catch around knex.raw()
 * @returns       { message: string, code?: string }
 */
function mapDbError(error: unknown): { message: string; code?: string } {
  if (!error || typeof error !== 'object') {
    return { message: 'An unknown database error occurred.' };
  }

  const err = error as Record<string, unknown>;
  const code = typeof err['code'] === 'string' ? err['code'] : undefined;
  const rawMessage = typeof err['message'] === 'string' ? err['message'] : 'Database error.';

  // ── PostgreSQL error codes ────────────────────────────────────────────────
  // PostgreSQL uses 5-character SQLSTATE codes.  A full list is available at:
  // https://www.postgresql.org/docs/current/errcodes-appendix.html
  const PG_MESSAGES: Record<string, string> = {
    '42601': 'SQL syntax error.',
    '42P01': 'Relation (table or view) does not exist.',
    '42703': 'Column does not exist.',
    '23505': 'Unique constraint violation: a record with this value already exists.',
    '23503': 'Foreign key constraint violation.',
    '23502': 'Not-null constraint violation: a required column is missing a value.',
    '28000': 'Authentication failed: invalid authorization specification.',
    '28P01': 'Authentication failed: incorrect password.',
    '3D000': 'Database does not exist.',
    '53300': 'Too many connections to the database server.',
    '08006': 'Connection to the database server failed.',
    '08001': 'Connection refused — is the database server running?',
  };

  if (code && PG_MESSAGES[code]) {
    return { message: PG_MESSAGES[code], code };
  }

  // ── MySQL / MariaDB error codes ───────────────────────────────────────────
  // mysql2 uses string error codes (e.g. 'ER_NO_SUCH_TABLE').
  const MYSQL_MESSAGES: Record<string, string> = {
    ER_PARSE_ERROR: 'SQL syntax error.',
    ER_SYNTAX_ERROR: 'SQL syntax error.',
    ER_NO_SUCH_TABLE: 'Table does not exist.',
    ER_BAD_FIELD_ERROR: 'Unknown column name.',
    ER_DUP_ENTRY: 'Duplicate entry: a record with this value already exists.',
    ER_ACCESS_DENIED_ERROR: 'Access denied: incorrect username or password.',
    ER_DBACCESS_DENIED_ERROR: 'Access denied to this database.',
    ER_TABLE_EXISTS_ERROR: 'Table already exists.',
    ER_NO_REFERENCED_ROW_2: 'Foreign key constraint failed: referenced row does not exist.',
    ER_ROW_IS_REFERENCED_2: 'Foreign key constraint failed: row is referenced by another table.',
  };

  if (code && MYSQL_MESSAGES[code]) {
    return { message: MYSQL_MESSAGES[code], code };
  }

  // ── SQLite error codes ────────────────────────────────────────────────────
  // better-sqlite3 uses 'SQLITE_*' codes.
  if (code === 'SQLITE_ERROR') {
    // The raw SQLite message is usually descriptive enough ("no such table: x"),
    // so we include it rather than hiding it behind a vague generic.
    return { message: rawMessage, code };
  }
  if (code === 'SQLITE_CONSTRAINT' || code?.startsWith('SQLITE_CONSTRAINT')) {
    return { message: 'Constraint violation (unique, not-null, or foreign key).', code };
  }

  // ── MSSQL / tedious error numbers ────────────────────────────────────────
  // tedious surfaces errors as { number: N, message: '…' }.
  const mssqlNumber = typeof err['number'] === 'number' ? (err['number'] as number) : undefined;
  if (mssqlNumber !== undefined) {
    const MSSQL_MESSAGES: Record<number, string> = {
      207: 'Invalid column name.',
      208: 'Invalid object name — table does not exist.',
      2627: 'Unique constraint violation: duplicate key.',
      2601: 'Unique constraint violation: cannot insert duplicate key.',
      547: 'Constraint conflict (foreign key or check constraint).',
    };
    if (MSSQL_MESSAGES[mssqlNumber]) {
      return { message: MSSQL_MESSAGES[mssqlNumber], code: String(mssqlNumber) };
    }
  }

  // ── Generic fallback ──────────────────────────────────────────────────────
  // Nothing matched — return the raw message so at least something useful shows.
  return { message: rawMessage, ...(code ? { code } : {}) };
}

// ── Route handler ─────────────────────────────────────────────────────────────

/**
 * POST /
 * (mounted as POST /api/query via routes/index.ts and server/index.ts)
 *
 * Validates, executes, and returns the result of an ad-hoc SQL query.
 */
router.post('/', async (req, res) => {
  // ── Step 1: validate the request body ──────────────────────────────────────
  // req.body is populated by express.json() in server/index.ts.
  // We expect { sql: string }.  Anything else is a client error.
  const { sql } = req.body as { sql?: unknown };

  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    res.status(400).json({
      error: "The 'sql' field is required and must be a non-empty string.",
    });
    return;
  }

  // ── Step 2: retrieve the knex instance and permission mode ────────────────
  // These were stored on app.locals by createServer() in server/index.ts.
  // Using app.locals avoids circular imports between route files and the
  // server factory — the route file never needs to import knex directly.
  const knex = req.app.locals['knex'] as Knex;
  const mode = req.app.locals['mode'] as PermissionMode;

  // ── Step 3: enforce permissions ────────────────────────────────────────────
  // validateQuery parses the SQL (stripping comments, splitting on semicolons)
  // and checks every statement against the current mode.
  const validation = validateQuery(sql, mode);
  if (!validation.allowed) {
    res.status(403).json({
      error: validation.reason ?? 'Query not allowed in the current permission mode.',
    });
    return;
  }

  // ── Steps 4–8: execute the query and measure elapsed time ─────────────────
  //
  // process.hrtime.bigint() returns a BigInt representing the current time in
  // nanoseconds. Because it's a monotonic clock (not wall-clock time), it is
  // immune to system clock adjustments — ideal for measuring durations.
  //
  // We capture the start time BEFORE the async call and the end time AFTER it
  // resolves (or rejects).  The difference is the total time spent waiting for
  // the database, including network round-trip for remote databases.
  const start = process.hrtime.bigint();

  try {
    // knex.raw(sql) sends the SQL string directly to the database driver.
    // For multi-statement SQL (e.g. "SELECT 1; SELECT 2"), behaviour depends
    // on the driver — some execute all statements, others only the first.
    const rawResult = await knex.raw(sql);

    // Compute elapsed time: subtract BigInt nanosecond timestamps and convert
    // to milliseconds (1 ms = 1,000,000 ns).  Number() is safe here because
    // typical query times fit comfortably in a 64-bit float.
    const executionTime = Number(process.hrtime.bigint() - start) / 1_000_000;

    // Normalise the driver-specific result into { columns, rows }.
    const { columns, rows } = normalizeResult(rawResult);

    // Return the structured response.
    res.json({
      columns,
      rows,
      rowCount: rows.length, // number of rows in the result set (0 for non-SELECT)
      executionTime,          // wall-clock ms including DB round-trip
    });
  } catch (error) {
    // Measure time even on failure — useful for diagnosing slow timeouts.
    const executionTime = Number(process.hrtime.bigint() - start) / 1_000_000;

    // Translate the raw driver error into something human-readable.
    const { message, code } = mapDbError(error);

    res.status(400).json({
      error: message,
      ...(code ? { code } : {}),
      executionTime,
    });
  }
});

export default router;
