// ===== FILE PURPOSE =====
// HTTP-level tests for GET /api/schema and GET /api/schema/:table.
//
// STRATEGY:
//   We do not spin up real databases for the four dialects. Instead each test
//   constructs a mock Knex instance whose `raw()` method inspects the SQL
//   string and returns the SHAPE that the matching real driver would produce:
//     - Postgres → { rows, fields }
//     - MySQL    → [rows, fields]
//     - SQLite   → plain row array
//     - MSSQL    → plain row array
//
//   This is the same pattern used by tests/server/query.test.ts. It exercises
//   the full HTTP pipeline (routing, JSON serialization, error handling) and
//   verifies that each dialect handler correctly:
//     1. Sends the right SQL.
//     2. Parses the dialect-specific result shape.
//     3. Produces the canonical { tables: [...] } / { columns: [...] }
//        response envelope the UI expects.
//
// WHY a string-matching mock instead of a per-test stub list:
//   The SQLite list-tables flow alone fires N+1 queries (one for the table
//   list plus one COUNT per table). A flat `mockResolvedValueOnce` chain
//   would couple the test to the implementation's call order. Matching on
//   distinguishing SQL keywords ("pg_tables", "PRAGMA table_info", etc.)
//   makes tests robust to handler refactors.

import http from "http";
import { describe, it, expect, afterEach, vi } from "vitest";

// ===== MODULE MOCK =====
// Mock knex so importing db.ts does not load native drivers at test time.

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
} from "../../src/types/connection.js";

// ===== HELPERS =====

/**
 * Builds a ConnectionConfig with a specific dialect for testing.
 *
 * WHY only the dialect is parameterized:
 *   The schema route only inspects `config.dialect` to pick a handler.
 *   The other fields (host, port, etc.) don't affect routing behavior;
 *   we keep them at sensible localhost defaults so each test reads as a
 *   one-line "this is the dialect under test."
 */
function buildConfig(dialect: Dialect): ConnectionConfig {
  return {
    dialect,
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "user",
    password: "pass",
    permissionMode: "readonly",
  };
}

/**
 * Builds a mock Knex object whose `raw` method dispatches to a handler
 * function based on the SQL string. The handler is chosen by the test —
 * each test names which "shape" of database it is simulating.
 *
 * @param handler - Receives the SQL string and any bindings, returns the
 *   driver-shaped result the test wants to simulate (or throws to simulate
 *   a database error).
 */
function buildMockDb(
  handler: (sql: string, bindings?: unknown[]) => unknown
): Knex {
  return {
    raw: vi.fn(async (sql: string, bindings?: unknown[]) => handler(sql, bindings)),
    destroy: vi.fn(),
  } as unknown as Knex;
}

/**
 * Starts the Express app on an ephemeral port. Same wrapper used by the
 * other route test files.
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
 * Closes an http.Server, returning a Promise so afterEach can await it.
 */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * GETs a path and returns { status, data }.
 *
 * WHY a fresh function instead of importing a shared helper:
 *   The other route test files inline the same helper. Repeating it here
 *   keeps each test file self-contained and avoids creating a shared
 *   "test utilities" module that everyone has to learn.
 */
function getJson(
  port: number,
  path: string
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET" },
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
    req.end();
  });
}

// ===== TEST CLEANUP =====

const openServers: http.Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.map(closeServer));
  openServers.length = 0;
});

// ===== POSTGRES TESTS =====
//
// The mock returns Postgres-shaped { rows, fields } envelopes. Field names
// map to the column aliases used in the handler queries (name, row_count,
// type, nullable, default_value, ref_table, ref_column).

