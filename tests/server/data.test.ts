// ===== FILE PURPOSE =====
// HTTP-level tests for PUT /api/data/:table — the cell-edit endpoint.
//
// COVERAGE GOALS:
//   1. Permission gating: 403 in --readonly; success in --write and --full.
//   2. Whitelist failures: every guard in the route has a test.
//      - Table not found (404).
//      - Column not on the table (400).
//      - Table has no primary key (400).
//      - pk includes a non-PK column (400).
//      - pk is missing a real PK column (400).
//   3. Body validation: missing body, wrong types, empty pk.
//   4. Happy paths:
//      - Single-column PK end-to-end (verifies response envelope + that the
//        Knex query builder is invoked with the correct table / where / set).
//      - Composite-key PK: WHERE includes both PK columns AND-joined.
//   5. Database error propagation: a thrown error from the query builder
//      surfaces as a 400 with the driver message.
//
// STRATEGY:
//   The route has TWO interaction shapes with Knex:
//     a) `db.raw(sql, bindings)` — the schema handler's listTables /
//        describeTable run through this. We mock it via a per-test SQL
//        dispatcher (same pattern as tests/server/schema.test.ts).
//     b) `db(table).where(pk).update({ col: value })` — the actual update
//        runs through the Knex builder. We mock the callable form of `db`
//        with a small stub that returns a chainable { where, update }
//        object, so tests can both stub the row count and assert that the
//        right table/where/values reached the builder.
//
// WHY this approach:
//   It exercises the FULL route pipeline (permission gating → URL whitelist
//   → column whitelist → PK whitelist → builder call → response shape) with
//   no real database. The same patterns are used by the existing query and
//   schema test files, so the test conventions are uniform across the repo.

import http from "http";
import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  vi,
} from "vitest";

// ===== MODULE MOCK =====
//
// Same reasoning as query.test.ts and schema.test.ts: importing the server
// transitively pulls in db.ts, which loads native drivers at module-time.
// Mocking knex's default factory lets the import resolve without those
// drivers being present.

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
  PermissionMode,
} from "../../src/types/connection.js";

// ===== TYPES =====

/**
 * Captured snapshot of one builder-chain call. Pushed onto a per-mock array
 * each time the route resolves the builder's `update()`. Tests inspect it to
 * verify the correct identifiers reached Knex.
 *
 * WHY a snapshot array instead of vi.fn assertions:
 *   The chain is `db(table).where(pk).update(values)` — three separate calls
 *   that vi.fn would track on different mocks. Recording the full triple in
 *   one struct keeps each test's "given X, expect builder was called with
 *   {table: A, where: B, values: C}" assertion on a single line.
 */
interface BuilderCall {
  table: string;
  where: Record<string, unknown> | null;
  values: Record<string, unknown> | null;
}

// ===== HELPERS =====

/**
 * Builds a ConnectionConfig with the given permission mode. Postgres is the
 * default dialect because schema.test.ts already covers per-dialect handler
 * dispatch — this file's focus is the data route's own logic, not handler
 * coverage.
 */
