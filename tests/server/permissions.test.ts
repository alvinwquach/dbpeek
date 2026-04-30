// ===== FILE PURPOSE =====
// Tests for the SQL permission validator. This is the security boundary of
// the application — every test here represents a behaviour the route handler
// depends on for safety. A regression in this file is a security regression.
//
// The matrix below covers:
//   - Each permission mode (readonly / write / full).
//   - The three statement classes (READ / WRITE / DDL) per mode.
//   - Multi-statement input (one statement allowed, another blocked).
//   - Lexer edge cases (comments, casing, strings containing semicolons).
//   - Reasonable error messages that suggest the next-step flag.

import { describe, it, expect } from "vitest";
import { validateQuery } from "../../src/server/permissions.js";

// ===== HELPERS =====

/**
 * Asserts a query is allowed under a given mode.
 *
 * WHY a helper rather than inlining `expect(validateQuery(...).allowed).toBe(true)`:
 *   The discriminated union return type means TypeScript narrows `result.reason`
 *   only inside the !allowed branch. Wrapping the call in a helper that asserts
 *   on `allowed` keeps each test's intent on a single line and makes a denial
 *   show up in test output with the actual reason (instead of "expected true").
 */
function expectAllowed(sql: string, mode: "readonly" | "write" | "full") {
  const result = validateQuery(sql, mode);
  if (!result.allowed) {
    throw new Error(
      `Expected "${sql}" to be allowed in ${mode} mode, but got: ${result.reason}`
    );
  }
  expect(result.allowed).toBe(true);
}

/**
 * Asserts a query is denied under a given mode and (optionally) checks that
 * the reason contains a substring — typically the suggested flag.
 */
function expectDenied(
  sql: string,
  mode: "readonly" | "write" | "full",
  reasonIncludes?: string
) {
  const result = validateQuery(sql, mode);
  expect(result.allowed).toBe(false);
  if (!result.allowed && reasonIncludes) {
    expect(result.reason).toContain(reasonIncludes);
  }
}

// ===== READ STATEMENTS =====

describe("validateQuery — read statements", () => {
  it("allows SELECT in all three modes", () => {
    expectAllowed("SELECT * FROM users", "readonly");
    expectAllowed("SELECT * FROM users", "write");
    expectAllowed("SELECT * FROM users", "full");
  });

  it("allows SHOW (MySQL schema introspection) in read-only mode", () => {
    expectAllowed("SHOW TABLES", "readonly");
  });

  it("allows DESCRIBE in read-only mode", () => {
    expectAllowed("DESCRIBE users", "readonly");
  });

  it("allows EXPLAIN in read-only mode", () => {
    expectAllowed("EXPLAIN SELECT * FROM logs", "readonly");
  });

  it("allows WITH (CTE) in read-only mode", () => {
    expectAllowed(
      "WITH cte AS (SELECT 1) SELECT * FROM cte",
      "readonly"
    );
  });
});

// ===== WRITE STATEMENTS (DML) =====

describe("validateQuery — INSERT", () => {
  it("blocks INSERT in read-only mode and suggests --write", () => {
    expectDenied(
      "INSERT INTO users VALUES (1, 'x')",
      "readonly",
      "--write"
    );
  });

  it("allows INSERT in write mode", () => {
    expectAllowed("INSERT INTO users VALUES (1, 'x')", "write");
  });

  it("allows INSERT in full mode", () => {
    expectAllowed("INSERT INTO users VALUES (1, 'x')", "full");
  });
});

describe("validateQuery — UPDATE", () => {
  it("blocks UPDATE in read-only mode and suggests --write", () => {
    expectDenied("UPDATE users SET name = 'x'", "readonly", "--write");
  });

  it("allows UPDATE in write mode", () => {
    expectAllowed("UPDATE users SET name = 'x'", "write");
  });

  it("allows UPDATE in full mode", () => {
    expectAllowed("UPDATE users SET name = 'x'", "full");
  });
});

describe("validateQuery — DELETE", () => {
  it("blocks DELETE in read-only mode and suggests --write", () => {
    expectDenied(
      "DELETE FROM users WHERE id = 1",
      "readonly",
      "--write"
    );
  });

  it("allows DELETE in write mode", () => {
    expectAllowed("DELETE FROM users WHERE id = 1", "write");
  });

  it("allows DELETE in full mode", () => {
    expectAllowed("DELETE FROM users WHERE id = 1", "full");
  });

  it("returns the exact spec'd reason for DELETE in read-only", () => {
    const result = validateQuery("DELETE FROM users", "readonly");
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe(
        "DELETE not allowed in read-only mode. Start with --write to enable."
      );
    }
  });
});

