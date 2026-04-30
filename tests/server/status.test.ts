// ===== FILE PURPOSE =====
// HTTP-level tests for GET /api/status.
//
// STRATEGY:
//   We do not spin up a real database. Instead we pass a mock Knex object
//   (with `raw` stubbed out) into createApp(), bind the resulting Express app
//   to an ephemeral OS port, and make real HTTP requests against it. This
//   exercises the FULL request pipeline — routing, connectivity checks, and
//   response formatting — while keeping tests fast and independent of any
//   installed driver.
//
// WHY real HTTP rather than unit tests:
//   The status endpoint is simple, but we want to verify that the password is
//   NEVER exposed in the HTTP response, even by accident. Real HTTP requests
//   give us confidence in the full response serialization.

import http from "http";
import { describe, it, expect, afterEach, vi } from "vitest";

// ===== MODULE MOCK =====
// Mock knex so that importing db.ts does not attempt to load native drivers.

vi.mock("knex", () => ({
  default: vi.fn().mockReturnValue({
    raw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    destroy: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { createApp } from "../../src/server/index.js";
import type { Knex } from "../../src/server/db.js";
import type { ConnectionConfig } from "../../src/types/connection.js";

// ===== HELPERS =====

/**
 * Minimal mock Knex object.
 */
function buildMockDb(): Knex & { raw: ReturnType<typeof vi.fn> } {
  return {
    raw: vi.fn(),
    destroy: vi.fn(),
  } as unknown as Knex & { raw: ReturnType<typeof vi.fn> };
}

/**
 * Builds a ConnectionConfig for testing.
 */
function buildConfig(overrides?: Partial<ConnectionConfig>): ConnectionConfig {
  return {
    dialect: "postgres",
    host: "localhost",
    port: 5432,
    database: "testdb",
    user: "testuser",
    password: "secret123",
    permissionMode: "readonly",
    ...overrides,
  };
}

/**
 * Starts an Express app on an ephemeral port and returns the HTTP server and
 * the bound port number.
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
 * have drained.
 */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Issues a JSON GET to /api/status and parses the response body.
 */
function getStatus(
  port: number
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: "/api/status", method: "GET" },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            resolve({ status: res.statusCode ?? 0, data });
          } catch (err) {
            reject(err);
          }
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

// ===== TESTS =====

describe("GET /api/status", () => {
  it("returns correct connection information", async () => {
    const db = buildMockDb();
    const config = buildConfig({
      dialect: "mysql",
      host: "db.example.com",
      port: 3306,
      database: "myapp",
      user: "dbadmin",
      permissionMode: "write",
    });
    db.raw.mockResolvedValueOnce([{ 1: 1 }]);

    const { server, port } = await startApp(db, config);
    openServers.push(server);

    const { status, data } = await getStatus(port);

    expect(status).toBe(200);
    expect(data).toMatchObject({
      dialect: "mysql",
      host: "db.example.com",
      port: 3306,
      database: "myapp",
      user: "dbadmin",
      mode: "write",
      connected: true,
    });
  });

  it("NEVER includes the password in the response", async () => {
    const db = buildMockDb();
    const config = buildConfig({ password: "this-is-secret" });
    db.raw.mockResolvedValueOnce([{ 1: 1 }]);

    const { server, port } = await startApp(db, config);
    openServers.push(server);

    const { status, data } = await getStatus(port);

    expect(status).toBe(200);
    // Assert that "password" is not a key in the response object
    expect(Object.keys(data as Record<string, unknown>)).not.toContain(
      "password"
    );
    // Also verify the response does not contain the actual password string
    const responseStr = JSON.stringify(data);
    expect(responseStr).not.toContain("this-is-secret");
  });

  it("returns connected=false when the database is unreachable", async () => {
    const db = buildMockDb();
    const config = buildConfig();
    // Simulate a connection failure
    db.raw.mockRejectedValueOnce(new Error("ECONNREFUSED: Connection refused"));

    const { server, port } = await startApp(db, config);
    openServers.push(server);

    const { status, data } = await getStatus(port);

    expect(status).toBe(200);
    expect(data).toMatchObject({
      connected: false,
    });
    // The rest of the connection info should still be present
    expect((data as Record<string, unknown>).dialect).toBe("postgres");
    expect((data as Record<string, unknown>).host).toBe("localhost");
  });

  it("returns the permission mode in the response", async () => {
    const db = buildMockDb();
    db.raw.mockResolvedValueOnce([{ 1: 1 }]);

    // Test all three permission modes
    for (const mode of ["readonly", "write", "full"] as const) {
      const config = buildConfig({ permissionMode: mode });
      const { server, port } = await startApp(db, config);
      openServers.push(server);

      const { status, data } = await getStatus(port);

      expect(status).toBe(200);
      expect((data as Record<string, unknown>).mode).toBe(mode);
    }
  });

  it("handles SQLite configuration (empty host/user, port 0)", async () => {
    const db = buildMockDb();
    const config = buildConfig({
      dialect: "sqlite",
      host: "",
      port: 0,
      database: "/tmp/app.db",
      user: "",
      password: "",
    });
    db.raw.mockResolvedValueOnce([{ 1: 1 }]);

    const { server, port } = await startApp(db, config);
    openServers.push(server);

    const { status, data } = await getStatus(port);

    expect(status).toBe(200);
    expect(data).toMatchObject({
      dialect: "sqlite",
      host: "",
      port: 0,
      database: "/tmp/app.db",
      user: "",
      connected: true,
    });
  });
});