function buildConfig(mode: PermissionMode): ConnectionConfig {
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
 * Constructs a mock Knex instance that responds to BOTH the `.raw()` form
 * (used by the schema handlers) AND the callable form `db(table).where(...)
 * .update(...)` (used by the route to fire the actual UPDATE).
 *
 * @param opts.tables  - Table list returned by handler.listTables().
 *                       Provide just the names; the helper pads with the
 *                       row_count field the postgres handler expects.
 * @param opts.columns - Per-table column metadata returned by
 *                       handler.describeTable(). Each entry pre-shaped to
 *                       what the postgres handler's information_schema
 *                       query returns (lower-cased keys).
 * @param opts.pks     - Per-table primary-key column-name list. Becomes the
 *                       result of the route's PK whitelist query.
 * @param opts.updateImpl - Optional: replaces the default update behaviour
 *                       (which returns 1). Use for error simulation or
 *                       multi-row scenarios.
 *
 * @returns The mock Knex object plus a `calls` array that captures every
 *   builder chain that reached `update()`. Tests assert on `calls[0]` to
 *   verify the route forwarded the right table / where / values.
 */
function buildMockDb(opts: {
  tables: string[];
  columns: Record<string, Array<{ name: string; type: string }>>;
  pks: Record<string, string[]>;
  updateImpl?: (
    table: string,
    where: Record<string, unknown>,
    values: Record<string, unknown>
  ) => Promise<number> | number;
}): Knex & { calls: BuilderCall[] } {
  const calls: BuilderCall[] = [];

  // ── db.raw stub: dispatches based on SQL keywords. ─────────────────────
  // The route only needs the postgres handler's listTables and the parts
  // of describeTable that produce columns + PK list. FK and index queries
  // are answered with empty arrays — the route doesn't read them.
  const raw = vi.fn(async (sql: string, bindings?: unknown[]) => {
    // listTables: postgres handler joins pg_tables + pg_class.
    if (sql.includes("pg_tables")) {
      return {
        rows: opts.tables.map((name) => ({
          name,
          row_count: "0",
        })),
        fields: [],
      };
    }
    // describeTable: column metadata (information_schema.columns).
    if (sql.includes("information_schema.columns")) {
      const tableName = (bindings?.[0] as string | undefined) ?? "";
      const cols = opts.columns[tableName] ?? [];
      return {
        rows: cols.map((c) => ({
          name: c.name,
          type: c.type,
          nullable: "YES",
          default_value: null,
        })),
        fields: [],
      };
    }
    // describeTable: primary keys.
    if (sql.includes("'PRIMARY KEY'")) {
      const tableName = (bindings?.[0] as string | undefined) ?? "";
      const pks = opts.pks[tableName] ?? [];
      return {
        rows: pks.map((name) => ({ name })),
        fields: [],
      };
    }
    // describeTable: foreign keys / indexes. Return empty for both — the
    // route only consults isPrimaryKey, so the other sets don't matter.
    if (sql.includes("'FOREIGN KEY'")) return { rows: [], fields: [] };
    if (sql.includes("pg_index")) return { rows: [], fields: [] };
    throw new Error(`Unexpected raw SQL: ${sql}`);
  });

  // ── db(table) callable: returns a chainable update builder. ────────────
  // The route does:    await db(table).where(pk).update({ col: value })
  // We capture all three pieces in `calls` so tests can verify them.
  const dbFn = function dbFn(table: string) {
    let capturedWhere: Record<string, unknown> | null = null;
    const builder = {
      where(w: Record<string, unknown>) {
        capturedWhere = w;
        return builder;
      },
      async update(values: Record<string, unknown>) {
        calls.push({ table, where: capturedWhere, values });
        if (opts.updateImpl) {
          return await opts.updateImpl(
            table,
            capturedWhere ?? {},
            values
          );
        }
        return 1;
      },
    };
    return builder;
  } as unknown as Knex;

  // Attach raw + destroy onto the callable so the object also looks like a
  // full Knex instance for the schema handler's purposes.
  Object.assign(dbFn, {
    raw,
    destroy: vi.fn(),
    transaction: vi.fn(),
    calls,
  });

  return dbFn as Knex & { calls: BuilderCall[] };
}

/**
 * Starts the Express app on an ephemeral port. Same pattern as the
 * existing route test files.
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

/** Closes an http.Server, returning a Promise so afterEach can await it. */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Issues a JSON PUT and returns the parsed response.
 *
 * WHY a fresh helper rather than reusing one from query.test.ts:
 *   query.test.ts uses POST. Adding a method parameter to that helper would
 *   force every existing call site to pass "POST". Inlining a small PUT
 *   helper here keeps both files self-contained.
 */
function putJson(
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
        method: "PUT",
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

// ===== PERMISSION GATING =====

describe("PUT /api/data/:table — permission gating", () => {
  it("returns 403 in readonly mode and never invokes the builder", async () => {
    // The mock has a fully populated schema. If the readonly gate ever
    // accidentally falls through, the builder would run and `calls` would
    // be non-empty — that's the regression this test is guarding against.
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("readonly"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "x@y.z",
      pk: { id: 1 },
    });

    expect(status).toBe(403);
    // The error must mention --write so the user knows how to enable editing.
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain("--write");
    }
    // Builder must NOT have been called — the permission gate runs FIRST.
    expect(db.calls).toEqual([]);
  });

  it("succeeds in write mode", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "new@example.com",
      pk: { id: 1 },
    });
    expect(status).toBe(200);
    expect(db.calls).toHaveLength(1);
  });

  it("succeeds in full mode", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("full"));
    openServers.push(server);

    const { status } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "new@example.com",
      pk: { id: 1 },
    });
    expect(status).toBe(200);
    expect(db.calls).toHaveLength(1);
  });
});

// ===== WHITELIST FAILURES =====

