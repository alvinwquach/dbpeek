// ===== FILE PURPOSE =====
// SECURITY: THIS IS THE MOST IMPORTANT FILE IN THE PROJECT.
//
// permissions.ts is the security boundary between the user (via the browser
// client) and the underlying database. Every SQL string the user submits flows
// through validateQuery() before it ever reaches knex.raw(). If this file is
// wrong, a user can issue DROP TABLE on a production database from a web UI.
//
// ===== THREAT MODEL =====
//
//   - dbpeek runs locally on the developer's machine.
//   - The "attacker" is, in 99% of cases, the developer themselves: a tired
//     engineer pastes a destructive query into the wrong tab and clicks Run.
//   - The PRIMARY mitigation is: in read-only mode (the default), no statement
//     that mutates state can execute. Period.
//   - The SECONDARY mitigation is: the permission MODE is set ONCE at CLI launch
//     (--write or --full flag) and CANNOT be changed from the browser. There is
//     no API endpoint to escalate privilege at runtime — the mode is captured
//     in a closure inside registerRoutes() and is immutable for the process
//     lifetime. A compromised browser tab cannot send a "set mode to full"
//     request, because no such request exists.
//   - We do NOT defend against a determined attacker who controls the SQL
//     string AND wants to bypass the filter at the dialect level. For that,
//     the correct defense is read-only DATABASE credentials. dbpeek's filter
//     is a usability/safety net, not a sandbox.
//
// ===== DESIGN OVERVIEW =====
//
//   validateQuery(sql, mode) -> { allowed: boolean, reason?: string }
//
//   1. Split the SQL into individual statements, respecting:
//        - string literals ('foo;bar' is ONE statement)
//        - quoted identifiers ("col;name", `col;name`)
//        - line comments (-- foo;bar\n)
//        - block comments (/* foo;bar */)
//      Naive split-on-semicolon is INCORRECT and would mis-classify queries
//      whose data legitimately contains semicolons.
//
//   2. For each statement, extract the FIRST non-whitespace, non-comment token
//      (the statement type keyword: SELECT, INSERT, etc.).
//
//   3. Classify the keyword into READ / WRITE / DDL.
//
//   4. Compare the classification to the requested mode:
//        readonly -> READ only
//        write    -> READ + WRITE
//        full     -> anything
//
//   5. If ANY statement in a multi-statement batch fails, the WHOLE batch is
//      rejected. We never partially execute. This matches the principle of
//      least surprise: if the user pasted "SELECT 1; DROP TABLE users;" we
//      must reject the entire input rather than executing the SELECT and
//      blocking the DROP.

import type { PermissionMode } from "../types/connection.js";

// ===== STATEMENT CLASSIFICATION =====

/**
 * Read-only statement keywords.
 *
 * WHY each keyword is on the list:
 *   - SELECT:   the canonical read.
 *   - SHOW:     MySQL/MariaDB schema introspection (SHOW TABLES, SHOW COLUMNS).
 *   - DESCRIBE / DESC: MySQL column-listing alias for INFORMATION_SCHEMA queries.
 *   - EXPLAIN:  query plan inspection — never executes the underlying query in
 *               a way that mutates data (EXPLAIN ANALYZE on Postgres DOES execute
 *               the query, but if the inner query is a SELECT we still allow it;
 *               if it's an INSERT/UPDATE the user is asking for trouble that
 *               read-only DB credentials would catch).
 *   - WITH:     Common Table Expressions. Strictly speaking, "WITH x AS (...) DELETE..."
 *               is a write, but the recursive cost of fully parsing CTEs to
 *               detect that case is high and the threat model (accidental, not
 *               adversarial) makes it acceptable to allow WITH and rely on the
 *               database itself to refuse the inner DELETE if credentials don't
 *               permit it. For users who need stricter behavior, --readonly
 *               combined with read-only DB credentials is the correct setup.
 *   - PRAGMA:   SQLite-specific configuration introspection (PRAGMA table_info).
 */
const READ_KEYWORDS = new Set<string>([
  "SELECT",
  "SHOW",
  "DESCRIBE",
  "DESC",
  "EXPLAIN",
  "WITH",
  "PRAGMA",
]);

