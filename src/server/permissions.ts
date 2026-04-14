/**
 * src/server/permissions.ts
 *
 * SQL permission enforcement — the gatekeeper that decides whether a query
 * is allowed to run given the current permission mode.
 *
 * ─── Why do we need this? ─────────────────────────────────────────────────────
 * dbpeek connects directly to your local database. Without permission checks,
 * any browser tab that reaches the server could run DROP TABLE or DELETE FROM
 * on your data. By inspecting the first keyword of every SQL statement before
 * it ever reaches the database, we enforce the level of access the user opted
 * into when they started dbpeek.
 *
 * ─── Permission modes ────────────────────────────────────────────────────────
 *   'read-only'  (default) — SELECT, SHOW, DESCRIBE, EXPLAIN, read-only WITH
 *   'write'                — also INSERT, UPDATE, DELETE
 *   'full'                 — everything: CREATE, DROP, ALTER, TRUNCATE, etc.
 *
 * ─── How we detect the statement type ────────────────────────────────────────
 * We do NOT parse the entire SQL grammar (that would require embedding a full
 * parser library). Instead we apply a layered series of cheap string operations:
 *
 *   1. Strip SQL comments (-- single-line and /* block *\/).
 *      Comments can appear before the first keyword, so "-- trick\nDROP TABLE t"
 *      must be correctly identified as DROP, not "--".
 *
 *   2. Trim leading whitespace to find the first real character.
 *
 *   3. Extract the first word (token). This is the SQL verb: SELECT, INSERT, etc.
 *
 *   4. Special case — WITH:
 *      A CTE begins with WITH, but the *actual* operation depends on what comes
 *      after the CTE definition(s): "WITH x AS (...) SELECT" is read-only,
 *      "WITH x AS (...) INSERT" is a write. We walk through the parenthesised
 *      CTE body to find the body keyword.
 *
 *   5. Classify the keyword into one of three groups:
 *        'read'  — only reads data (SELECT, SHOW, DESCRIBE, EXPLAIN)
 *        'write' — modifies rows (INSERT, UPDATE, DELETE, REPLACE)
 *        'full'  — modifies structure (CREATE, DROP, ALTER, TRUNCATE, …)
 *
 *   6. Compare the classification against the allowed mode and return a result.
 *
 * ─── Multi-statement SQL ──────────────────────────────────────────────────────
 * A single request may contain several statements separated by semicolons:
 *   "SELECT 1; INSERT INTO t VALUES (1)"
 *
 * We split on semicolons, filter out empty/comment-only fragments, and validate
 * each statement independently. If *any* statement is denied, the whole request
 * is denied — we never execute partial batches.
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────
 *   PermissionMode   — 'read-only' | 'write' | 'full'
 *   ValidationResult — { allowed: boolean, reason?: string }
 *   validateQuery    — the main function that callers invoke
 */

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The three permission modes dbpeek supports.
 * Exported so that route handlers can type-check the mode they receive from
 * app.locals without importing from server/index.ts (circular dependency risk).
 */
export type PermissionMode = 'read-only' | 'write' | 'full';

/**
 * The result returned by validateQuery.
 *
 * allowed — true if the query may proceed, false if it must be rejected
 * reason  — a human-readable explanation of why it was denied (only present
 *            when allowed is false)
 */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
}

// ── Keyword sets ──────────────────────────────────────────────────────────────

/**
 * SQL verbs that only read data — allowed in all three modes.
 *
 * SELECT  — standard query
 * SHOW    — MySQL/MariaDB: lists tables, databases, columns, etc.
 * DESCRIBE / DESC — MySQL/PostgreSQL: shows column definitions
 * EXPLAIN — shows the query execution plan (reads metadata only)
 */
const READ_ONLY_KEYWORDS = new Set(['SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN']);

/**
 * SQL verbs that modify rows but not schema — allowed in 'write' and 'full'.
 *
 * INSERT  — adds new rows
 * UPDATE  — modifies existing rows
 * DELETE  — removes rows
 * REPLACE — MySQL: INSERT-or-DELETE-then-INSERT (functionally similar to INSERT)
 */
const WRITE_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);