describe("GET /api/schema — Postgres", () => {
  it("returns the canonical { tables: [{name, rowCount}] } envelope", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("pg_tables")) {
        return {
          rows: [
            { name: "users", row_count: "100" }, // pg returns bigint as string
            { name: "orders", row_count: "50" },
          ],
          fields: [{ name: "name" }, { name: "row_count" }],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("postgres"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema");
    expect(status).toBe(200);
    expect(data).toEqual({
      tables: [
        { name: "users", rowCount: 100 },
        { name: "orders", rowCount: 50 },
      ],
    });
  });

  it("returns column metadata with PK/FK/index flags for /api/schema/:table", async () => {
    const db = buildMockDb((sql) => {
      // listTables (whitelist check)
      if (sql.includes("pg_tables")) {
        return {
          rows: [{ name: "users", row_count: "100" }],
          fields: [{ name: "name" }, { name: "row_count" }],
        };
      }
      // Column metadata
      if (sql.includes("information_schema.columns")) {
        return {
          rows: [
            {
              name: "id",
              type: "integer",
              nullable: "NO",
              default_value: "nextval('users_id_seq'::regclass)",
            },
            {
              name: "email",
              type: "text",
              nullable: "NO",
              default_value: null,
            },
            {
              name: "team_id",
              type: "integer",
              nullable: "YES",
              default_value: null,
            },
          ],
          fields: [],
        };
      }
      // Primary keys
      if (
        sql.includes("constraint_type = 'PRIMARY KEY'") ||
        sql.includes("'PRIMARY KEY'")
      ) {
        return { rows: [{ name: "id" }], fields: [] };
      }
      // Foreign keys
      if (sql.includes("constraint_type = 'FOREIGN KEY'")) {
        return {
          rows: [{ name: "team_id", ref_table: "teams", ref_column: "id" }],
          fields: [],
        };
      }
      // Indexes
      if (sql.includes("pg_index")) {
        return {
          rows: [{ name: "id" }, { name: "email" }],
          fields: [],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("postgres"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema/users");
    expect(status).toBe(200);
    expect(data).toEqual({
      columns: [
        {
          name: "id",
          type: "integer",
          nullable: false,
          defaultValue: "nextval('users_id_seq'::regclass)",
          isPrimaryKey: true,
          foreignKey: null,
          isIndexed: true,
        },
        {
          name: "email",
          type: "text",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: null,
          isIndexed: true,
        },
        {
          name: "team_id",
          type: "integer",
          nullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: { table: "teams", column: "id" },
          isIndexed: false,
        },
      ],
    });
  });
});

// ===== MYSQL TESTS =====
//
// The mock returns MySQL-shaped [rows, fields] tuples — that is what the
// mysql2 driver (used by knex.raw) returns for SELECT statements.

describe("GET /api/schema — MySQL", () => {
  it("returns tables with row counts pulled from information_schema", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("information_schema.tables")) {
        return [
          [
            { name: "users", row_count: 42 },
            { name: "orders", row_count: 17 },
          ],
          [{ name: "name" }, { name: "row_count" }],
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("mysql"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema");
    expect(status).toBe(200);
    expect(data).toEqual({
      tables: [
        { name: "users", rowCount: 42 },
        { name: "orders", rowCount: 17 },
      ],
    });
  });

  it("returns column metadata for /api/schema/:table", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("information_schema.tables")) {
        return [[{ name: "users", row_count: 1 }], []];
      }
      if (sql.includes("information_schema.columns")) {
        return [
          [
            {
              name: "id",
              type: "int(11)",
              nullable: "NO",
              default_value: null,
            },
            {
              name: "email",
              type: "varchar(255)",
              nullable: "NO",
              default_value: null,
            },
          ],
          [],
        ];
      }
      if (sql.includes("CONSTRAINT_NAME = 'PRIMARY'")) {
        return [[{ name: "id" }], []];
      }
      if (sql.includes("REFERENCED_TABLE_NAME IS NOT NULL")) {
        return [[], []];
      }
      if (sql.includes("information_schema.statistics")) {
        return [[{ name: "id" }, { name: "email" }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("mysql"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema/users");
    expect(status).toBe(200);
    expect(data).toEqual({
      columns: [
        {
          name: "id",
          type: "int(11)",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          foreignKey: null,
          isIndexed: true,
        },
        {
          name: "email",
          type: "varchar(255)",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: null,
          isIndexed: true,
        },
      ],
    });
  });
});

// ===== SQLITE TESTS =====
//
// SQLite returns plain arrays of row objects from knex.raw() (better-sqlite3
// driver behavior). The list-tables flow is N+1: one query for the table
// list plus one COUNT(*) per table. The describe flow uses PRAGMA statements.

describe("GET /api/schema — SQLite", () => {
  it("returns tables with exact row counts from per-table COUNT(*)", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("sqlite_master")) {
        return [{ name: "users" }, { name: "orders" }];
      }
      // The handler quotes the table name as 'users' / 'orders'. We match
      // on the COUNT keyword and the quoted name to dispatch.
      if (sql.includes("COUNT(*)") && sql.includes("'users'")) {
        return [{ c: 5 }];
      }
      if (sql.includes("COUNT(*)") && sql.includes("'orders'")) {
        return [{ c: 3 }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("sqlite"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema");
    expect(status).toBe(200);
    expect(data).toEqual({
      tables: [
        { name: "users", rowCount: 5 },
        { name: "orders", rowCount: 3 },
      ],
    });
  });

  it("describes columns via PRAGMA table_info / foreign_key_list / index_list", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("sqlite_master")) {
        return [{ name: "users" }];
      }
      if (sql.startsWith("SELECT COUNT(*)")) {
        return [{ c: 1 }];
      }
      if (sql.startsWith("PRAGMA table_info")) {
        return [
          {
            cid: 0,
            name: "id",
            type: "INTEGER",
            notnull: 1,
            dflt_value: null,
            pk: 1,
          },
          {
            cid: 1,
            name: "team_id",
            type: "INTEGER",
            notnull: 0,
            dflt_value: null,
            pk: 0,
          },
          {
            cid: 2,
            name: "name",
            type: "TEXT",
            notnull: 0,
            dflt_value: "''",
            pk: 0,
          },
        ];
      }
      if (sql.startsWith("PRAGMA foreign_key_list")) {
        return [{ from: "team_id", table: "teams", to: "id" }];
      }
      if (sql.startsWith("PRAGMA index_list")) {
        return [{ name: "idx_users_team" }];
      }
      if (sql.startsWith("PRAGMA index_info")) {
        return [{ name: "team_id" }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("sqlite"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema/users");
    expect(status).toBe(200);
    expect(data).toEqual({
      columns: [
        {
          name: "id",
          type: "INTEGER",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          foreignKey: null,
          isIndexed: false,
        },
        {
          name: "team_id",
          type: "INTEGER",
          nullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: { table: "teams", column: "id" },
          isIndexed: true,
        },
        {
          name: "name",
          type: "TEXT",
          nullable: true,
          defaultValue: "''",
          isPrimaryKey: false,
          foreignKey: null,
          isIndexed: false,
        },
      ],
    });
  });
});

// ===== MSSQL TESTS =====
//
// The tedious driver (used by knex for MSSQL) returns plain row arrays from
// knex.raw(), same shape as SQLite from knex's perspective.

describe("GET /api/schema — MSSQL", () => {
  it("returns tables with row counts from sys.partitions", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("sys.tables") && sql.includes("sys.partitions")) {
        return [
          { name: "users", row_count: 200 },
          { name: "orders", row_count: 30 },
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("mssql"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema");
    expect(status).toBe(200);
    expect(data).toEqual({
      tables: [
        { name: "users", rowCount: 200 },
        { name: "orders", rowCount: 30 },
      ],
    });
  });

  it("returns column metadata from sys.columns + sys.indexes for /api/schema/:table", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("sys.tables") && sql.includes("sys.partitions")) {
        return [{ name: "users", row_count: 1 }];
      }
      if (sql.includes("sys.columns") && sql.includes("TYPE_NAME")) {
        return [
          {
            name: "id",
            type: "int",
            nullable: false,
            default_value: null,
          },
          {
            name: "name",
            type: "nvarchar",
            nullable: true,
            default_value: null,
          },
        ];
      }
      if (sql.includes("is_primary_key = 1")) {
        return [{ name: "id" }];
      }
      if (sql.includes("sys.foreign_key_columns")) {
        return [];
      }
      // Generic indexes query (catch-all for any-index lookup)
      if (sql.includes("sys.indexes") && sql.includes("DISTINCT")) {
        return [{ name: "id" }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("mssql"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema/users");
    expect(status).toBe(200);
    expect(data).toEqual({
      columns: [
        {
          name: "id",
          type: "int",
          nullable: false,
          defaultValue: null,
          isPrimaryKey: true,
          foreignKey: null,
          isIndexed: true,
        },
        {
          name: "name",
          type: "nvarchar",
          nullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          foreignKey: null,
          isIndexed: false,
        },
      ],
    });
  });
});

// ===== 404 TEST =====
//
// One representative test confirms the whitelist 404 path. The whitelist is
// dialect-agnostic (the same code path runs regardless of which handler is
// active), so testing it once on Postgres is sufficient — adding three more
// near-identical tests would only verify that listTables works (which the
// per-dialect tests above already cover).

describe("GET /api/schema/:table — 404 handling", () => {
  it("returns 404 when the requested table is not in the database", async () => {
    const db = buildMockDb((sql) => {
      if (sql.includes("pg_tables")) {
        return {
          rows: [{ name: "users", row_count: "1" }],
          fields: [],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { server, port } = await startApp(db, buildConfig("postgres"));
    openServers.push(server);

    const { status, data } = await getJson(port, "/api/schema/ghost");
    expect(status).toBe(404);
    expect(data).toEqual({ error: "Table not found: ghost" });
  });
});
