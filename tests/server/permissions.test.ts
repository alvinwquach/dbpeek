/**
 * tests/server/permissions.test.ts
 *
 * Unit tests for the SQL permission enforcement module in
 * src/server/permissions.ts.
 *
 * ─── What are we testing? ────────────────────────────────────────────────────
 * validateQuery(sql, mode) → { allowed: boolean, reason?: string }
 *
 * It decides whether a given SQL string may run under a given permission mode:
 *   'read-only' → only SELECT / SHOW / DESCRIBE / EXPLAIN / WITH-ending-in-SELECT
 *   'write'     → also allows INSERT / UPDATE / DELETE
 *   'full'      → allows everything (CREATE / DROP / ALTER / TRUNCATE …)
 *
 * ─── How the tests are organised ─────────────────────────────────────────────
 * Three top-level describe blocks — one per permission mode — each split into:
 *   • allowed statements (should return allowed:true)
 *   • denied statements (should return allowed:false with a reason)
 *   • edge cases (comments, multi-statement, CTEs, empty input, etc.)
 *
 * ─── Why no database? ────────────────────────────────────────────────────────
 * validateQuery is a pure function — it only inspects a string and returns a
 * verdict. No I/O, no mocks, no test fixtures. Each test is one line of input
 * and one assertion on the output.
 *
 * ─── What a junior developer should look for ─────────────────────────────────
 * Most tests are one-liners because the `it(...)` name IS the documentation
 * ("denies CREATE TABLE" — what more is there to say?). Tests with an inline
 * comment above them are the ones exercising a subtle edge case; the comment
 * explains why that specific string was chosen.
 */

import { describe, it, expect } from 'vitest';
import { validateQuery } from '../../src/server/permissions.js';

// ── read-only mode ────────────────────────────────────────────────────────────
//
// The safe default mode. A user who starts `dbpeek` with no extra flags ends up
// here. It should accept anything that only reads data and reject anything that
// could mutate the database — no matter how that mutation is disguised
// (leading comments, CTEs, multi-statement batches, casing, etc.).

