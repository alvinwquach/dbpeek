// permissions.ts — SQL statement validator (security boundary)
//
// dbpeek is a read-only exploration tool. It must never allow a browser-side
// user to run INSERT, UPDATE, DELETE, DROP, or any other mutating statement,
// even if the database credentials technically permit it.
//
// This module is the single place where that enforcement lives. Every SQL
// execution path in the server must call validateStatement() before running
// user-supplied SQL.
//
// Threat model:
//   • The tool runs locally on the developer's machine.
//   • "Attacks" are mostly accidental: a user pastes a destructive query.
//   • We do NOT defend against a determined adversary who controls the input
//     and is trying to bypass the filter (use read-only DB credentials for that).
//   • We DO defend against the common case: running dbpeek against a production
//     database and accidentally executing a mutating query via the UI.

// These statement prefixes are unconditionally rejected.
// The list is conservative: when in doubt, block it.
const BLOCKED_PREFIXES = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "CREATE",
  "ALTER",
  "TRUNCATE",
  "REPLACE",  // MySQL-specific upsert
  "MERGE",    // SQL Server / PostgreSQL upsert
  "UPSERT",   // some dialects
  "GRANT",
  "REVOKE",
  "EXEC",     // SQL Server stored procedures
  "EXECUTE",
  "CALL",     // MySQL / PostgreSQL stored procedures
  "DO",       // PostgreSQL anonymous code block
] as const;

export class PermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionError";
  }
}

// validateStatement throws PermissionError if the SQL is not a read-only
// statement. It returns void on success so callers can write:
//   validateStatement(sql);
//   await db.raw(sql);
export function validateStatement(sql: string): void {
  // Normalise: strip leading whitespace and comments, then uppercase for matching.
  // We only inspect the first token (the statement type keyword), not the full
  // statement, to avoid false positives from table or column names that happen
  // to match a keyword.
  const trimmed = sql
    .replace(/^(\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)+/, "") // strip leading whitespace & comments
    .trimStart()
    .toUpperCase();

  // Extract just the first word.
  const firstToken = trimmed.split(/\s+/)[0] ?? "";

  if (BLOCKED_PREFIXES.includes(firstToken as (typeof BLOCKED_PREFIXES)[number])) {
    throw new PermissionError(
      `Statement type "${firstToken}" is not allowed. dbpeek is a read-only tool.`
    );
  }

  // Empty statements are not useful and could indicate a parsing error upstream.
  if (firstToken === "") {
    throw new PermissionError("Empty SQL statement is not allowed.");
  }
}
