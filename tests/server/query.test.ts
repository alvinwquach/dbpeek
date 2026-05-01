// ===== FILE PURPOSE =====
// HTTP-level tests for POST /api/query.
//
// STRATEGY:
//   We do not spin up a real database. Instead we pass a mock Knex object
//   (with `raw` stubbed out) into createApp(), bind the resulting Express app
//   to an ephemeral OS port, and make real HTTP requests against it. This
//   exercises the FULL request pipeline — JSON parsing, route matching,
//   permission validation, result normalization, and error mapping — while
//   keeping the tests fast and independent of any installed driver.
//
// WHY real HTTP rather than supertest:
//   The project does not depend on supertest. Node's built-in http.request()
//   is sufficient and matches the strategy already used in server.test.ts,
//   so contributors only need to learn one testing pattern.

import http from "http";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// ===== MODULE MOCK =====
//
// Importing src/server/db.ts (transitively, via server/index.ts) calls
// `import knex from "knex"`, which would try to load the native drivers
// (better-sqlite3, tedious, etc.) at module-load time. Mocking the knex
// default export here means the import resolves to a no-op factory and
// no native code is loaded during the test run.

vi.mock("knex", () => ({
  default: vi.fn().mockReturnValue({
    raw: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { createApp } from "../../src/server/index.js";
import type { Knex } from "../../src/server/db.js";
import type { ConnectionConfig } from "../../src/types/connection.js";

// ===== HELPERS =====

/**
 * Builds a fresh mock Knex instance per test.
 *
 * WHY a factory rather than a shared module-level object:
 *   `raw` is a Vitest spy. Sharing it across tests would let earlier tests'
 *   call counts and mockResolvedValue chains leak into later ones. Each test
 *   gets its own instance so assertions about how many times `raw` was called
 *   are unambiguous.
 */
function buildMockDb(): Knex & { raw: ReturnType<typeof vi.fn> } {
  return {
    raw: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Knex & { raw: ReturnType<typeof vi.fn> };
}

/**
 * Builds a ConnectionConfig for testing with a specific permission mode.
 */
function buildConfig(mode: "readonly" | "write" | "full"): ConnectionConfig {
  return {
    dialect: "postgres",
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "user",
    password: "pass",
    permissionMode: mode,
  };
}

/**
 * Starts an Express app on an ephemeral port and returns the HTTP server and
 * the bound port number.
 *
 * WHY port 0:
 *   The OS assigns a guaranteed-free port, so tests do not collide with each
 *   other or with developer services (port 3000, etc.) when run in parallel.
 *
 * WHY a Promise wrapper around server.listen():
 *   server.listen() signals readiness via a callback and failures via the
 *   "error" event — it does not return a Promise. Wrapping it lets callers
 *   write `await startApp(...)` and receive the bound port only after the
 *   socket is genuinely open.
 */
function startApp(
  db: Knex,
  config: ConnectionConfig
): Promise<{ server: http.Server; port: number }> {
  const app = createApp(config, db);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        return reject(new Error("Unexpected address format"));
      }
      resolve({ server, port: addr.port });
    });
    server.once("error", reject);
  });
}

/**
 * Closes an http.Server. Returns a Promise that resolves once all sockets
 * have drained, so afterEach can reliably wait before the next test starts.
 */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Issues a JSON POST and parses the response body.
 *
 * WHY a Promise wrapper:
 *   http.request() delivers the response body via stream events ("data" /
 *   "end"), not as a Promise. Collecting the chunks inside the Promise
 *   executor lets tests `await postJson(...)` and receive the full body
 *   in one piece without dealing with streams.
 *
 * @param port - the port the test server is bound to.
 * @param path - request path, e.g. "/api/query".
 * @param body - the value sent as JSON, or undefined to omit the body
 *   (used by the "missing body" test). The undefined case still sends a
 *   valid Content-Length: 0 request, which is what real clients do when
 *   they forget to attach a body.
 */
function postJson(
  port: number,
  path: string,
  body: unknown
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => {
          raw += chunk.toString();
        });
        res.on("end", () => {
          // The server always responds with JSON (success or error). If the
          // body somehow fails to parse, surface it through the resolved
          // value so the test can assert on it rather than throwing in a
          // non-test context.
          let data: unknown = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode ?? 0, data });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ===== TEST CLEANUP =====

const openServers: http.Server[] = [];

beforeEach(() => {
  openServers.length = 0;
});

afterEach(async () => {
  // Close all servers in parallel — they bind to different ports so there is
  // no ordering dependency, and parallel teardown shaves test wall time.
  await Promise.all(openServers.map(closeServer));
});

// ===== TESTS =====

describe("POST /api/query — success path", () => {
  it("normalizes a Postgres-shaped result and returns 200 with the canonical envelope", async () => {
    const db = buildMockDb();
    // Postgres returns an object with `.rows` and `.fields`. The route is
    // expected to project the row objects into ordered arrays using the
    // field-name order.
    db.raw.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 2,
      rows: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
      fields: [{ name: "id" }, { name: "name" }],
    });

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT id, name FROM users",
    });

    expect(status).toBe(200);
    expect(data).toMatchObject({
      columns: ["id", "name"],
      rows: [
        [1, "Alice"],
        [2, "Bob"],
      ],
      rowCount: 2,
    });
    // executionTime must be present and a finite number, but we don't pin it
    // to an exact value because real timing varies across machines.
    expect(typeof (data as { executionTime: unknown }).executionTime).toBe(
      "number"
    );
    expect(
      Number.isFinite((data as { executionTime: number }).executionTime)
    ).toBe(true);
  });

  it("normalizes a SQLite-shaped result (plain array of row objects)", async () => {
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce([
      { id: 10, name: "X" },
      { id: 20, name: "Y" },
    ]);

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT id, name FROM things",
    });

    expect(status).toBe(200);
    expect(data).toMatchObject({
      columns: ["id", "name"],
      rows: [
        [10, "X"],
        [20, "Y"],
      ],
      rowCount: 2,
    });
  });

  it("returns an empty envelope when the result is an empty array", async () => {
    // A SELECT that matches no rows returns []. The route should return
    // a valid envelope with rowCount 0, not a 500.
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce([]);

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT id FROM nothing",
    });

    expect(status).toBe(200);
    expect(data).toMatchObject({
      columns: [],
      rows: [],
      rowCount: 0,
    });
  });
});