describe('validateQuery — read-only mode', () => {
  // ── allowed statements ───────────────────────────────────────────────────
  // These are the five keyword families explicitly permitted in read-only mode:
  // SELECT, SHOW, DESCRIBE (+ DESC alias), EXPLAIN, and WITH-ending-in-SELECT.

  it('allows SELECT', () => {
    expect(validateQuery('SELECT 1', 'read-only')).toMatchObject({ allowed: true });
  });

  // SQL keywords are case-insensitive. Users often type lowercase in editors.
  it('allows SELECT (lowercase)', () => {
    expect(validateQuery('select * from users', 'read-only')).toMatchObject({ allowed: true });
  });

  // Mixed case is also common (e.g. when copy-pasting from formatted snippets).
  it('allows SELECT (mixed case)', () => {
    expect(validateQuery('Select id, name From users', 'read-only')).toMatchObject({
      allowed: true,
    });
  });

  // SHOW TABLES / SHOW DATABASES etc. — MySQL / MariaDB introspection.
  it('allows SHOW', () => {
    expect(validateQuery('SHOW TABLES', 'read-only')).toMatchObject({ allowed: true });
  });

  // DESCRIBE is MySQL / PostgreSQL syntax for "show me the columns of this table".
  it('allows DESCRIBE', () => {
    expect(validateQuery('DESCRIBE users', 'read-only')).toMatchObject({ allowed: true });
  });

  // DESC is a MySQL shorthand for DESCRIBE. Both must be recognised.
  it('allows DESC (alias for DESCRIBE)', () => {
    expect(validateQuery('DESC users', 'read-only')).toMatchObject({ allowed: true });
  });

  // EXPLAIN shows the query planner's execution strategy — strictly read-only.
  it('allows EXPLAIN', () => {
    expect(validateQuery('EXPLAIN SELECT * FROM users', 'read-only')).toMatchObject({
      allowed: true,
    });
  });

  // A Common Table Expression (CTE): "WITH name AS (...) <body>".
  // The verdict depends on the BODY keyword — here it's SELECT, so read-only.
  // This is the happy path for the classic "define helpers, then query" pattern.
  it('allows WITH CTE ending in SELECT', () => {
    const sql = 'WITH cte AS (SELECT 1 AS n) SELECT * FROM cte';
    expect(validateQuery(sql, 'read-only')).toMatchObject({ allowed: true });
  });

  // RECURSIVE is an optional modifier that sits between WITH and the CTE name.
  // A naive parser would see "RECURSIVE" as the first token and misclassify it —
  // this test guards against that regression.
  it('allows WITH RECURSIVE CTE ending in SELECT', () => {
    const sql =
      'WITH RECURSIVE cte AS (SELECT 1 UNION ALL SELECT n+1 FROM cte WHERE n < 5) SELECT * FROM cte';
    expect(validateQuery(sql, 'read-only')).toMatchObject({ allowed: true });
  });

  // Multiple CTEs are comma-separated before the body. The parser must walk
  // past every `(...)` body and every `,` to find the real query.
  it('allows WITH multiple CTEs ending in SELECT', () => {
    const sql = 'WITH a AS (SELECT 1 AS x), b AS (SELECT 2 AS y) SELECT * FROM a, b';
    expect(validateQuery(sql, 'read-only')).toMatchObject({ allowed: true });
  });

  // The "first non-whitespace token" rule: whitespace before the keyword is fine.
  it('allows SELECT with leading whitespace', () => {
    expect(validateQuery('  \n  SELECT 1', 'read-only')).toMatchObject({ allowed: true });
  });

  // `-- ...` is a single-line SQL comment. The parser must strip it before
  // looking for the first real keyword, otherwise it might treat `--` as a token.
  it('allows SELECT with a leading single-line comment', () => {
    expect(validateQuery('-- fetch all users\nSELECT * FROM users', 'read-only')).toMatchObject({
      allowed: true,
    });
  });

  // `/* ... */` is a block comment. Same rule — must be stripped before parsing.
  it('allows SELECT with a leading block comment', () => {
    expect(validateQuery('/* get users */ SELECT * FROM users', 'read-only')).toMatchObject({
      allowed: true,
    });
  });

  // A single POST body can contain multiple statements separated by semicolons.
  // All of them must be validated; if every one is allowed, the batch is allowed.
  it('allows multiple SELECT statements separated by semicolons', () => {
    expect(validateQuery('SELECT 1; SELECT 2', 'read-only')).toMatchObject({ allowed: true });
  });

  // A fragment that consists only of a comment (after splitting on `;`) must be
  // treated as "no statement at all" — otherwise the comment's leading word
  // (e.g. "just") could be misinterpreted as a SQL verb.
  it('ignores comment-only fragments between semicolons', () => {
    expect(validateQuery('SELECT 1; -- just a comment', 'read-only')).toMatchObject({
      allowed: true,
    });
  });

  // Same idea for whitespace-only fragments ("SELECT 1;  ;SELECT 2" has an
  // empty statement between the two semicolons that should be ignored).
  it('ignores whitespace-only fragments between semicolons', () => {
    expect(validateQuery('SELECT 1;  ;SELECT 2', 'read-only')).toMatchObject({ allowed: true });
  });

  // ── denied statements ────────────────────────────────────────────────────
  // The three DML verbs (INSERT / UPDATE / DELETE) and all DDL verbs must be
  // rejected in read-only mode. The reason string should name the offending
  // keyword so the user knows what to fix.

  it('denies INSERT', () => {
    const result = validateQuery('INSERT INTO users VALUES (1)', 'read-only');
    expect(result.allowed).toBe(false);
    // The reason should name the blocked keyword so the error message is useful.
    expect(result.reason).toMatch(/INSERT/i);
  });

  it('denies UPDATE', () => {
    const result = validateQuery('UPDATE users SET name = "a"', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/UPDATE/i);
  });

  it('denies DELETE', () => {
    const result = validateQuery('DELETE FROM users', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/DELETE/i);
  });

  it('denies CREATE TABLE', () => {
    const result = validateQuery('CREATE TABLE t (id INT)', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CREATE/i);
  });

  it('denies DROP TABLE', () => {
    const result = validateQuery('DROP TABLE users', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/DROP/i);
  });

  it('denies ALTER TABLE', () => {
    const result = validateQuery('ALTER TABLE users ADD COLUMN age INT', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ALTER/i);
  });

  // TRUNCATE is classified as DDL (not DML) because many databases implement it
  // as a schema-level operation and it can't be rolled back. So it requires
  // 'full' mode, even though at first glance it looks like a bulk DELETE.
  it('denies TRUNCATE', () => {
    const result = validateQuery('TRUNCATE TABLE users', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/TRUNCATE/i);
  });

  // The tricky CTE case: the statement STARTS with WITH (a read-only keyword)
  // but the body query actually performs a write. A naive check of the first
  // keyword alone would wrongly allow this. withBodyKeyword() must dig past the
  // CTE definition to find the INSERT.
  it('denies WITH CTE ending in INSERT', () => {
    const sql = 'WITH cte AS (SELECT 1 AS n) INSERT INTO t SELECT * FROM cte';
    const result = validateQuery(sql, 'read-only');
    expect(result.allowed).toBe(false);
    // The error should name INSERT (the real operation), not WITH.
    expect(result.reason).toMatch(/INSERT/i);
  });

  // Same principle: CTE dressing up an UPDATE.
  it('denies WITH CTE ending in UPDATE', () => {
    const sql = 'WITH cte AS (SELECT 1 AS n) UPDATE t SET x = n FROM cte';
    const result = validateQuery(sql, 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/UPDATE/i);
  });

  // Same principle: CTE dressing up a DELETE — a common "delete rows matching
  // a subquery" idiom. Must still be denied in read-only mode.
  it('denies WITH CTE ending in DELETE', () => {
    const sql =
      'WITH cte AS (SELECT id FROM old_items) DELETE FROM t WHERE id IN (SELECT id FROM cte)';
    const result = validateQuery(sql, 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/DELETE/i);
  });

  // Multi-statement safety: even if the FIRST statement is allowed, a later
  // one that isn't must cause the whole batch to be rejected. We never want
  // to execute "the safe part" and leave the user thinking everything ran.
  it('denies SELECT followed by INSERT in multi-statement SQL', () => {
    const result = validateQuery('SELECT 1; INSERT INTO t VALUES (1)', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/INSERT/i);
  });

  // Adversarial case: could someone hide a dangerous verb behind a misleading
  // comment? No — the comment stripper removes `/* … */` before we look at the
  // first token, so the real first token (INSERT) is what the check sees.
  it('denies INSERT hidden behind a leading comment', () => {
    const result = validateQuery('/* looks harmless */ INSERT INTO t VALUES (1)', 'read-only');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/INSERT/i);
  });

  // ── empty / blank input ──────────────────────────────────────────────────
  // These tests document what "empty" means. A caller must never be able to
  // sneak through an empty / whitespace-only / comment-only body.

  it('denies an empty string', () => {
    const result = validateQuery('', 'read-only');
    expect(result.allowed).toBe(false);
    // Even in the "nothing to check" case we still return a non-empty reason
    // so the UI has something to display.
    expect(result.reason).toBeTruthy();
  });

  it('denies a whitespace-only string', () => {
    const result = validateQuery('   \n  \t ', 'read-only');
    expect(result.allowed).toBe(false);
  });

  // After stripping the single-line comment there are zero statements left —
  // treat as empty.
  it('denies a comment-only string', () => {
    const result = validateQuery('-- just a comment', 'read-only');
    expect(result.allowed).toBe(false);
  });

  // After splitting on `;` and filtering empty fragments, nothing remains.
  it('denies SQL that is only semicolons and whitespace', () => {
    const result = validateQuery(';  ;  ;', 'read-only');
    expect(result.allowed).toBe(false);
  });
});

