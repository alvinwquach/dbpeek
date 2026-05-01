// ===== FILE PURPOSE =====
// Database error mapper — translates noisy, dialect-specific driver error
// messages into short, human-friendly strings suitable for the UI's error panel.
//
// WHY isolated here:
//   Error mapping is a lookup table of regex patterns with no dependencies on
//   the router, Knex, or any other module. Isolating it keeps the logic easy
//   to extend (add a new dialect or new error category) without touching the
//   execution pipeline.

// ===== ERROR MAPPING =====

/**
 * Maps a raw driver error to a short, human-friendly message.
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
export function mapDatabaseError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // ── Missing table ──────────────────────────────────────────────────────
  // Postgres: relation "users" does not exist
  let m = raw.match(/relation\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) return `Table not found: ${m[1]}`;

  // MySQL: Table 'mydb.users' doesn't exist
  m = raw.match(/Table\s+'([^']+)'\s+doesn'?t exist/i);
  if (m) return `Table not found: ${m[1]}`;

  // SQLite: no such table: users
  m = raw.match(/no such table:\s+(\S+)/i);
  if (m) return `Table not found: ${m[1]}`;

  // ── Missing column ─────────────────────────────────────────────────────
  // Postgres: column "name" does not exist
  m = raw.match(/column\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) return `Column not found: ${m[1]}`;

  // MySQL: Unknown column 'name' in 'field list'
  m = raw.match(/Unknown column\s+'([^']+)'/i);
  if (m) return `Column not found: ${m[1]}`;

  // SQLite: no such column: name
  m = raw.match(/no such column:\s+(\S+)/i);
  if (m) return `Column not found: ${m[1]}`;

  // ── SQL syntax error ───────────────────────────────────────────────────
  // Postgres: syntax error at or near "FORM"
  // MySQL:    You have an error in your SQL syntax; ... near 'FORM' at line 1
  m = raw.match(/syntax error\s+(?:at or near|near)\s+["']([^"']+)["']/i);
  if (m) return `SQL syntax error near: ${m[1]}`;

  if (/syntax error/i.test(raw) || /SQL syntax/i.test(raw)) {
    return `SQL syntax error: ${raw}`;
  }

  // ── Fallthrough: surface the raw message unchanged ─────────────────────
  return raw;
}
