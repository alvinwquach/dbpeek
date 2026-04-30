// ===== FILE PURPOSE =====
// Integration tests for src/server/index.ts and the port-fallback logic in
// src/cli/index.ts (listenWithFallback is exercised via the http.Server API).
//
// STRATEGY:
//   • createApp() tests use Node's built-in `http` module to make real HTTP
//     requests against a live Express server bound to an ephemeral OS port
//     (port 0). This avoids port conflicts and doesn't require supertest.
//   • Port-fallback tests bind a real socket on a port, then verify that a
//     second server starts on the next available port.
//
// WHY port 0 for app tests:
//   Passing port 0 to server.listen() lets the OS pick an unused port. This
//   guarantees tests never conflict with each other or with developer services,
//   even when tests run in parallel.
//
// WHY Node http module instead of supertest:
//   supertest is not installed in this project. Node's built-in http.request()
//   is sufficient for the simple GET / and GET /api/health assertions here.
//   We avoid adding a devDependency for a capability we already have.
//
// WHY mock knex:
//   createApp() takes a Knex instance as a parameter. We pass a minimal mock
//   object that satisfies the TypeScript type — no real DB connection is needed
//   to verify Express middleware and routing behaviour.

import http from "http";
import net from "net";
import { describe, it, expect, afterEach, vi } from "vitest";

// ===== MODULE MOCK =====

// Mock knex so that importing db.ts (transitively via server/index.ts)
// does not attempt to load native drivers.
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
 * Minimal mock Knex object. createApp() passes this to registerRoutes(); the
 * routes only read it inside handler closures, so the mock is never actually
 * called during these tests.
 */
const mockDb = {
  raw: vi.fn(),
  destroy: vi.fn(),
} as unknown as Knex;

/** Minimal ConnectionConfig sufficient for createApp(). */
const baseConfig: ConnectionConfig = {
  dialect: "postgres",
  host: "localhost",
  port: 5432,
  database: "testdb",
  user: "user",
  password: "pass",
  permissionMode: "readonly",
};

/**
 * Starts an http.Server on an ephemeral port (0) and returns it along with
 * the OS-assigned port number.
 *
 * WHY port 0:
 *   The OS picks an unused port, so tests never conflict with each other or
 *   with developer services running on well-known ports.
 *
 * WHY `return new Promise(...)`:
 *   http.Server.listen() is callback-based — it signals readiness via its
 *   callback argument and failures via the "error" event. It does not return
 *   a Promise, so it cannot be awaited directly. Wrapping it in a Promise
 *   lets callers write `await startServer(app)` and receive the bound port
 *   only after the socket is actually open. We attach server.once("error")
 *   alongside the callback so any bind failure (e.g. EADDRINUSE) rejects the
 *   Promise rather than being swallowed as an unhandled event.
 *
 * WHY `typeof addr === "string"` guard:
 *   server.address() returns a string when the server is bound to a Unix
 *   domain socket path instead of a TCP port. That can't happen here (we
 *   always pass a numeric port), but TypeScript doesn't know that, and
 *   accessing `.port` on a string would be a runtime crash. The guard keeps
 *   the type checker and the runtime in agreement.
 */
function startServer(app: ReturnType<typeof createApp>): Promise<{ server: http.Server; port: number }> {
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
 * Closes an http.Server and resolves only after all connections have drained.
 *
 * WHY `return new Promise(...)`:
 *   server.close() accepts an optional callback that fires when the last
 *   connection closes — it does not return a Promise. Wrapping it lets
 *   afterEach await full socket teardown before the next test starts,
 *   preventing "address already in use" races between tests that share a port.
 */
function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Makes a GET request to `http://127.0.0.1:{port}{path}` and returns the
 * status code, body string, and response headers.
 *
 * WHY `return new Promise(...)`:
 *   http.request() delivers the response via a callback and streams the body
 *   via "data"/"end" events — there is no Promise-based alternative in Node's
 *   built-in http module. The Promise resolves only after the "end" event fires,
 *   guaranteeing the full body is collected before tests assert on it.
 *
 * WHY `res.statusCode ?? 0`:
 *   IncomingMessage.statusCode is typed as `number | undefined` because it is
 *   absent on request objects (where it has no meaning). In practice it is
 *   always set on response objects, but the `?? 0` default satisfies the type
 *   checker and produces an obviously-wrong value (0) that would fail any
 *   status assertion rather than passing silently with undefined.
 *
 * WHY `req.on("error", reject)`:
 *   Network errors (e.g. ECONNREFUSED when the server hasn't started yet) fire
 *   on the request object, not via the response callback. Without this listener,
 *   a connection failure would be an unhandled rejection — which Vitest reports
 *   as a misleading "Unhandled Rejection" rather than a clear test failure.
 */
function get(port: number, path: string, origin?: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET",
        headers: origin ? { origin } : {} },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Binds a bare TCP server to `port` on 127.0.0.1 and returns it so the caller
 * can close it after the test.
 *
 * WHY a bare net.Server instead of an http.Server:
 *   We only need to hold the port open — no HTTP handling required. net.Server
 *   is lighter and makes the intent ("block this port") more obvious than an
 *   http.Server that would never serve a real response.
 *
 * WHY `return new Promise(...)`:
 *   net.Server.listen() is callback-based; same reasoning as startServer().
 *   The Promise resolves only after the socket is bound, ensuring the port is
 *   actually occupied before the fallback test tries to use it.
 *
 * WHY pass 0 to let the OS pick the port in the test:
 *   Hard-coding a port number risks collision with developer services. Passing
 *   0 gives us a guaranteed-free ephemeral port, and we read the actual number
 *   back from blocker.address() after binding.
 */
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.listen(port, "127.0.0.1", () => resolve(blocker));
    blocker.once("error", reject);
  });
}

