// ===== FILE PURPOSE =====
// Unit tests for src/server/db.ts
//
// STRATEGY: mock knex entirely — we never open a real database connection.
//   • createKnexInstance() tests verify that the correct knex client name and
//     connection shape are passed to the knex() factory for each dialect.
//   • testConnection() tests verify correct success/failure propagation without
//     touching a real database.
//   • destroyConnection() tests verify that db.destroy() is called exactly once.
//
// WHY mock knex and not call a real database:
//   Unit tests must be fast, hermetic, and runnable with no external services.
//   The real connectivity behaviour is covered by manual integration testing and
//   future e2e tests that spin up Docker containers. Here we only care that the
//   configuration passed to knex is correct and that the exported functions
//   behave correctly under normal and error conditions.
//
// HOW vi.mock works with Vitest:
//   vi.mock() is hoisted to the top of the file by Vitest's transformer, so
//   the mock is in place before any import runs. The factory function receives
//   the original module via `importOriginal` when `{ spy: true }` is passed,
//   but here we replace the whole module with a controlled stub.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ===== MODULE MOCK =====

// WHY mock the entire "knex" module:
//   createKnexInstance() calls knex() (the default export) to build the
//   instance. We need to intercept that call to:
//     a) capture the config object it was called with (for assertion)
//     b) return a fake Knex object with controllable .raw() and .destroy() stubs
//   Without the mock, the real knex() would try to load native drivers (pg,
//   better-sqlite3) that may not be installed in the test environment.

// WHY vi.hoisted():
//   vi.mock() factory functions are hoisted to the TOP of the file by Vitest's
//   transformer — they execute before ANY other top-level statements, including
//   const/let declarations. Referencing a module-scope variable inside the
//   factory therefore causes "Cannot access before initialization".
//   vi.hoisted() runs its callback in the same hoisted position as vi.mock(),
//   so stubs declared inside it are guaranteed to be initialised when the
//   factory runs. [source: Mocking Modules]
const { mockRaw, mockDestroy, mockKnexInstance, mockKnexConstructor } =
  vi.hoisted(() => {
    const mockRaw = vi.fn();
    const mockDestroy = vi.fn();
    const mockKnexInstance = { raw: mockRaw, destroy: mockDestroy };
    const mockKnexConstructor = vi.fn().mockReturnValue(mockKnexInstance);
    return { mockRaw, mockDestroy, mockKnexInstance, mockKnexConstructor };
  });

vi.mock("knex", () => ({
  // The default export of "knex" is a function — mirror that shape.
  default: mockKnexConstructor,
}));

// Import after vi.mock so we get the module that already has the mock in place.
import {
  createKnexInstance,
  testConnection,
  destroyConnection,
} from "../../src/server/db.js";
import type { ConnectionConfig } from "../../src/types/connection.js";

// ===== FIXTURES =====

/**
 * Returns a minimal ConnectionConfig for the given dialect.
 * Only fields consumed by createKnexInstance() are populated;
 * permissionMode is included to satisfy the full interface.
 */
function makeConfig(
  overrides: Partial<ConnectionConfig> & { dialect: ConnectionConfig["dialect"] }
): ConnectionConfig {
  return {
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "user",
    password: "pass",
    permissionMode: "readonly",
    ...overrides,
  };
}

// ===== TESTS =====