// ── write mode ────────────────────────────────────────────────────────────────
//
// Opt-in via `--write`. Adds DML (INSERT / UPDATE / DELETE) on top of what
// read-only allows. Crucially, DDL (CREATE / DROP / ALTER / TRUNCATE) still
// needs to be rejected — a user who wanted to edit rows probably did NOT
// mean to drop the schema.

describe('validateQuery — write mode', () => {
  // ── allowed statements ───────────────────────────────────────────────────

  // Everything read-only still works in write mode.
  it('allows SELECT', () => {
    expect(validateQuery('SELECT 1', 'write')).toMatchObject({ allowed: true });
  });

  it('allows INSERT', () => {
    expect(validateQuery('INSERT INTO t VALUES (1)', 'write')).toMatchObject({ allowed: true });
  });

  it('allows UPDATE', () => {
    expect(validateQuery('UPDATE t SET x = 1 WHERE id = 1', 'write')).toMatchObject({
      allowed: true,
    });
  });

  it('allows DELETE', () => {
    expect(validateQuery('DELETE FROM t WHERE id = 1', 'write')).toMatchObject({ allowed: true });
  });

  // The CTE body dispatch must also work for DML: a WITH that ends in SELECT
  // is still read-only (trivially allowed), …
  it('allows WITH CTE ending in SELECT', () => {
    const sql = 'WITH cte AS (SELECT 1 AS n) SELECT * FROM cte';
    expect(validateQuery(sql, 'write')).toMatchObject({ allowed: true });
  });

  // … and a WITH that ends in INSERT is a valid write operation. This is a
  // common SQL idiom — stage values in a CTE, then insert them.
  it('allows WITH CTE ending in INSERT', () => {
    const sql = 'WITH cte AS (SELECT 1 AS n) INSERT INTO t SELECT n FROM cte';
    expect(validateQuery(sql, 'write')).toMatchObject({ allowed: true });
  });

  // DELETE ... WHERE id IN (SELECT ...) is a classic cleanup pattern.
  it('allows WITH CTE ending in DELETE', () => {
    const sql =
      'WITH old AS (SELECT id FROM t WHERE created < 2020) DELETE FROM t WHERE id IN (SELECT id FROM old)';
    expect(validateQuery(sql, 'write')).toMatchObject({ allowed: true });
  });

  // Mixed read + write batches are allowed as long as every statement is
  // within the mode's permission ceiling.
  it('allows multi-statement SELECT then INSERT', () => {
    expect(validateQuery('SELECT 1; INSERT INTO t VALUES (2)', 'write')).toMatchObject({
      allowed: true,
    });
  });

  // ── denied DDL statements ────────────────────────────────────────────────
  // Schema changes still require the user to opt all the way up to 'full' mode.

  it('denies CREATE TABLE', () => {
    const result = validateQuery('CREATE TABLE t (id INT)', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CREATE/i);
  });

  it('denies DROP TABLE', () => {
    const result = validateQuery('DROP TABLE t', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/DROP/i);
  });

  it('denies ALTER TABLE', () => {
    const result = validateQuery('ALTER TABLE t ADD COLUMN x INT', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/ALTER/i);
  });

  it('denies TRUNCATE', () => {
    const result = validateQuery('TRUNCATE TABLE t', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/TRUNCATE/i);
  });

  // Same multi-statement safety rule as in read-only: an allowed first
  // statement must not mask a disallowed second one.
  it('denies multi-statement INSERT then CREATE', () => {
    const result = validateQuery('INSERT INTO t VALUES (1); CREATE TABLE t2 (id INT)', 'write');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/CREATE/i);
  });
});

