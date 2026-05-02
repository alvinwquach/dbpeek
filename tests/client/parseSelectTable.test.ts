// ===== FILE PURPOSE =====
// Unit tests for parseSelectTable — the editability gate for inline cell
// edits in the results grid.
//
// THE INVARIANT BEING PROTECTED:
//   parseSelectTable returns "ok" only when the cell-edit flow can SAFELY
//   construct an UPDATE that targets exactly the table the user is looking
//   at. False negatives ("we couldn't tell — query is too complex") are
//   acceptable because they degrade to read-only. False positives ("yes,
//   edit users") on a JOIN / sub-SELECT / CTE would let an UPDATE land on
//   the wrong table — that's the unsafe failure mode this file guards
//   against.
//
// COVERAGE STRATEGY:
//   - All four kind discriminants ("ok", "multi", "non-select",
//     plus the implicit-join + UNION refinements that fold into "multi").
//   - All three identifier-quoting styles that real users paste in.
//   - Lexer adversaries: comments, strings, casing — anything that could
//     hide a structural keyword from a naive scanner.
//   - The trailing-clause whitelist (WHERE / ORDER BY / GROUP BY / etc.).

import { describe, it, expect } from "vitest";
import { parseSelectTable } from "../../src/client/utils/parseSelectTable.js";

// ===== HELPERS =====

/**
 * Asserts the SQL parses to "ok" with the given table.
 *
 * WHY a custom helper:
 *   The discriminated-union return type means the test has to type-narrow
 *   on `kind` before reading `.table`. Wrapping that in a single helper
 *   keeps each test on one line and makes a failure surface the actual
 *   parsed kind ("expected ok(users), got multi") instead of just "expected
 *   true".
 */
function expectOk(sql: string, table: string) {
  const result = parseSelectTable(sql);
  if (result.kind !== "ok") {
    throw new Error(
      `Expected "${sql}" to parse as ok(${table}), got kind=${result.kind}`
    );
  }
  expect(result.table).toBe(table);
}

/** Asserts the SQL parses to "multi" — any multi-table / CTE / sub-SELECT case. */
function expectMulti(sql: string) {
  const result = parseSelectTable(sql);
  if (result.kind !== "multi") {
    throw new Error(
      `Expected "${sql}" to parse as multi, got kind=${result.kind}` +
        (result.kind === "ok" ? ` (table=${result.table})` : "")
    );
  }
  expect(result.kind).toBe("multi");
}

/** Asserts the SQL parses to "non-select" — empty, INSERT, UPDATE, etc. */
function expectNonSelect(sql: string) {
  const result = parseSelectTable(sql);
  expect(result.kind).toBe("non-select");
}

// ===== HAPPY PATH: SIMPLE SELECTS =====

describe("parseSelectTable — simple single-table SELECTs", () => {
  it("matches a plain SELECT * FROM table", () => {
    expectOk("SELECT * FROM users", "users");
  });

  it("matches a SELECT with a column projection", () => {
    expectOk("SELECT id, email FROM users", "users");
  });

  it("matches lowercase keywords (SQL is case-insensitive)", () => {
    expectOk("select * from users", "users");
  });

  it("matches mixed-case keywords", () => {
    expectOk("Select Id From Users", "Users");
  });

  it("matches an underscore-bearing table name", () => {
    expectOk("SELECT * FROM user_settings", "user_settings");
  });

  it("matches a $-bearing table name (Oracle/Postgres-legal)", () => {
    expectOk("SELECT * FROM tbl$archive", "tbl$archive");
  });

  it("strips a trailing semicolon", () => {
    expectOk("SELECT * FROM users;", "users");
  });

  it("tolerates trailing whitespace and a trailing semicolon", () => {
    expectOk("  SELECT * FROM users  ;  \n", "users");
  });
});

// ===== IDENTIFIER QUOTING =====