describe("createKnexInstance", () => {
  beforeEach(() => {
    // Reset call history between tests so assertions on call counts are clean.
    mockKnexConstructor.mockClear();
    mockKnexConstructor.mockReturnValue(mockKnexInstance);
  });

  // ── Postgres ────────────────────────────────────────────────────────────────

  it("uses the 'pg' client for the postgres dialect", () => {
    const config = makeConfig({ dialect: "postgres" });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [{ client: string }];
    expect(knexConfig.client).toBe("pg");
  });

  it("passes host, port, database, user, password to the pg connection", () => {
    const config = makeConfig({
      dialect: "postgres",
      host: "db.example.com",
      port: 5433,
      database: "myapp",
      user: "alice",
      password: "s3cr3t",
    });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { connection: { host: string; port: number; database: string; user: string; password: string } }
    ];
    expect(knexConfig.connection).toMatchObject({
      host: "db.example.com",
      port: 5433,
      database: "myapp",
      user: "alice",
      password: "s3cr3t",
    });
  });

  // ── MySQL ───────────────────────────────────────────────────────────────────

  it("uses the 'mysql2' client for the mysql dialect", () => {
    const config = makeConfig({ dialect: "mysql", port: 3306 });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [{ client: string }];
    expect(knexConfig.client).toBe("mysql2");
  });

  it("passes correct connection shape for mysql", () => {
    const config = makeConfig({
      dialect: "mysql",
      host: "mysql.local",
      port: 3307,
      database: "shop",
    });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { connection: { host: string; port: number; database: string } }
    ];
    expect(knexConfig.connection).toMatchObject({
      host: "mysql.local",
      port: 3307,
      database: "shop",
    });
  });

  // ── SQLite ──────────────────────────────────────────────────────────────────

  it("uses the 'better-sqlite3' client for the sqlite dialect", () => {
    const config = makeConfig({ dialect: "sqlite", database: "./data/test.db", port: 0 });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [{ client: string }];
    expect(knexConfig.client).toBe("better-sqlite3");
  });

  it("passes { filename } (not host/port) as the sqlite connection", () => {
    const config = makeConfig({ dialect: "sqlite", database: "/var/data/prod.sqlite", port: 0 });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { connection: { filename: string } }
    ];
    // WHY check for filename and absence of host:
    //   better-sqlite3 ignores host/port and requires `filename`. Passing both
    //   would silently fail. This assertion catches a regression if someone
    //   accidentally changes the SQLite branch to use buildNetworkConnection().
    expect(knexConfig.connection).toEqual({ filename: "/var/data/prod.sqlite" });
    expect((knexConfig.connection as Record<string, unknown>).host).toBeUndefined();
  });

  it("sets useNullAsDefault: true for sqlite", () => {
    const config = makeConfig({ dialect: "sqlite", database: "./test.db", port: 0 });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { useNullAsDefault: boolean }
    ];
    expect(knexConfig.useNullAsDefault).toBe(true);
  });

  it("does not set useNullAsDefault for postgres", () => {
    const config = makeConfig({ dialect: "postgres" });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { useNullAsDefault: boolean }
    ];
    expect(knexConfig.useNullAsDefault).toBe(false);
  });

  // ── MSSQL ───────────────────────────────────────────────────────────────────

  it("uses the 'tedious' client for the mssql dialect", () => {
    const config = makeConfig({ dialect: "mssql", port: 1433 });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [{ client: string }];
    expect(knexConfig.client).toBe("tedious");
  });

  it("puts the database name inside options.database for mssql (tedious quirk)", () => {
    // WHY this test exists:
    //   Tedious requires the database inside options.database, not at the top
    //   level. Passing it at the top level is silently ignored. This test is a
    //   regression guard for that non-obvious driver behaviour.
    const config = makeConfig({
      dialect: "mssql",
      host: "sqlserver.local",
      port: 1433,
      database: "Northwind",
    });
    createKnexInstance(config);

    const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
      { connection: { server: string; options: { database: string; port: number } } }
    ];
    expect(knexConfig.connection.server).toBe("sqlserver.local");
    expect(knexConfig.connection.options.database).toBe("Northwind");
    expect(knexConfig.connection.options.port).toBe(1433);
  });

  // ── Pool config ─────────────────────────────────────────────────────────────

  it("configures pool with min:0 and max:5 for all dialects", () => {
    for (const dialect of ["postgres", "mysql", "mssql"] as const) {
      mockKnexConstructor.mockClear();
      const config = makeConfig({ dialect });
      createKnexInstance(config);

      const [knexConfig] = mockKnexConstructor.mock.calls[0] as [
        { pool: { min: number; max: number } }
      ];
      expect(knexConfig.pool).toEqual({ min: 0, max: 5 });
    }
  });

  it("returns the Knex instance produced by the knex() factory", () => {
    const config = makeConfig({ dialect: "postgres" });
    const result = createKnexInstance(config);
    // The mock factory always returns mockKnexInstance; verify the return is
    // threaded through correctly (not a re-created object).
    expect(result).toBe(mockKnexInstance);
  });
});

// ===== testConnection =====

describe("testConnection", () => {
  beforeEach(() => {
    mockRaw.mockReset();
  });

  it("resolves when SELECT 1 succeeds", async () => {
    mockRaw.mockResolvedValue([{ 1: 1 }]);
    const config = makeConfig({ dialect: "postgres" });

    await expect(testConnection(mockKnexInstance as never, config)).resolves.toBeUndefined();
    expect(mockRaw).toHaveBeenCalledWith("SELECT 1");
  });

  it("rejects with a human-friendly message when the DB is unreachable", async () => {
    // Simulate ECONNREFUSED — the typical error when the database server is down.
    mockRaw.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));
    const config = makeConfig({ dialect: "postgres", host: "localhost", port: 5432 });

    await expect(testConnection(mockKnexInstance as never, config)).rejects.toThrow(
      /Cannot connect to postgres database "testdb" on localhost:5432/
    );
  });

  it("includes the original driver error message in the rejection", async () => {
    mockRaw.mockRejectedValue(new Error("password authentication failed for user \"alice\""));
    const config = makeConfig({ dialect: "postgres" });

    await expect(testConnection(mockKnexInstance as never, config)).rejects.toThrow(
      /password authentication failed/
    );
  });

  it("rejects with a message containing dialect, database, host, and port", async () => {
    mockRaw.mockRejectedValue(new Error("ETIMEDOUT"));
    const config = makeConfig({
      dialect: "mysql",
      host: "db.remote.com",
      port: 3307,
      database: "shop",
    });

    await expect(testConnection(mockKnexInstance as never, config)).rejects.toThrow(
      /Cannot connect to mysql database "shop" on db\.remote\.com:3307/
    );
  });

  it("handles non-Error rejections (e.g. a plain string thrown by a driver)", async () => {
    // Some older driver versions throw strings instead of Error objects.
    mockRaw.mockRejectedValue("connection refused");
    const config = makeConfig({ dialect: "postgres" });

    await expect(testConnection(mockKnexInstance as never, config)).rejects.toThrow(
      /connection refused/
    );
  });
});

// ===== destroyConnection =====

describe("destroyConnection", () => {
  beforeEach(() => {
    mockDestroy.mockReset();
  });

  it("calls db.destroy() exactly once", async () => {
    mockDestroy.mockResolvedValue(undefined);
    await destroyConnection(mockKnexInstance as never);

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it("resolves after db.destroy() resolves", async () => {
    mockDestroy.mockResolvedValue(undefined);
    await expect(destroyConnection(mockKnexInstance as never)).resolves.toBeUndefined();
  });

  it("propagates rejection from db.destroy()", async () => {
    // Unlikely in practice, but the pool destroy can theoretically fail if
    // a connection is in a bad state. We should not swallow the error.
    mockDestroy.mockRejectedValue(new Error("pool destroy failed"));
    await expect(destroyConnection(mockKnexInstance as never)).rejects.toThrow(
      "pool destroy failed"
    );
  });
});