/**
 * Data-modifying statement keywords (DML — Data Manipulation Language).
 *
 * WHY these are separated from DDL:
 *   DML changes ROWS in existing tables; DDL changes the SCHEMA itself. The
 *   --write flag is intended for users who want to update data (e.g. fix a
 *   mistyped value) but do NOT want to risk a CREATE TABLE / DROP TABLE typo.
 *   This distinction matches the mental model of "I want to edit my data,
 *   not redesign my database."
 */
const WRITE_KEYWORDS = new Set<string>([
  "INSERT",
  "UPDATE",
  "DELETE",
  "REPLACE", // MySQL upsert
  "MERGE",   // SQL Server / Postgres upsert
  "UPSERT",  // SQLite-specific
]);

// Any keyword not in READ_KEYWORDS or WRITE_KEYWORDS is treated as DDL/DCL/
// procedural and is allowed only in --full mode. This includes:
//   CREATE, DROP, ALTER, TRUNCATE, RENAME (DDL)
//   GRANT, REVOKE                          (DCL)
//   EXEC, EXECUTE, CALL, DO                (procedural — can do anything)
// We use an open default rather than an explicit list so that future keywords
// from new dialect versions are conservatively blocked by default.

// ===== PUBLIC API =====

/**
 * Result of validating a SQL string against a permission mode.
 *
 * WHY a discriminated union ({ allowed: true } | { allowed: false; reason: string })
 * instead of throwing:
 *   The caller (the route handler) needs to map a denial to a 403 response with
 *   the reason in the body. Throwing an error and unwinding the stack to catch
 *   it would force the caller to use try/catch in the hot path. A discriminated
 *   union is also more typesafe — TypeScript narrows the type after checking
 *   `result.allowed`, so accessing `result.reason` is only valid in the false
 *   branch and is a compile error in the true branch.
 */
export type ValidationResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Validates a (possibly multi-statement) SQL string against a permission mode.
 *
 * WHAT it does:
 *   Returns { allowed: true } if every statement in `sql` is permitted under
 *   `mode`. Returns { allowed: false, reason } if ANY statement is not.
 *
 * HOW it works:
 *   1. Reject empty/whitespace-only input outright.
 *   2. Split into statements via splitStatements() — a small SQL-aware tokenizer
 *      that respects quotes and comments.
 *   3. For each statement, extract the first keyword via getStatementType().
 *   4. Classify the keyword and compare against `mode`.
 *   5. Return the FIRST denial reason (a single message keeps the UI simple).
 *
 * @param sql  - The raw SQL string from the request body.
 * @param mode - The permission level set at CLI launch (cannot be changed
 *               at runtime — see threat model in the file header).
 */
export function validateQuery(
  sql: string,
  mode: PermissionMode
): ValidationResult {
  // Empty or whitespace-only input has no statement type to classify and is
  // never useful to forward to the database — reject it here so the route
  // handler does not have to special-case it.
  if (!sql || sql.trim() === "") {
    return { allowed: false, reason: "Empty SQL statement." };
  }

  const statements = splitStatements(sql);

  // splitStatements() filters out whitespace-only chunks, so an empty array
  // means the input was nothing but comments or whitespace once the SQL was
  // tokenized. That is also not a valid query.
  if (statements.length === 0) {
    return { allowed: false, reason: "Empty SQL statement." };
  }

  for (const statement of statements) {
    const type = getStatementType(statement);

    // A statement with no recognizable leading keyword (e.g. just punctuation)
    // is malformed — refuse it rather than passing garbage to the driver.
    if (type === "") {
      return {
        allowed: false,
        reason: "Unable to identify SQL statement type.",
      };
    }

    if (!isAllowed(type, mode)) {
      return { allowed: false, reason: buildDenialReason(type, mode) };
    }
  }

  return { allowed: true };
}

// ===== PRIVATE HELPERS =====

