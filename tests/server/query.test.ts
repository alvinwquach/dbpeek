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
import type { PermissionMode } from "../../src/types/connection.js";

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
  mode: PermissionMode
): Promise<{ server: http.Server; port: number }> {
  const app = createApp(db, mode);
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

    const { server, port } = await startApp(db, "readonly");
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

    const { server, port } = await startApp(db, "readonly");
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

    const { server, port } = await startApp(db, "readonly");
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
    const { server, port } = await startApp(db, "readonly");
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

    const { server, port } = await startApp(db, "write");
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

    const { server, port } = await startApp(db, "readonly");
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

    const { server, port } = await startApp(db, "readonly");
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

    const { server, port } = await startApp(db, "readonly");
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {
      sql: "SELECT * FORM users",
    });

    expect(status).toBe(400);
    expect(data).toEqual({ error: "SQL syntax error near: FORM" });
  });
});

describe("POST /api/query — input validation", () => {
  it("returns 400 when sql is missing from the request body", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(db, "readonly");
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/query", {});
    expect(status).toBe(400);
    expect((data as { error: string }).error).toContain("sql");
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("returns 400 when sql is an empty string", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(db, "readonly");
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
    const { server, port } = await startApp(db, "readonly");
    openServers.push(server);

    const { status } = await postJson(port, "/api/query", { sql: 42 });
    expect(status).toBe(400);
    expect(db.raw).not.toHaveBeenCalled();
  });
});