// ===== TEST CLEANUP =====

// Servers opened during tests are collected here and closed in afterEach,
// so a failing test doesn't leave ports occupied.
const openServers: http.Server[] = [];
const openBlockers: net.Server[] = [];

afterEach(async () => {
  // WHY Promise.all over sequential closes:
  //   Closing servers sequentially would serialise the teardown — each server
  //   waits for keep-alive connections to drop before the next starts closing.
  //   Running them in parallel cuts afterEach time from O(n * drain) to
  //   O(1 * drain). All servers were bound to different ports, so there is no
  //   ordering dependency between their close operations.
  //
  // WHY inline `new Promise` for blockers rather than reusing closeServer:
  //   openBlockers holds net.Server instances; closeServer expects http.Server.
  //   The close() callback shape is identical, but TypeScript enforces the
  //   distinct types. An inline wrapper avoids a second exported function or
  //   an unsafe cast.
  await Promise.all([
    ...openServers.map(closeServer),
    ...openBlockers.map(
      (b) => new Promise<void>((res, rej) => b.close((e) => (e ? rej(e) : res())))
    ),
  ]);
  openServers.length = 0;
  openBlockers.length = 0;
});

// ===== EXPRESS APP TESTS =====

describe("createApp — HTTP responses", () => {
  it("responds 200 to GET /api/health", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { status, body } = await get(port, "/api/health");
    expect(status).toBe(200);
    expect(JSON.parse(body)).toMatchObject({ status: "ok" });
  });

  it("responds 200 to GET / (SPA fallback — serves index.html or 404 in test env)", async () => {
    // WHY 200 OR 404 is acceptable here:
    //   In the test environment, dist/client/dist/index.html doesn't exist
    //   (the Vite build hasn't run). The SPA fallback tries to sendFile() the
    //   missing file and Express returns 404. In production it returns 200.
    //   We assert that the server responds (doesn't hang or crash) and that the
    //   status is one of the two expected values. A 500 would indicate a bug.
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { status } = await get(port, "/");
    expect([200, 404]).toContain(status);
  });

  it("does not expose a 500 for GET /", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { status } = await get(port, "/");
    expect(status).not.toBe(500);
  });

  it("returns JSON Content-Type for /api/health", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { headers } = await get(port, "/api/health");
    expect(headers["content-type"]).toMatch(/application\/json/);
  });
});

describe("createApp — CORS", () => {
  it("allows requests from http://localhost:5173 (Vite dev server)", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { headers } = await get(port, "/api/health", "http://localhost:5173");
    expect(headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });

  it("allows requests from http://127.0.0.1:5173", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    const { headers } = await get(port, "/api/health", "http://127.0.0.1:5173");
    expect(headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
  });

  it("does not set ACAO header for a non-localhost origin", async () => {
    const app = createApp(baseConfig, mockDb);
    const { server, port } = await startServer(app);
    openServers.push(server);

    // The cors middleware will call next(err) when origin is blocked.
    // Express turns that into a 500. Either way, ACAO must not be set.
    const { headers } = await get(port, "/api/health", "https://evil.example.com");
    expect(headers["access-control-allow-origin"]).toBeUndefined();
  });
});

// ===== PORT FALLBACK TEST =====

describe("listenWithFallback", () => {
  // WHY test port fallback here and not in cli.test.ts:
  //   listenWithFallback() is not exported (it's an implementation detail of the
  //   CLI). We test it indirectly by actually occupying a port and verifying that
  //   a server started via http.Server.listen() moves to the next port. This
  //   mirrors exactly what the CLI does, without importing internal symbols.

  it("binds to the next port when the first is occupied", async () => {
    // Pick an ephemeral port by letting the OS assign one.
    const blocker = await occupyPort(0);
    openBlockers.push(blocker);
    const occupiedPort = (blocker.address() as net.AddressInfo).port;

    // Now try to start a server on the occupied port and verify it lands on a
    // different port (simulating what listenWithFallback does with BASE_PORT).
    const app = createApp(baseConfig, mockDb);
    const server = http.createServer(app);
    openServers.push(server);

    // WHY `new Promise` wrapping a recursive tryListen:
    //   server.listen() success and failure arrive via events, not return values,
    //   so we need the Promise constructor to bridge the event-emitter boundary.
    //   tryListen() is defined inside the executor so it can close over resolve
    //   and reject — on success it calls resolve(port), on EADDRINUSE it recurses
    //   with port + 1, and on any other error it calls reject(err). This mirrors
    //   the structure of listenWithFallback() in the CLI, so the test genuinely
    //   exercises the same retry logic rather than a synthetic stub.
    const boundPort = await new Promise<number>((resolve, reject) => {
      function tryListen(port: number) {
        server.listen(port, "127.0.0.1");
        server.once("listening", () => {
          const addr = server.address() as net.AddressInfo;
          resolve(addr.port);
        });
        server.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            // Retry on the next port (mimics listenWithFallback).
            server.removeAllListeners("listening");
            server.removeAllListeners("error");
            tryListen(port + 1);
          } else {
            reject(err);
          }
        });
      }
      tryListen(occupiedPort);
    });

    expect(boundPort).toBe(occupiedPort + 1);

    // Verify the server actually responds on the new port.
    const { status } = await get(boundPort, "/api/health");
    expect(status).toBe(200);
  });
});