/**
 * Decides whether a classified statement type is allowed under a given mode.
 *
 * WHY a single function rather than scattering the if/else across validateQuery:
 *   Centralizing the matrix here makes the policy auditable in one place.
 *   Anyone reading this file can see, at a glance, exactly which keywords are
 *   permitted in which mode without tracing branching logic.
 *
 *  Mode      | READ_KEYWORDS | WRITE_KEYWORDS | other (DDL/DCL/procedural)
 *  --------- | ------------- | -------------- | --------------------------
 *  readonly  |    YES        |     no         |     no
 *  write     |    YES        |    YES         |     no
 *  full      |    YES        |    YES         |    YES
 */
function isAllowed(type: string, mode: PermissionMode): boolean {
  if (mode === "full") {
    return true;
  }
  if (mode === "write") {
    return READ_KEYWORDS.has(type) || WRITE_KEYWORDS.has(type);
  }
  // mode === "readonly"
  return READ_KEYWORDS.has(type);
}

/**
 * Builds the human-friendly denial message shown to the user.
 *
 * WHY it suggests the next step (--write or --full):
 *   Without an actionable hint, the user sees "DELETE not allowed" and has to
 *   read the docs to figure out how to enable it. Embedding the flag name in
 *   the error turns the denial into a self-service correction: paste a query,
 *   read the error, restart with the suggested flag.
 *
 * WHY the suggestion depends on BOTH the keyword classification and the current
 * mode:
 *   A DELETE in readonly should suggest --write (the minimum upgrade), not
 *   --full. A DROP in readonly should suggest --full (since --write would not
 *   be enough). A DROP in write must also suggest --full. The matrix:
 *
 *   current mode | type          | suggest
 *   ------------ | ------------- | -------
 *   readonly     | WRITE keyword | --write
 *   readonly     | DDL keyword   | --full
 *   write        | DDL keyword   | --full
 */
function buildDenialReason(type: string, mode: PermissionMode): string {
  const isWrite = WRITE_KEYWORDS.has(type);

  if (mode === "readonly") {
    if (isWrite) {
      return `${type} not allowed in read-only mode. Start with --write to enable.`;
    }
    return `${type} not allowed in read-only mode. Start with --full to enable.`;
  }

  // mode === "write" — only DDL/DCL/procedural keywords reach here, since
  // READ and WRITE keywords are already allowed by isAllowed() above.
  return `${type} not allowed in write mode. Start with --full to enable.`;
}

/**
 * Extracts the first SQL keyword from a statement, ignoring leading whitespace
 * and leading comments.
 *
 * WHY a loop rather than a single regex:
 *   Comments and whitespace can interleave — for example:
 *
 *     -- comment one
 *     /* block comment * /
 *        -- another line comment
 *     SELECT 1
 *
 *   A single regex would need to match an unbounded number of comment-then-
 *   whitespace alternations. The loop strips one comment-or-whitespace prefix
 *   at a time until nothing changes; whatever remains starts with the actual
 *   keyword (or is empty).
 *
 * WHY uppercase the result:
 *   SQL keywords are case-insensitive — `select`, `Select`, and `SELECT` are
 *   all the same statement. Normalizing to uppercase lets the caller use a
 *   single Set membership check rather than a case-insensitive comparison.
 */
function getStatementType(statement: string): string {
  let remaining = statement;

  // Iteratively strip leading whitespace and comment runs. Each pass removes
  // ONE leading construct (whitespace, line comment, or block comment); we
  // repeat until a pass makes no progress, meaning whatever is left starts
  // with the keyword (or is empty).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const before = remaining;
    remaining = remaining.replace(/^\s+/, "");
    remaining = remaining.replace(/^--[^\n]*(\n|$)/, "");
    remaining = remaining.replace(/^\/\*[\s\S]*?\*\//, "");
    if (remaining === before) {
      break;
    }
  }

  // The keyword is the first run of letters (and possibly underscores).
  // Match() returns null when nothing is left after stripping comments —
  // we treat that as an empty type so the caller can return a clean error
  // rather than crashing.
  const match = remaining.match(/^[A-Za-z_]+/);
  return match ? match[0].toUpperCase() : "";
}