// ── Internal types ────────────────────────────────────────────────────────────

/**
 * The internal classification assigned to each SQL statement.
 *
 * 'read'  — statement is safe in read-only mode
 * 'write' — statement requires at least write mode
 * 'full'  — statement requires full mode (DDL, schema changes)
 * 'empty' — no meaningful SQL after comment stripping (ignored in loops)
 */
type StatementClass = 'read' | 'write' | 'full' | 'empty';

// ── Comment stripping ─────────────────────────────────────────────────────────

/**
 * stripComments
 *
 * Returns a copy of `sql` with all SQL comments removed.
 * String literals are preserved intact so that "--" or "/*" inside a quoted
 * value does not trigger comment removal.
 *
 * Pseudocode:
 *   Walk through the string character by character:
 *   - When we see "--":  skip everything until the next newline.
 *   - When we see "/*":  skip everything until the matching "* /".
 *   - When we see ' or ": copy the entire quoted literal verbatim (handling
 *     '' doubled-quote escapes and backslash escapes).
 *   - Otherwise: copy the character to the output.
 *
 * Why handle string literals at all?
 *   Without this, a value like SELECT '-- not a comment' would have the
 *   comment-looking part stripped, corrupting the query before we even
 *   inspect the first keyword.
 *
 * @param sql - raw SQL string, possibly containing comments
 * @returns     the same SQL with comments removed
 */
function stripComments(sql: string): string {
  let result = '';
  let i = 0;

  while (i < sql.length) {
    // ── Single-line comment: -- to end of line ──────────────────────────────
    if (sql[i] === '-' && sql[i + 1] === '-') {
      // Advance past every character up to (but not including) the newline.
      // The newline itself is left in place so the line count stays correct.
      while (i < sql.length && sql[i] !== '\n') i++;
      // Do NOT emit anything — the comment is discarded.
    }

    // ── Block comment: /* … */ ───────────────────────────────────────────────
    else if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2; // skip the "/*" opener
      // Advance until we find the closing "*/".
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2; // skip the "*/" closer
    }

    // ── Single-quoted string literal: '…' ───────────────────────────────────
    // Standard SQL escapes a literal quote by doubling it: 'it''s a value'.
    // Some dialects also allow backslash escapes: 'it\'s a value'.
    // We handle both so we don't exit the string prematurely.
    else if (sql[i] === "'") {
      result += sql[i++]; // emit the opening quote
      while (i < sql.length) {
        if (sql[i] === "'") {
          result += sql[i++]; // emit the quote character
          // Doubled quote '' — still inside the string; keep going.
          if (i < sql.length && sql[i] === "'") {
            result += sql[i++];
          } else {
            break; // single closing quote — string is done
          }
        } else if (sql[i] === '\\') {
          // Backslash escape — copy both the backslash and the next char.
          result += sql[i++];
          if (i < sql.length) result += sql[i++];
        } else {
          result += sql[i++];
        }
      }
    }

    // ── Double-quoted identifier: "…" ────────────────────────────────────────
    // In standard SQL, double quotes delimit identifiers, not strings.
    // e.g. SELECT "my column" FROM "my table"
    // We preserve them so an identifier named "--tricky" doesn't confuse us.
    else if (sql[i] === '"') {
      result += sql[i++]; // emit the opening double-quote
      while (i < sql.length && sql[i] !== '"') {
        result += sql[i++];
      }
      if (i < sql.length) result += sql[i++]; // emit the closing double-quote
    }

    // ── Normal character: copy through ──────────────────────────────────────
    else {
      result += sql[i++];
    }
  }

  return result;
}

// ── Balanced parenthesis skipper ──────────────────────────────────────────────

/**
 * skipBalancedParens
 *
 * Given a SQL string and the index of an opening parenthesis '(', returns the
 * index of the first character *after* the matching closing parenthesis ')'.
 *
 * This is needed to walk past CTE bodies like:
 *   WITH cte AS (SELECT a, (SELECT b FROM inner) AS sub) SELECT ...
 *                ^                                      ^
 *                start                          returned index
 *
 * Pseudocode:
 *   depth ← 1    (we've consumed the opening '(')
 *   i    ← start + 1
 *   while depth > 0 and i < length:
 *     if '(' → depth++
 *     if ')' → depth--
 *     if "'" → skip quoted string (handling '' escapes)
 *     if '"' → skip quoted identifier
 *     advance i
 *   return i
 *
 * @param sql   - the SQL string (should already have comments stripped)
 * @param start - index of the opening '('
 * @returns       index immediately after the matching ')'
 */