describe("PUT /api/data/:table — whitelist failures", () => {
  it("returns 404 when the table does not exist", async () => {
    // Schema lists only "users" — a request for "ghosts" must be rejected
    // BEFORE describeTable runs. (If it ran, the test setup would happily
    // return an empty column list and the route would 400 instead of 404.)
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/ghosts", {
      column: "id",
      value: 1,
      pk: { id: 1 },
    });
    expect(status).toBe(404);
    expect(data).toEqual({ error: "Table not found: ghosts" });
    expect(db.calls).toEqual([]);
  });

  it("returns 400 when the column is not on the table", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/users", {
      column: "nonexistent_col",
      value: "x",
      pk: { id: 1 },
    });
    expect(status).toBe(400);
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain(
        "nonexistent_col"
      );
    }
    expect(db.calls).toEqual([]);
  });

  it("returns 400 when the table has no primary key", async () => {
    // A user-facing error mentioning "no primary key" gives the user an
    // actionable next step. Guarded against here because the cell-edit
    // flow's whole reason for existing is keying on PK.
    const db = buildMockDb({
      tables: ["logs"],
      columns: { logs: [{ name: "message", type: "text" }] },
      pks: { logs: [] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/logs", {
      column: "message",
      value: "x",
      pk: { rowid: 1 },
    });
    expect(status).toBe(400);
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain(
        "no primary key"
      );
    }
    expect(db.calls).toEqual([]);
  });

  it("returns 400 when pk includes a non-PK column", async () => {
    // The user tried to identify the row by `email = 'x'`. email is a real
    // column but isn't a PK. UPDATE … WHERE email = 'x' could match more
    // than one row, so we refuse rather than risk a multi-row update.
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }, { name: "email", type: "text" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "x@y.z",
      pk: { email: "old@y.z" },
    });
    expect(status).toBe(400);
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain("email");
    }
    expect(db.calls).toEqual([]);
  });

  it("returns 400 when pk is missing a real primary-key column", async () => {
    // Composite PK (a, b). A request specifying only `{ a: 1 }` would make
    // WHERE a = 1 match every row sharing that `a` — so the route must
    // require ALL pk columns and refuse the partial key.
    const db = buildMockDb({
      tables: ["junction"],
      columns: {
        junction: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
          { name: "note", type: "text" },
        ],
      },
      pks: { junction: ["a", "b"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/junction", {
      column: "note",
      value: "hi",
      pk: { a: 1 }, // Missing b.
    });
    expect(status).toBe(400);
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain("b");
    }
    expect(db.calls).toEqual([]);
  });
});

// ===== BODY VALIDATION =====

describe("PUT /api/data/:table — body validation", () => {
  it("returns 400 when column is not a non-empty string", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    // column is a number — wrong type.
    const r1 = await putJson(port, "/api/data/users", {
      column: 42,
      value: "x",
      pk: { id: 1 },
    });
    expect(r1.status).toBe(400);

    // column is an empty string.
    const r2 = await putJson(port, "/api/data/users", {
      column: "",
      value: "x",
      pk: { id: 1 },
    });
    expect(r2.status).toBe(400);
  });

  it("returns 400 when pk is not a plain object", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    // pk is an array — must be an object.
    const r1 = await putJson(port, "/api/data/users", {
      column: "id",
      value: 1,
      pk: [1, 2],
    });
    expect(r1.status).toBe(400);

    // pk is null.
    const r2 = await putJson(port, "/api/data/users", {
      column: "id",
      value: 1,
      pk: null,
    });
    expect(r2.status).toBe(400);
  });

  it("returns 400 when pk is an empty object", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: { users: [{ name: "id", type: "integer" }] },
      pks: { users: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status } = await putJson(port, "/api/data/users", {
      column: "id",
      value: 1,
      pk: {},
    });
    expect(status).toBe(400);
  });
});

// ===== HAPPY PATHS =====