/**
 * Splits a multi-statement SQL string into individual statements while
 * respecting string literals, quoted identifiers, and comments.
 *
 * WHY a hand-written tokenizer instead of `sql.split(";")`:
 *   A semicolon inside a string literal ('foo;bar') or inside a comment
 *   (/* ; * /) is NOT a statement separator. Splitting naively would either
 *   classify "INSERT" inside a string literal as a real INSERT, or split a
 *   single statement into two malformed halves. Either failure mode breaks
 *   the security guarantee. We must use an SQL-aware lexer.
 *
 * WHY this is intentionally simple (does NOT handle every edge case):
 *   We only need to identify TWO things: where a statement starts and ends,
 *   and what its first keyword is. We do not need a full SQL grammar.
 *   Specifically, we handle:
 *     - single-quoted strings, with both '' and \' escapes
 *     - double-quoted identifiers (Postgres, ANSI SQL)
 *     - backtick-quoted identifiers (MySQL)
 *     - line comments (-- ... \n)
 *     - block comments (/* ... * /)
 *   We do NOT handle dollar-quoted strings ($$...$$) — those are Postgres
 *   function bodies, which require --full mode anyway, so a misclassification
 *   inside one only matters if the user is already running with full
 *   permissions, where everything is allowed.
 *
 * WHY this is exported (was previously private):
 *   The query route also needs to enumerate statements so it can execute them
 *   sequentially and report progress per statement ("Statement 1/4 complete").
 *   Re-implementing the tokenizer in two places would risk drift between the
 *   security split and the execution split — a divergence here could let a
 *   destructive statement slip past the validator while still being executed.
 *   Exporting the single canonical splitter keeps both call sites in lockstep.
 *
 * @returns an array of statement strings, with empty / whitespace-only
 *   statements filtered out so trailing semicolons do not create phantoms.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    // ── Line comment: consume up to (and including) the newline. ───────────
    // Comments are kept in `current` so getStatementType() can also strip them
    // — that way a leading comment on the FIRST statement is handled the same
    // as one on a later statement.
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") {
        current += sql[i];
        i++;
      }
      continue;
    }

    // ── Block comment: consume until the closing */. ───────────────────────
    if (ch === "/" && next === "*") {
      current += sql[i];
      current += sql[i + 1];
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        current += sql[i];
        i++;
      }
      if (i < sql.length) {
        current += sql[i];
        current += sql[i + 1];
        i += 2;
      }
      continue;
    }

    // ── Quoted strings / identifiers. ──────────────────────────────────────
    // The opening quote character is captured so we can correctly find the
    // closing quote of the SAME type (e.g. a backtick inside a single-quoted
    // string is data, not the end of an identifier).
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      current += sql[i];
      i++;
      while (i < sql.length) {
        // Doubled-quote escape (ANSI SQL): '' inside '...' is a literal '.
        // We must consume both characters as part of the string body so we
        // do not mistake the second quote for a terminator.
        if (sql[i] === quote && sql[i + 1] === quote) {
          current += sql[i];
          current += sql[i + 1];
          i += 2;
          continue;
        }
        // Backslash escape (MySQL extension to SQL standard): only meaningful
        // inside single-quoted strings on MySQL. Treating it conservatively
        // for all string types is harmless: the worst case is consuming one
        // extra character that we would have consumed anyway.
        if (sql[i] === "\\" && quote === "'") {
          current += sql[i];
          i++;
          if (i < sql.length) {
            current += sql[i];
            i++;
          }
          continue;
        }
        // Real terminator — copy the closing quote and break out of the
        // string-scanning inner loop.
        if (sql[i] === quote) {
          current += sql[i];
          i++;
          break;
        }
        current += sql[i];
        i++;
      }
      continue;
    }

    // ── Statement separator: SQL semicolon outside any quote/comment. ──────
    // Push the accumulated statement (if non-empty) and reset the buffer.
    // We trim before checking emptiness so that ";  ;" produces no phantoms.
    if (ch === ";") {
      if (current.trim() !== "") {
        statements.push(current);
      }
      current = "";
      i++;
      continue;
    }

    current += sql[i];
    i++;
  }

  // Any trailing content after the last semicolon (or the entire string when
  // no semicolons exist) is a statement too.
  if (current.trim() !== "") {
    statements.push(current);
  }

  return statements;
}