function skipBalancedParens(sql: string, start: number): number {
  let depth = 1;
  let i = start + 1; // move past the opening '('

  while (i < sql.length && depth > 0) {
    const ch = sql[i];

    if (ch === '(') {
      depth++;
      i++;
    } else if (ch === ')') {
      depth--;
      i++;
    } else if (ch === "'") {
      // Skip a single-quoted string, handling '' escape sequences.
      i++;
      while (i < sql.length) {
        if (sql[i] === "'") {
          i++;
          // Doubled quote '' means we're still inside the string.
          if (i < sql.length && sql[i] === "'") {
            i++;
          } else {
            break; // end of the string literal
          }
        } else {
          i++;
        }
      }
    } else if (ch === '"') {
      // Skip a double-quoted identifier.
      i++;
      while (i < sql.length && sql[i] !== '"') i++;
      if (i < sql.length) i++; // skip the closing "
    } else {
      i++;
    }
  }

  return i;
}

// ── WITH body keyword extraction ──────────────────────────────────────────────

/**
 * withBodyKeyword
 *
 * Given a WITH statement (already comment-stripped), extracts the first keyword
 * of the query body that follows all the CTE definitions.
 *
 * A WITH statement looks like:
 *
 *   WITH [RECURSIVE]
 *        cte_name [(col1, col2)] AS (cte_body),
 *        another_cte  AS (another_body)
 *   <body_query>          ← this is the keyword we want
 *
 * The body_query determines what the statement actually does:
 *   WITH … SELECT → read-only
 *   WITH … INSERT → write
 *   WITH … DELETE → write
 *   WITH … UPDATE → write
 *   WITH … CREATE → full
 *
 * Pseudocode:
 *   i ← 4              (skip 'WITH')
 *   if next word is RECURSIVE: skip it (it's an optional modifier, not a CTE name)
 *   loop:
 *     skip whitespace
 *     skip CTE name (quoted or unquoted identifier)
 *     skip whitespace
 *     if '(' follows: skip optional column list
 *     skip whitespace
 *     if 'AS' follows: skip it
 *     skip whitespace
 *     if '(' follows: skip CTE body (balanced parens)
 *     skip whitespace
 *     if ',' follows: another CTE — continue loop
 *     else: break (we're at the body query)
 *   return first word of remaining SQL
 *
 * @param sql - the full WITH statement (comments already stripped, trimmed)
 * @returns     the first keyword of the body query in UPPERCASE (e.g. 'SELECT')
 */
