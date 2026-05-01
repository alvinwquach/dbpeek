// ===== FILE PURPOSE =====
// HTTP-level tests for POST /api/explain.
//
// STRATEGY:
//   Mirrors tests/server/query.test.ts — no real database, just a mock Knex
//   whose `raw()` is stubbed per test. We bind createApp() to an ephemeral
//   port and exercise the full route pipeline (validation → dialect dispatch
//   → tree normalization → response). This proves the per-dialect parsers
//   collapse driver-shaped EXPLAIN output into the canonical { type, table,
//   cost, rows, children } envelope, which is what the UI consumes.
//
// COVERAGE:
//   - Postgres: single Seq Scan plan (root cost/rows/table extraction)
//   - Postgres: nested join plan (Plans[] children become tree.children)
//   - MySQL: single-table plan (cost_info.read_cost + access_type folded into type)
//   - MySQL: nested_loop join plan (each entry becomes a child)
//   - Permission enforcement: an INSERT EXPLAIN under --readonly returns 403
//   - Multi-statement input is rejected with a 400
//
// WHY no SQLite/MSSQL tests here:
//   The spec calls for PG and MySQL parser coverage explicitly. SQLite (PRAGMA
//   table-shape) and MSSQL (XML stub) are exercised by the integration test
//   harness when those drivers are present; covering them at the unit level
//   adds little signal for the price of duplicating the HTTP harness.