describe("PUT /api/data/:table — single-PK happy path", () => {
  it("returns the canonical envelope and forwards the right where/values", async () => {
    const db = buildMockDb({
      tables: ["users"],
      columns: {
        users: [
          { name: "id", type: "integer" },
          { name: "email", type: "text" },
        ],
      },
      pks: { users: ["id"] },
      // Simulate the driver reporting one row affected, which is the
      // expected outcome when the PK matches exactly one row.
      updateImpl: () => 1,
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "new@example.com",
      pk: { id: 42 },
    });

    expect(status).toBe(200);
    // Response envelope contract: rowsAffected (number), executionTime
    // (number), sql (display string with dialect-correct quoting).
    expect(data).toMatchObject({
      rowsAffected: 1,
    });
    if (typeof data === "object" && data !== null) {
      const body = data as Record<string, unknown>;
      expect(typeof body.executionTime).toBe("number");
      expect(typeof body.sql).toBe("string");
      // The display SQL string must be dialect-correctly quoted (Postgres
      // double-quotes here) AND inline the value as a SQL literal.
      expect(body.sql).toBe(
        `UPDATE "users" SET "email" = 'new@example.com' WHERE "id" = 42`
      );
    }

    // The Knex builder must have been called exactly once with the right
    // table, where, and values — that's the one user-visible side effect
    // of this route.
    expect(db.calls).toEqual([
      {
        table: "users",
        where: { id: 42 },
        values: { email: "new@example.com" },
      },
    ]);
  });

  it("renders NULL / TRUE / FALSE as bare keywords in the display SQL", async () => {
    // Dialect-aware literal formatting is part of the response contract.
    // null → NULL, true → TRUE, false → FALSE — bare keywords, not quoted.
    const db = buildMockDb({
      tables: ["flags"],
      columns: {
        flags: [
          { name: "id", type: "integer" },
          { name: "active", type: "boolean" },
        ],
      },
      pks: { flags: ["id"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const r = await putJson(port, "/api/data/flags", {
      column: "active",
      value: null,
      pk: { id: 7 },
    });
    expect(r.status).toBe(200);
    if (typeof r.data === "object" && r.data !== null) {
      expect((r.data as { sql: string }).sql).toBe(
        `UPDATE "flags" SET "active" = NULL WHERE "id" = 7`
      );
    }

    const r2 = await putJson(port, "/api/data/flags", {
      column: "active",
      value: true,
      pk: { id: 8 },
    });
    expect(r2.status).toBe(200);
    if (typeof r2.data === "object" && r2.data !== null) {
      expect((r2.data as { sql: string }).sql).toBe(
        `UPDATE "flags" SET "active" = TRUE WHERE "id" = 8`
      );
    }
  });
});

describe("PUT /api/data/:table — composite-PK happy path", () => {
  it("AND-joins both pk columns in the WHERE clause", async () => {
    // The display SQL for `(a, b) = (1, 2)` is:
    //   UPDATE "junction" SET "note" = 'hi' WHERE "a" = 1 AND "b" = 2
    // The builder receives the entire pk object as the where clause,
    // which Knex will translate into the same AND-joined predicate.
    const db = buildMockDb({
      tables: ["junction"],
      columns: {
        junction: [
          { name: "a", type: "integer" },
          { name: "b", type: "integer" },
          { name: "note", type: "text" },
        ],
      },
      pks: { junction: ["a", "b"] },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/junction", {
      column: "note",
      value: "hi",
      pk: { a: 1, b: 2 },
    });

    expect(status).toBe(200);
    if (typeof data === "object" && data !== null) {
      expect((data as { sql: string }).sql).toBe(
        `UPDATE "junction" SET "note" = 'hi' WHERE "a" = 1 AND "b" = 2`
      );
    }
    // Both PK columns reach the builder's where clause — Knex will
    // translate this into AND-joined predicates at the SQL layer.
    expect(db.calls).toEqual([
      {
        table: "junction",
        where: { a: 1, b: 2 },
        values: { note: "hi" },
      },
    ]);
  });
});

// ===== DATABASE ERROR PROPAGATION =====

describe("PUT /api/data/:table — database errors", () => {
  it("returns 400 with the driver message when update throws", async () => {
    // Simulates a constraint violation, type mismatch, or any other driver-
    // side rejection. The route should surface the message verbatim so the
    // user can diagnose without server-log access — same convention as the
    // import and schema routes.
    const db = buildMockDb({
      tables: ["users"],
      columns: {
        users: [
          { name: "id", type: "integer" },
          { name: "email", type: "text" },
        ],
      },
      pks: { users: ["id"] },
      updateImpl: () => {
        throw new Error("duplicate key value violates unique constraint");
      },
    });
    const { server, port } = await startApp(db, buildConfig("write"));
    openServers.push(server);

    const { status, data } = await putJson(port, "/api/data/users", {
      column: "email",
      value: "x@y.z",
      pk: { id: 1 },
    });
    expect(status).toBe(400);
    if (typeof data === "object" && data !== null && "error" in data) {
      expect(String((data as { error: string }).error)).toContain(
        "duplicate key"
      );
    }
  });
});