// ===== DDL STATEMENTS =====

describe("validateQuery — DROP", () => {
  it("blocks DROP in read-only mode and suggests --full", () => {
    expectDenied("DROP TABLE users", "readonly", "--full");
  });

  it("blocks DROP in write mode and suggests --full", () => {
    expectDenied("DROP TABLE users", "write", "--full");
  });

  it("allows DROP only in full mode", () => {
    expectAllowed("DROP TABLE users", "full");
  });
});

describe("validateQuery — ALTER", () => {
  it("blocks ALTER in read-only mode", () => {
    expectDenied("ALTER TABLE users ADD COLUMN x INT", "readonly", "--full");
  });

  it("blocks ALTER in write mode", () => {
    expectDenied("ALTER TABLE users ADD COLUMN x INT", "write", "--full");
  });

  it("allows ALTER only in full mode", () => {
    expectAllowed("ALTER TABLE users ADD COLUMN x INT", "full");
  });
});

describe("validateQuery — CREATE", () => {
  it("blocks CREATE in read-only mode", () => {
    expectDenied("CREATE TABLE x (id INT)", "readonly", "--full");
  });

  it("blocks CREATE in write mode", () => {
    expectDenied("CREATE TABLE x (id INT)", "write", "--full");
  });

  it("allows CREATE only in full mode", () => {
    expectAllowed("CREATE TABLE x (id INT)", "full");
  });
});

describe("validateQuery — TRUNCATE", () => {
  it("blocks TRUNCATE in read-only and write modes; allows in full", () => {
    expectDenied("TRUNCATE TABLE logs", "readonly");
    expectDenied("TRUNCATE TABLE logs", "write");
    expectAllowed("TRUNCATE TABLE logs", "full");
  });
});

// ===== LEXER EDGE CASES =====

describe("validateQuery — lexer edge cases", () => {
  it("treats SQL keywords as case-insensitive (select, SELECT, Select)", () => {
    expectAllowed("select * from users", "readonly");
    expectAllowed("SELECT * FROM users", "readonly");
    expectAllowed("Select * From users", "readonly");
  });

  it("blocks mutating statements regardless of casing", () => {
    expectDenied("delete from users", "readonly", "--write");
    expectDenied("Drop Table users", "readonly", "--full");
  });

  it("allows SELECT preceded by line comments", () => {
    expectAllowed("-- a quick lookup\nSELECT * FROM users", "readonly");
  });

  it("allows SELECT preceded by block comments", () => {
    expectAllowed(
      "/* first */ /* second */ SELECT * FROM users",
      "readonly"
    );
  });

  it("does not let leading comments hide a forbidden statement", () => {
    // A user might paste "-- harmless comment\nDROP TABLE users" hoping the
    // comment looks innocuous; the validator must look past the comment to
    // the real keyword and block it.
    expectDenied(
      "-- harmless comment\nDROP TABLE users",
      "readonly",
      "DROP"
    );
  });
});

// ===== EMPTY / MALFORMED INPUT =====

describe("validateQuery — empty input", () => {
  it("rejects an empty string", () => {
    const result = validateQuery("", "readonly");
    expect(result.allowed).toBe(false);
  });

  it("rejects a whitespace-only string", () => {
    const result = validateQuery("   \n  \t  ", "readonly");
    expect(result.allowed).toBe(false);
  });

  it("rejects a comment-only string (no executable statement)", () => {
    const result = validateQuery("-- just a comment\n", "readonly");
    expect(result.allowed).toBe(false);
  });
});

// ===== MULTI-STATEMENT BATCHES =====

describe("validateQuery — multi-statement batches", () => {
  it("allows two SELECTs separated by a semicolon", () => {
    expectAllowed("SELECT 1; SELECT 2;", "readonly");
  });

  it("rejects the entire batch when ANY statement is blocked", () => {
    // The first statement is fine; the second is forbidden. The whole batch
    // must be rejected — we never partially execute.
    expectDenied(
      "SELECT * FROM users; DROP TABLE users;",
      "readonly",
      "DROP"
    );
  });

  it("rejects when the first statement is fine but the LAST is blocked", () => {
    expectDenied(
      "SELECT 1; SELECT 2; DELETE FROM users",
      "readonly",
      "--write"
    );
  });

  it("does not split on a semicolon inside a string literal", () => {
    // The semicolon inside the string is data, not a separator. There is
    // exactly one statement here (a SELECT), and it must be allowed.
    expectAllowed("SELECT 'a;b' AS value", "readonly");
  });

  it("does not split on a semicolon inside a block comment", () => {
    expectAllowed("SELECT 1 /* trailing ; comment */", "readonly");
  });
});