describe("POST /api/query — permission denial", () => {
  it("returns 403 with the deny reason when SQL is blocked by the mode", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "DELETE FROM users WHERE id = 1",
    });

    expect(status).toBe(403);
    expect(data).toEqual({
      error:
        "DELETE not allowed in read-only mode. Start with --write to enable.",
    });
    // Critically, db.raw must NOT have been called — the permission boundary
    // sits BEFORE the database call.
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("permits writes in write mode but still blocks DROP", async () => {
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce([]); // INSERT response shape (driver-specific)

    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const insertRes = await postJson(port, "/api/query", {
      sql: "INSERT INTO users VALUES (1, 'x')",
    });
    expect(insertRes.status).toBe(200);

    const dropRes = await postJson(port, "/api/query", {
      sql: "DROP TABLE users",
    });
    expect(dropRes.status).toBe(403);
    expect((dropRes.data as { error: string }).error).toContain("--full");
  });
});

describe("POST /api/query — error mapping", () => {
  it("maps a Postgres 'relation does not exist' error to 'Table not found'", async () => {
    const db = buildMockDb();
    db.raw.mockRejectedValueOnce(
      new Error('relation "users" does not exist')
    );

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT * FROM users",
    });

    expect(status).toBe(400);
    expect(data).toEqual({ error: "Table not found: users" });
  });

  it("maps a MySQL 'Unknown column' error to 'Column not found'", async () => {
    const db = buildMockDb();
    db.raw.mockRejectedValueOnce(
      new Error("Unknown column 'name' in 'field list'")
    );

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT name FROM users",
    });

    expect(status).toBe(400);
    expect(data).toEqual({ error: "Column not found: name" });
  });

  it("maps a Postgres 'syntax error at or near' to 'SQL syntax error near'", async () => {
    const db = buildMockDb();
    db.raw.mockRejectedValueOnce(
      new Error('syntax error at or near "FORM"')
    );

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT * FORM users",
    });

    expect(status).toBe(400);
    expect(data).toEqual({ error: "SQL syntax error near: FORM" });
  });
});