describe("parseSelectTable — quoted identifiers", () => {
  it('strips Postgres / ANSI double-quoted identifiers', () => {
    expectOk('SELECT * FROM "users"', "users");
  });

  it("strips MySQL backtick-quoted identifiers", () => {
    expectOk("SELECT * FROM `users`", "users");
  });

  it("returns the unquoted name for a schema-qualified identifier", () => {
    // public.users → table is "users" (the schema prefix is dropped because
    // the cell-edit endpoint scopes by table name only).
    expectOk("SELECT * FROM public.users", "users");
  });

  it("handles double-quoted schema and table", () => {
    expectOk('SELECT * FROM "public"."users"', "users");
  });

  it("handles a mix of unquoted schema and quoted table", () => {
    expectOk('SELECT * FROM public."users"', "users");
  });
});

// ===== TRAILING CLAUSES (allowed) =====

describe("parseSelectTable — allowed trailing clauses", () => {
  it("allows WHERE", () => {
    expectOk("SELECT * FROM users WHERE id = 1", "users");
  });

  it("allows ORDER BY", () => {
    expectOk("SELECT * FROM users ORDER BY id DESC", "users");
  });

  it("allows GROUP BY", () => {
    expectOk("SELECT country, COUNT(*) FROM users GROUP BY country", "users");
  });

  it("allows HAVING after GROUP BY", () => {
    expectOk(
      "SELECT country FROM users GROUP BY country HAVING COUNT(*) > 1",
      "users"
    );
  });

  it("allows LIMIT", () => {
    expectOk("SELECT * FROM users LIMIT 10", "users");
  });

  it("allows OFFSET", () => {
    expectOk("SELECT * FROM users LIMIT 10 OFFSET 20", "users");
  });

  it("allows the chain WHERE … ORDER BY … LIMIT", () => {
    expectOk(
      "SELECT * FROM users WHERE active = TRUE ORDER BY id LIMIT 50",
      "users"
    );
  });
});

// ===== MULTI-TABLE / NESTED REJECTIONS =====

describe("parseSelectTable — JOIN rejection", () => {
  it("rejects an explicit INNER JOIN", () => {
    expectMulti(
      "SELECT * FROM users INNER JOIN orders ON users.id = orders.user_id"
    );
  });

  it("rejects a LEFT JOIN", () => {
    expectMulti("SELECT * FROM users LEFT JOIN orders ON x = y");
  });

  it("rejects a CROSS JOIN", () => {
    expectMulti("SELECT * FROM a CROSS JOIN b");
  });

  it("rejects an implicit comma-separated FROM list", () => {
    expectMulti("SELECT * FROM users, orders WHERE users.id = orders.user_id");
  });
});

describe("parseSelectTable — CTE rejection", () => {
  it("rejects a leading WITH (CTE)", () => {
    expectMulti("WITH active AS (SELECT * FROM users) SELECT * FROM active");
  });

  it("rejects a leading WITH RECURSIVE", () => {
    expectMulti(
      "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t) SELECT * FROM t"
    );
  });
});

describe("parseSelectTable — sub-SELECT rejection", () => {
  it("rejects a sub-SELECT in the FROM clause", () => {
    expectMulti("SELECT * FROM (SELECT id FROM users) sub");
  });

  it("rejects a sub-SELECT in the projection", () => {
    expectMulti(
      "SELECT id, (SELECT COUNT(*) FROM orders) AS n FROM users"
    );
  });

  it("rejects a sub-SELECT in a WHERE EXISTS", () => {
    expectMulti(
      "SELECT * FROM users WHERE EXISTS (SELECT 1 FROM orders WHERE user_id = users.id)"
    );
  });
});

describe("parseSelectTable — set operations", () => {
  it("rejects UNION", () => {
    expectMulti("SELECT id FROM users UNION SELECT id FROM admins");
  });

  it("rejects UNION ALL", () => {
    expectMulti("SELECT id FROM users UNION ALL SELECT id FROM admins");
  });

  it("rejects INTERSECT", () => {
    expectMulti("SELECT id FROM users INTERSECT SELECT id FROM admins");
  });

  it("rejects EXCEPT", () => {
    expectMulti("SELECT id FROM users EXCEPT SELECT id FROM banned");
  });
});

// ===== NON-SELECT INPUTS =====