// ── full mode ─────────────────────────────────────────────────────────────────
//
// Opt-in via `--full`. Every SQL verb is permitted. The tests here mostly
// confirm that DDL passes, but we also need to prove that full mode does NOT
// silently allow "nothing" — we should still reject empty / comment-only input
// because there is nothing to execute and returning allowed:true would be
// misleading.

describe('validateQuery — full mode', () => {
  it('allows SELECT', () => {
    expect(validateQuery('SELECT 1', 'full')).toMatchObject({ allowed: true });
  });

  it('allows INSERT', () => {
    expect(validateQuery('INSERT INTO t VALUES (1)', 'full')).toMatchObject({ allowed: true });
  });

  it('allows CREATE TABLE', () => {
    expect(validateQuery('CREATE TABLE t (id INT)', 'full')).toMatchObject({ allowed: true });
  });

  it('allows DROP TABLE', () => {
    expect(validateQuery('DROP TABLE t', 'full')).toMatchObject({ allowed: true });
  });

  it('allows ALTER TABLE', () => {
    expect(validateQuery('ALTER TABLE t ADD COLUMN x INT', 'full')).toMatchObject({
      allowed: true,
    });
  });

  it('allows TRUNCATE', () => {
    expect(validateQuery('TRUNCATE TABLE t', 'full')).toMatchObject({ allowed: true });
  });

  // Regression guard: an earlier version of validateQuery short-circuited on
  // mode === 'full' before checking whether any real statements existed — so
  // the empty string snuck through. This test locks in the correct order.
  it('still denies an empty string', () => {
    const result = validateQuery('', 'full');
    expect(result.allowed).toBe(false);
  });

  // Same regression guard for a string that is non-empty but contains only a
  // comment. After stripping there is nothing to execute, so even full mode
  // must refuse.
  it('still denies a comment-only string', () => {
    const result = validateQuery('/* nothing here */', 'full');
    expect(result.allowed).toBe(false);
  });
});