// ===== MULTI-STATEMENT EXECUTION =====

describe("POST /api/query — multi-statement execution", () => {
  it("executes two SELECTs sequentially and returns per-statement results in order", async () => {
    // The request contains two SELECT statements separated by a semicolon.
    // The route is expected to:
    //   1. Split them via the SQL-aware tokenizer (no string/comment data
    //      collides with the separator here).
    //   2. Validate the whole batch (both are SELECTs in readonly mode).
    //   3. Execute each through db.raw() in submission order.
    //   4. Return a single JSON envelope containing a `statements` array of
    //      length 2 plus a top-level mirror of the LAST statement.
    const db = buildMockDb();
    db.raw
      .mockResolvedValueOnce([{ n: 1 }])  // result of "SELECT 1 AS n"
      .mockResolvedValueOnce([{ n: 2 }]); // result of "SELECT 2 AS n"

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT 1 AS n; SELECT 2 AS n;",
    });

    expect(status).toBe(200);

    // db.raw must have been called exactly twice — once per statement —
    // and in the order they were submitted. The trim() on the assertion
    // value tolerates the trailing whitespace splitStatements preserves
    // before pushing each chunk; the semantics are unchanged.
    expect(db.raw).toHaveBeenCalledTimes(2);
    const firstCall = (db.raw.mock.calls[0]?.[0] as string).trim();
    const secondCall = (db.raw.mock.calls[1]?.[0] as string).trim();
    expect(firstCall).toBe("SELECT 1 AS n");
    expect(secondCall).toBe("SELECT 2 AS n");

    // The aggregated response carries per-statement details in submission
    // order, with 1-based statementIndex values.
    const body = data as {
      statements: Array<{
        statementIndex: number;
        columns: string[];
        rows: unknown[][];
        rowCount: number;
        executionTime: number;
      }>;
      statementCount: number;
      totalExecutionTime: number;
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    expect(body.statementCount).toBe(2);
    expect(body.statements).toHaveLength(2);
    expect(body.statements[0]?.statementIndex).toBe(1);
    expect(body.statements[0]?.columns).toEqual(["n"]);
    expect(body.statements[0]?.rows).toEqual([[1]]);
    expect(body.statements[1]?.statementIndex).toBe(2);
    expect(body.statements[1]?.columns).toEqual(["n"]);
    expect(body.statements[1]?.rows).toEqual([[2]]);

    // Backward-compat top-level fields mirror the LAST statement's result so
    // legacy clients that ignore `statements` still render something sensible.
    expect(body.columns).toEqual(["n"]);
    expect(body.rows).toEqual([[2]]);
    expect(body.rowCount).toBe(1);
    expect(typeof body.totalExecutionTime).toBe("number");
  });

  it("does not split on semicolons inside string literals, quoted identifiers, or comments", async () => {
    // This test is the security contract: a semicolon that appears inside a
    // string literal, a double-quoted identifier, or a comment is data — NOT
    // a statement separator. Splitting naively here would produce malformed
    // half-statements AND would bypass the permission classifier (which
    // looks at the FIRST keyword of each "statement").
    //
    // The SQL below packs all three cases into one statement:
    //   - 'a;b;c'           — semicolon inside a single-quoted string literal
    //   - "weird;col"       — semicolon inside a double-quoted identifier
    //   - /* drop;table */  — semicolon inside a block comment
    //   - -- one;two\n      — semicolon inside a line comment
    //
    // The whole input is a SINGLE SELECT. The route must call db.raw exactly
    // once and must NOT return a multi-statement envelope.
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce([{ "weird;col": "a;b;c" }]);

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const sql =
      `SELECT 'a;b;c' AS "weird;col" /* drop;table */ -- one;two\n FROM dual`;
    const { status, data } = await postJson(port, "/api/query", { sql });

    expect(status).toBe(200);
    // CRITICAL: exactly one db.raw call. If splitting were naive, this would
    // be 4 (one for each in-data semicolon plus the trailing chunk).
    expect(db.raw).toHaveBeenCalledTimes(1);

    // The single-statement envelope is returned (no `statements` field),
    // which is the backward-compatible shape and the contract that legacy
    // clients depend on.
    const body = data as {
      columns: string[];
      rows: unknown[][];
      statements?: unknown;
    };
    expect(body.columns).toEqual(["weird;col"]);
    expect(body.rows).toEqual([["a;b;c"]]);
    expect(body.statements).toBeUndefined();
  });

  it("stops on the first error and reports the failing statement index", async () => {
    // Three statements: SELECT 1 succeeds, SELECT * FROM missing fails,
    // SELECT 3 must NOT run. The response must:
    //   - return HTTP 400
    //   - put the 1-based index ("Statement 2/3 failed: ...") in the message
    //   - structure that index as a numeric field for programmatic clients
    //   - include `completed` with the result of statement 1
    //   - leave statement 3 untouched (db.raw called exactly twice, never thrice)
    const db = buildMockDb();
    db.raw
      .mockResolvedValueOnce([{ ok: 1 }]) // statement 1 succeeds
      .mockRejectedValueOnce(
        new Error('relation "missing" does not exist')
      ); // statement 2 fails — execution must HALT here

    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT 1; SELECT * FROM missing; SELECT 3;",
    });

    expect(status).toBe(400);

    // Exactly TWO calls — statement 3 is not attempted because we halt on
    // the first runtime error. Asserting !== 3 here would also pass, but
    // pinning to 2 is more precise and would catch a bug where execution
    // continues past the failure.
    expect(db.raw).toHaveBeenCalledTimes(2);

    const body = data as {
      error: string;
      statementIndex: number;
      statementCount: number;
      completed: Array<{ statementIndex: number; rowCount: number }>;
    };
    expect(body.statementIndex).toBe(2);
    expect(body.statementCount).toBe(3);
    // The mapped Postgres "relation does not exist" message becomes
    // "Table not found: missing", and the statement-index prefix is added.
    expect(body.error).toBe(
      "Statement 2/3 failed: Table not found: missing"
    );
    // Statement 1's result is preserved in `completed` so the UI can still
    // show partial output rather than discarding earlier work.
    expect(body.completed).toHaveLength(1);
    expect(body.completed[0]?.statementIndex).toBe(1);
  });
});

describe("POST /api/query — input validation", () => {
  it("returns 400 when sql is missing from the request body", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {});
    expect(status).toBe(400);
    expect((data as { error: string }).error).toContain("sql");
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("returns 400 when sql is an empty string", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status } = await postJson(port, "/api/query", { sql: "" });
    expect(status).toBe(400);
  });

  it("returns 400 when sql is not a string", async () => {
    // Sending a number or object for `sql` is a client bug; the route must
    // reject it without trying to coerce. Coercion would be a footgun: it
    // could turn `{ sql: { drop: 'TABLE users' } }` into a string that
    // happens to start with "[object" (allowed by the validator) but is
    // not what the user intended.
    const db = buildMockDb();
    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status } = await postJson(port, "/api/query", { sql: 42 });
    expect(status).toBe(400);
    expect(db.raw).not.toHaveBeenCalled();
  });
});