describe("parseSelectTable — non-SELECT statements", () => {
  it("returns non-select for INSERT", () => {
    expectNonSelect("INSERT INTO users VALUES (1, 'x')");
  });

  it("returns non-select for UPDATE", () => {
    expectNonSelect("UPDATE users SET name = 'x' WHERE id = 1");
  });

  it("returns non-select for DELETE", () => {
    expectNonSelect("DELETE FROM users WHERE id = 1");
  });

  it("returns non-select for DDL (CREATE TABLE)", () => {
    expectNonSelect("CREATE TABLE x (id INT)");
  });

  it("returns non-select for the empty string", () => {
    expectNonSelect("");
  });

  it("returns non-select for whitespace-only input", () => {
    expectNonSelect("   \n\t  ");
  });

  it("returns non-select for comment-only input", () => {
    expectNonSelect("-- just a comment\n");
  });
});

// ===== ADVERSARIAL LEXER CASES =====
//
// These tests exist because a naive regex on the raw SQL would mis-classify
// queries whose comments or string literals contain structural keywords.
// stripCommentsAndStrings runs FIRST inside parseSelectTable; if a future
// refactor reorders that or replaces a regex with a different shape, these
// tests fail loudly.

describe("parseSelectTable — comments cannot smuggle in keywords", () => {
  it("ignores a JOIN inside a line comment", () => {
    // The user happens to mention JOIN in a -- comment; the structural
    // scan must look past it, not be confused by it.
    expectOk("-- TODO: add a JOIN later\nSELECT * FROM users", "users");
  });

  it("ignores a JOIN inside a block comment", () => {
    expectOk("/* JOIN ON x = y */ SELECT * FROM users", "users");
  });

  it("ignores a UNION inside a line comment", () => {
    expectOk("-- UNION the results later\nSELECT * FROM users", "users");
  });

  it("ignores a WITH (CTE) inside a block comment", () => {
    expectOk("/* WITH cte AS ... */ SELECT * FROM users", "users");
  });

  it("ignores a SELECT inside a comment (no false sub-SELECT detection)", () => {
    expectOk("/* SELECT 1 */ SELECT * FROM users", "users");
  });
});

describe("parseSelectTable — string literals cannot smuggle in keywords", () => {
  it("ignores a JOIN inside a single-quoted string literal", () => {
    expectOk("SELECT 'INNER JOIN orders' AS note FROM users", "users");
  });

  it("ignores a UNION inside a string literal", () => {
    expectOk("SELECT 'a UNION b' AS s FROM users", "users");
  });

  it("ignores a SELECT inside a string literal", () => {
    expectOk("SELECT 'SELECT 1' AS s FROM users", "users");
  });

  it("ignores a comma inside a string literal (no false implicit-join)", () => {
    // "FROM users, orders" → multi. But "SELECT 'a, b' FROM users" → ok,
    // because the comma is inside a string literal, not in the FROM list.
    expectOk("SELECT 'a, b' AS s FROM users", "users");
  });
});

// ===== BOUNDARY CASES =====
//
// These guard against over-eager regex matching. In particular \b boundaries
// must reject substrings: JOINED is not JOIN, UNIONS is not UNION.

describe("parseSelectTable — keyword boundary correctness", () => {
  it("does not treat a column alias 'JOINED' as a JOIN", () => {
    expectOk("SELECT id AS JOINED FROM users", "users");
  });

  it("does not treat a column 'UNIONS' as UNION", () => {
    // A column literally named "unions". \b boundaries make UNION require a
    // following non-word character, so this stays single-table.
    expectOk("SELECT unions FROM users", "users");
  });
});

// ===== UNRECOGNISED TRAILING CONTENT =====
//
// Anything after FROM <table> that isn't a recognised clause is treated as
// "multi" (i.e. we couldn't prove it was safe). This is intentional — the
// trailing-clause whitelist is the safety net that catches weird syntax we
// haven't taught the parser about yet.

describe("parseSelectTable — unknown trailing content", () => {
  it("treats unknown trailing text as multi (conservative refusal)", () => {
    // FOR ARGLEBARGLE is gibberish; the parser rejects it rather than
    // optimistically treating it as a no-op.
    expectMulti("SELECT * FROM users ARGLEBARGLE");
  });

  it("permits FOR UPDATE locking clauses (recognised by the whitelist)", () => {
    // FOR is in the trailing-clause whitelist — the parser doesn't try to
    // validate the rest of the locking clause, just that it begins
    // legitimately.
    expectOk("SELECT * FROM users FOR UPDATE", "users");
  });
});