import http from "http";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Same knex-mock pattern as query.test.ts — prevents the native drivers from
// loading at import time when src/server/index.ts pulls in src/server/db.ts.
vi.mock("knex", () => ({
  default: vi.fn().mockReturnValue({
    raw: vi.fn().mockResolvedValue([]),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { createApp } from "../../src/server/index.js";
import type { Knex } from "../../src/server/db.js";
import type {
  ConnectionConfig,
  Dialect,
  PermissionMode,
} from "../../src/types/connection.js";

// ===== HELPERS =====

/**
 * Builds a per-test mock Knex whose `raw` is a fresh Vitest spy. A fresh
 * instance per test prevents call-count and resolved-value bleed-through.
 */
function buildMockDb(): Knex & { raw: ReturnType<typeof vi.fn> } {
  return {
    raw: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Knex & { raw: ReturnType<typeof vi.fn> };
}

/** ConnectionConfig factory — accepts the dialect/mode under test. */
function buildConfig(dialect: Dialect, mode: PermissionMode): ConnectionConfig {
  return {
    dialect,
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "user",
    password: "pass",
    permissionMode: mode,
  };
}

/**
 * Boots createApp() against an OS-assigned port (port 0). We resolve the
 * Promise only after `listening` fires so the test never races the bind.
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

/** Closes a test server and waits for socket drain. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Same JSON-POST helper as query.test.ts — collects the response body off
 * the stream and returns { status, data }.
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
  await Promise.all(openServers.map(closeServer));
});

// ===== POSTGRES TESTS =====

describe("POST /api/explain — Postgres parser", () => {
  it("normalizes a single Seq Scan plan", async () => {
    const db = buildMockDb();
    // Postgres EXPLAIN (FORMAT JSON) returns a 1-row, 1-col result whose
    // value is `[ { Plan: {...} } ]`. We give it the pg-driver row shape.
    db.raw.mockResolvedValueOnce({
      rows: [
        {
          "QUERY PLAN": [
            {
              Plan: {
                "Node Type": "Seq Scan",
                "Relation Name": "users",
                "Total Cost": 155.0,
                "Plan Rows": 10000,
                "Plan Width": 4,
              },
            },
          ],
        },
      ],
      fields: [{ name: "QUERY PLAN" }],
    });

    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT * FROM users",
    });

    expect(status).toBe(200);
    expect(data).toMatchObject({
      plan: {
        type: "Seq Scan",
        table: "users",
        cost: 155.0,
        rows: 10000,
        children: [],
      },
    });
    // Plan Width should fall through into details (verbatim PG field).
    const plan = (data as { plan: { details: Record<string, unknown> } }).plan;
    expect(plan.details["Plan Width"]).toBe(4);

    // Verify the route called raw() with the EXPLAIN-wrapped SQL — proves the
    // user's query is never executed bare.
    expect(db.raw).toHaveBeenCalledWith(
      expect.stringMatching(/^EXPLAIN \(FORMAT JSON\) SELECT \* FROM users$/)
    );
  });

  it("normalizes a nested Hash Join plan with children", async () => {
    // A typical join plan: Hash Join over a Seq Scan and a Hash node that
    // wraps another Seq Scan. The parser must turn Plans[] into children[].
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce({
      rows: [
        {
          "QUERY PLAN": [
            {
              Plan: {
                "Node Type": "Hash Join",
                "Total Cost": 235.0,
                "Plan Rows": 5000,
                "Hash Cond": "(o.user_id = u.id)",
                Plans: [
                  {
                    "Node Type": "Seq Scan",
                    "Relation Name": "orders",
                    "Total Cost": 80.0,
                    "Plan Rows": 5000,
                  },
                  {
                    "Node Type": "Hash",
                    "Total Cost": 50.0,
                    "Plan Rows": 1000,
                    Plans: [
                      {
                        "Node Type": "Seq Scan",
                        "Relation Name": "users",
                        "Total Cost": 50.0,
                        "Plan Rows": 1000,
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
      fields: [{ name: "QUERY PLAN" }],
    });

    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT * FROM users JOIN orders ON orders.user_id = users.id",
    });

    expect(status).toBe(200);

    const plan = (data as { plan: any }).plan;
    expect(plan.type).toBe("Hash Join");
    expect(plan.cost).toBe(235.0);
    expect(plan.rows).toBe(5000);
    expect(plan.details["Hash Cond"]).toBe("(o.user_id = u.id)");
    expect(plan.children).toHaveLength(2);

    // Parent → child link assertions: the join's first child is the orders
    // scan; the second child is the Hash node, which itself has the users
    // scan as its single child.
    expect(plan.children[0]).toMatchObject({
      type: "Seq Scan",
      table: "orders",
      cost: 80.0,
      rows: 5000,
      children: [],
    });
    expect(plan.children[1]).toMatchObject({
      type: "Hash",
      cost: 50.0,
      children: [
        {
          type: "Seq Scan",
          table: "users",
          cost: 50.0,
          rows: 1000,
        },
      ],
    });
  });
});

// ===== MYSQL TESTS =====

describe("POST /api/explain — MySQL parser", () => {
  it("normalizes a single-table plan and folds access_type into the type label", async () => {
    const db = buildMockDb();
    // MySQL EXPLAIN FORMAT=JSON returns a single VARCHAR column whose value
    // is the JSON document as a string. The mysql2 driver shape is
    // `[rows, fields]`; the row column name is "EXPLAIN".
    const mysqlPayload = JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "3.67" },
        table: {
          table_name: "country",
          access_type: "range",
          possible_keys: ["PRIMARY"],
          key: "PRIMARY",
          rows_examined_per_scan: 17,
          cost_info: {
            read_cost: "1.97",
            eval_cost: "1.70",
            prefix_cost: "3.67",
          },
          attached_condition: "(`world`.`country`.`Code` like 'A%')",
        },
      },
    });
    db.raw.mockResolvedValueOnce([
      [{ EXPLAIN: mysqlPayload }],
      [{ name: "EXPLAIN" }],
    ]);

    const { server, port } = await startApp(
      db,
      buildConfig("mysql", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT Name FROM country WHERE Code LIKE 'A%'",
    });

    expect(status).toBe(200);

    // Root is the synthetic Query Block with the parsed query_cost.
    const plan = (data as { plan: any }).plan;
    expect(plan.type).toBe("Query Block");
    expect(plan.cost).toBe(3.67);

    // Single child = the table node. access_type is folded into the type
    // label so a slow ALL scan stands out without expanding details.
    expect(plan.children).toHaveLength(1);
    const tableNode = plan.children[0];
    expect(tableNode).toMatchObject({
      type: "Table Scan (range)",
      table: "country",
      // read_cost parsed from string "1.97" to number.
      cost: 1.97,
      rows: 17,
      children: [],
    });
    // possible_keys / attached_condition flow into details verbatim.
    expect(tableNode.details.possible_keys).toEqual(["PRIMARY"]);
    expect(tableNode.details.attached_condition).toBe(
      "(`world`.`country`.`Code` like 'A%')"
    );

    // Verify the route used MySQL's EXPLAIN syntax.
    expect(db.raw).toHaveBeenCalledWith(
      expect.stringMatching(/^EXPLAIN FORMAT=JSON /)
    );
  });

  it("expands a nested_loop into multiple children with parent-child structure", async () => {
    const db = buildMockDb();
    const mysqlPayload = JSON.stringify({
      query_block: {
        select_id: 1,
        cost_info: { query_cost: "12.50" },
        nested_loop: [
          {
            table: {
              table_name: "users",
              access_type: "ALL",
              rows_examined_per_scan: 1000,
              cost_info: { read_cost: "5.00" },
            },
          },
          {
            table: {
              table_name: "orders",
              access_type: "ref",
              rows_examined_per_scan: 5,
              cost_info: { read_cost: "2.50" },
            },
          },
        ],
      },
    });
    db.raw.mockResolvedValueOnce([
      [{ EXPLAIN: mysqlPayload }],
      [{ name: "EXPLAIN" }],
    ]);

    const { server, port } = await startApp(
      db,
      buildConfig("mysql", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT * FROM users JOIN orders ON orders.user_id = users.id",
    });

    expect(status).toBe(200);

    const plan = (data as { plan: any }).plan;
    expect(plan.cost).toBe(12.5);
    // Two nested_loop entries → two children, in source order.
    expect(plan.children).toHaveLength(2);
    expect(plan.children[0]).toMatchObject({
      type: "Table Scan (ALL)",
      table: "users",
      cost: 5.0,
      rows: 1000,
    });
    expect(plan.children[1]).toMatchObject({
      type: "Table Scan (ref)",
      table: "orders",
      cost: 2.5,
      rows: 5,
    });
  });
});

// ===== PERMISSION + INPUT GUARDS =====

describe("POST /api/explain — guards", () => {
  it("rejects EXPLAIN of an INSERT under --readonly with 403", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "INSERT INTO users (name) VALUES ('x')",
    });

    expect(status).toBe(403);
    // The denial message format is owned by permissions.ts — we just assert
    // the keyword appears so the message is recognizable to the user.
    expect((data as { error: string }).error).toMatch(/INSERT/);
    // db.raw must NOT have been invoked — the validator rejects before dispatch.
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("rejects multi-statement input with 400 (single statement only)", async () => {
    const db = buildMockDb();
    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT 1; SELECT 2",
    });

    expect(status).toBe(400);
    expect((data as { error: string }).error).toMatch(/single statement/i);
    expect(db.raw).not.toHaveBeenCalled();
  });

  it("accepts a single trailing semicolon (ergonomic tolerance)", async () => {
    // Trailing ';' is so common in pasted SQL that requiring its absence would
    // be a footgun. The route strips one and proceeds.
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce({
      rows: [
        {
          "QUERY PLAN": [
            {
              Plan: {
                "Node Type": "Result",
                "Total Cost": 0.01,
                "Plan Rows": 1,
              },
            },
          ],
        },
      ],
      fields: [{ name: "QUERY PLAN" }],
    });

    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status } = await postJson(port, "/api/explain", {
      sql: "SELECT 1;",
    });
    expect(status).toBe(200);
  });

  it("returns 400 with a wrapped message when the driver throws", async () => {
    const db = buildMockDb();
    db.raw.mockRejectedValueOnce(new Error('relation "nope" does not exist'));

    const { server, port } = await startApp(
      db,
      buildConfig("postgres", "readonly")
    );
    openServers.push(server);

    const { status, data } = await postJson(port, "/api/explain", {
      sql: "SELECT * FROM nope",
    });

    expect(status).toBe(400);
    expect((data as { error: string }).error).toMatch(/EXPLAIN failed:/);
    expect((data as { error: string }).error).toMatch(/relation "nope"/);
  });
});