function withBodyKeyword(sql: string): string {
  let i = 4; // skip past 'WITH'

  // Skip whitespace after WITH.
  while (i < sql.length && /\s/.test(sql[i])) i++;

  // ── Optional RECURSIVE modifier ─────────────────────────────────────────
  // Syntax: WITH RECURSIVE cte AS (...)
  // RECURSIVE tells the database the CTE references itself. It does not change
  // the nature of the body query.
  if (sql.slice(i, i + 9).toUpperCase() === 'RECURSIVE') {
    i += 9;
  }

  // ── Walk through one or more CTE definitions ────────────────────────────
  // The loop runs once per CTE, continuing when it finds a comma separator.
  while (i < sql.length) {
    // Skip leading whitespace before the CTE name.
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (i >= sql.length) break;

    // ── Skip the CTE name ─────────────────────────────────────────────────
    // CTE names are either unquoted identifiers (word chars + $) or
    // double-quoted identifiers for names with spaces or reserved words.
    if (sql[i] === '"') {
      i++; // skip opening "
      while (i < sql.length && sql[i] !== '"') i++;
      if (i < sql.length) i++; // skip closing "
    } else {
      // Unquoted identifier: word characters and $ (valid in some dialects).
      while (i < sql.length && /[\w$]/.test(sql[i])) i++;
    }

    // Skip whitespace between the name and what follows.
    while (i < sql.length && /\s/.test(sql[i])) i++;

    // ── Skip optional column list: cte_name (col1, col2) ─────────────────
    // Some databases let you name the CTE's output columns before AS:
    //   WITH cte (x, y) AS (SELECT a, b FROM t)
    // We detect the '(' here (before AS) and skip the whole list.
    if (i < sql.length && sql[i] === '(' ) {
      i = skipBalancedParens(sql, i);
    }

    // Skip whitespace before AS.
    while (i < sql.length && /\s/.test(sql[i])) i++;

    // ── Skip the AS keyword ───────────────────────────────────────────────
    if (sql.slice(i, i + 2).toUpperCase() === 'AS') {
      i += 2;
    }

    // Skip whitespace between AS and the CTE body.
    while (i < sql.length && /\s/.test(sql[i])) i++;

    // ── Skip the CTE body in balanced parentheses ─────────────────────────
    // The CTE body is always wrapped in parentheses: AS (SELECT …).
    // We use skipBalancedParens so that nested parens in the body (subqueries,
    // function calls, etc.) don't confuse us.
    if (i < sql.length && sql[i] === '(') {
      i = skipBalancedParens(sql, i);
    }

    // Skip whitespace after the CTE body.
    while (i < sql.length && /\s/.test(sql[i])) i++;

    // ── Comma? Another CTE follows — loop again ───────────────────────────
    if (i < sql.length && sql[i] === ',') {
      i++; // skip the comma
      continue;
    }

    // No comma — we've consumed all CTEs; the rest is the body query.
    break;
  }

  // Extract the first word from whatever remains after all the CTEs.
  const remaining = sql.slice(i).trimStart();
  const match = remaining.match(/^(\w+)/i);
  return match ? match[1].toUpperCase() : '';
}

// ── Statement classifier ──────────────────────────────────────────────────────

/**
 * classifyStatement
 *
 * Determines the permission class of a single SQL statement.
 *
 * Pseudocode:
 *   1. Strip comments and trim whitespace.
 *   2. If nothing remains: return 'empty'.
 *   3. Extract the first word (the SQL verb).
 *   4. Look up the verb:
 *        in READ_ONLY_KEYWORDS → 'read'
 *        'WITH'               → recurse via withBodyKeyword(), then classify
 *        in WRITE_KEYWORDS    → 'write'
 *        anything else        → 'full'
 *   5. Return { cls, keyword } where keyword is the effective verb
 *      (for WITH, it's the body verb, used in error messages).
 *
 * @param raw - a single SQL statement (may contain comments and whitespace)
 * @returns    classification + the keyword for error messages
 */
