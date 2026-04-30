import { describe, it, expect } from "vitest";
import { validateStatement, PermissionError } from "../../src/server/permissions.js";

describe("validateStatement", () => {
  it("allows SELECT statements", () => {
    expect(() => validateStatement("SELECT * FROM users")).not.toThrow();
  });

  it("allows SELECT with leading whitespace", () => {
    expect(() => validateStatement("  \n  SELECT id FROM orders")).not.toThrow();
  });

  it("allows SHOW statements (MySQL schema inspection)", () => {
    expect(() => validateStatement("SHOW TABLES")).not.toThrow();
  });

  it("allows EXPLAIN statements", () => {
    expect(() => validateStatement("EXPLAIN SELECT * FROM logs")).not.toThrow();
  });

  it("allows WITH (CTE) statements", () => {
    expect(() => validateStatement("WITH cte AS (SELECT 1) SELECT * FROM cte")).not.toThrow();
  });

  it("blocks INSERT", () => {
    expect(() => validateStatement("INSERT INTO users VALUES (1, 'x')")).toThrow(PermissionError);
  });

  it("blocks UPDATE", () => {
    expect(() => validateStatement("UPDATE users SET name = 'x'")).toThrow(PermissionError);
  });

  it("blocks DELETE", () => {
    expect(() => validateStatement("DELETE FROM users WHERE id = 1")).toThrow(PermissionError);
  });

  it("blocks DROP", () => {
    expect(() => validateStatement("DROP TABLE users")).toThrow(PermissionError);
  });

  it("blocks TRUNCATE", () => {
    expect(() => validateStatement("TRUNCATE TABLE users")).toThrow(PermissionError);
  });

  it("blocks mutating statements regardless of casing", () => {
    expect(() => validateStatement("insert into users values (1)")).toThrow(PermissionError);
    expect(() => validateStatement("Delete FROM users")).toThrow(PermissionError);
  });

  it("blocks statements with leading SQL comments", () => {
    // A leading comment must not be used to hide the real statement type.
    expect(() => validateStatement("-- comment\nDROP TABLE users")).toThrow(PermissionError);
  });

  it("blocks empty statements", () => {
    expect(() => validateStatement("")).toThrow(PermissionError);
    expect(() => validateStatement("   ")).toThrow(PermissionError);
  });
});