function classifyStatement(raw: string): { cls: StatementClass; keyword: string } {
  // Step 1: strip comments and trim so we start at the first real token.
  const stripped = stripComments(raw).trim();

  // Step 2: nothing meaningful → mark as empty so the caller can skip it.
  if (!stripped) {
    return { cls: 'empty', keyword: '' };
  }

  // Step 3: extract the first word.
  // \w+ matches letters, digits, and underscores — covers all SQL keywords.
  const match = stripped.match(/^(\w+)/i);
  if (!match) {
    // The statement starts with a non-word character (e.g. a lone operator).
    // Treat it as requiring full access to be safe.
    return { cls: 'full', keyword: '' };
  }
  const keyword = match[1].toUpperCase();

  // Step 4a: read-only keywords → safe in all modes.
  if (READ_ONLY_KEYWORDS.has(keyword)) {
    return { cls: 'read', keyword };
  }

  // Step 4b: WITH — the class depends on the body query that follows the CTEs.
  if (keyword === 'WITH') {
    const bodyKw = withBodyKeyword(stripped);

    if (!bodyKw) {
      // Could not determine the body keyword (malformed SQL); assume read.
      // The database will reject it anyway if it's wrong.
      return { cls: 'read', keyword };
    }

    if (READ_ONLY_KEYWORDS.has(bodyKw)) return { cls: 'read', keyword: bodyKw };
    if (WRITE_KEYWORDS.has(bodyKw)) return { cls: 'write', keyword: bodyKw };
    // Body is DDL or something else → full access required.
    return { cls: 'full', keyword: bodyKw };
  }

  // Step 4c: write keywords → require at least write mode.
  if (WRITE_KEYWORDS.has(keyword)) {
    return { cls: 'write', keyword };
  }

  // Step 4d: anything else (CREATE, DROP, ALTER, TRUNCATE, CALL, EXEC, …)
  // → full mode required.
  return { cls: 'full', keyword };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * validateQuery
 *
 * Checks whether `sql` is permitted under the given `mode`.
 *
 * Pseudocode:
 *   1. Reject empty / whitespace-only input immediately.
 *   2. Split on semicolons; filter out empty and comment-only fragments.
 *   3. Reject if no real statements remain (e.g. input was only "/* comment *\/").
 *   4. In full mode: allow everything that has at least one real statement.
 *   5. For each statement:
 *        classify it (read / write / full)
 *        if mode is 'read-only' and class is not 'read' → deny
 *        if mode is 'write'    and class is 'full'      → deny
 *   6. If every statement passed: allow.
 *
 * Why split on semicolons?
 *   A single POST body could contain "SELECT 1; DROP TABLE users". Without
 *   splitting, we'd only see SELECT and allow the whole thing through. We
 *   must validate every statement in the batch.
 *
 * Limitation: splitting on raw semicolons fails for semicolons inside string
 * literals (e.g. WHERE comment = 'a;b'). For the purposes of permission
 * gating, this is an acceptable simplification — a false positive (denying a
 * safe query with ';' in a string) is far less harmful than a false negative.
 *
 * @param sql  - the SQL string to validate (may be multi-statement)
 * @param mode - the permission mode currently active
 * @returns      { allowed: true } or { allowed: false, reason: '…' }
 */
export function validateQuery(sql: string, mode: PermissionMode): ValidationResult {
  // Step 1: fast-path rejection for empty input.
  if (!sql || !sql.trim()) {
    return { allowed: false, reason: 'SQL statement is empty.' };
  }

  // Step 2: split on semicolons and discard comment-only fragments.
  // Example: "SELECT 1; -- just a comment; SELECT 2"
  //   → ['SELECT 1', ' -- just a comment', ' SELECT 2']
  //   → filter: 'SELECT 1' and ' SELECT 2' survive, the comment-only fragment
  //     is removed because stripComments(' -- just a comment').trim() === ''
  //
  // This must happen BEFORE the full-mode short-circuit so that a string that
  // is entirely comments (e.g. "/* nothing here */") is still rejected even in
  // full mode — there is no actual SQL to execute.
  const statements = sql.split(';').filter((s) => stripComments(s).trim().length > 0);

  // Step 3: if nothing real remains after filtering (e.g. only ";" or "-- x"
  // or "/* block comment */") the entire input was effectively empty.
  if (statements.length === 0) {
    return { allowed: false, reason: 'SQL statement is empty.' };
  }

  // Step 4: full mode — allow any non-empty, non-comment-only SQL without
  // per-statement inspection.
  if (mode === 'full') {
    return { allowed: true };
  }

  // Step 5: validate each statement against the mode.
  for (const stmt of statements) {
    const { cls, keyword } = classifyStatement(stmt);

    // 'empty' should not appear here (filtered above), but skip defensively.
    if (cls === 'empty') continue;

    if (mode === 'read-only' && (cls === 'write' || cls === 'full')) {
      // The statement would modify data or schema — deny it in read-only mode.
      return {
        allowed: false,
        reason:
          `'${keyword}' is not allowed in read-only mode. ` +
          `Only SELECT, SHOW, DESCRIBE, EXPLAIN, and read-only WITH queries are permitted.`,
      };
    }

    if (mode === 'write' && cls === 'full') {
      // The statement would modify schema (DDL) — deny it in write mode.
      return {
        allowed: false,
        reason:
          `'${keyword}' is not allowed in write mode. ` +
          `DDL statements (CREATE, DROP, ALTER, etc.) require full mode.`,
      };
    }
  }

  // Step 6: every statement passed — allow the query.
  return { allowed: true };
}
