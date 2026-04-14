/**
 * tests/server/server.test.ts
 *
 * Tests for the Express server factory in src/server/index.ts.
 *
 * We create real HTTP servers bound to ephemeral ports (port 0 lets the OS
 * pick a free port) and use fetch() to hit them. All servers are shut down
 * in afterEach to avoid dangling handles.
 *
 * Why not mock Express?
 *   Mocking the framework would only test our wiring code, not whether the
 *   actual middleware behaves correctly. Using a real server verifies CORS
 *   headers, JSON parsing, and static file serving end-to-end.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import { createKnexInstance } from '../../src/server/db.js';
import { createServer } from '../../src/server/index.js';
import type { Knex } from 'knex';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** In-memory SQLite knex instance — no server required. */
function makeKnex(): Knex {
  return createKnexInstance({ dialect: 'sqlite', database: ':memory:' });
}

/**
 * Start the Express app on a random OS-assigned port and return the server
 * along with the base URL (e.g. "http://127.0.0.1:54321").
 */
async function startServer(
  knex: Knex,
  mode: 'read-only' | 'write' | 'full' = 'read-only'
): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createServer({ knex, mode });
  return new Promise((resolve, reject) => {
    // Port 0 tells the OS to pick any available port.
    const server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

/** Close a server and wait for it to finish. */
function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

// ── Teardown tracking ─────────────────────────────────────────────────────────

const openServers: http.Server[] = [];
const openKnex: Knex[] = [];

afterEach(async () => {
  for (const s of openServers.splice(0)) {
    await stopServer(s).catch(() => undefined);
  }
  for (const k of openKnex.splice(0)) {
    await k.destroy().catch(() => undefined);
  }
});

// ── createServer ──────────────────────────────────────────────────────────────

describe('createServer', () => {
  it('returns an Express application', () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const app = createServer({ knex, mode: 'read-only' });
    // Express apps have a `listen` method.
    expect(typeof app.listen).toBe('function');
  });

  it('GET /health returns { status: "ok" }', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex);
    openServers.push(server);

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('sets CORS header for localhost origins', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex);
    openServers.push(server);

    // Send a preflight OPTIONS request from a localhost origin.
    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // The CORS middleware should have added the allow-origin header.
    const origin = res.headers.get('access-control-allow-origin');
    expect(origin).toBeTruthy();
  });

  it('does not set CORS header for non-localhost origins', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex);
    openServers.push(server);

    const res = await fetch(`${baseUrl}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example.com',
        'Access-Control-Request-Method': 'GET',
      },
    });
    // A non-localhost origin must NOT be reflected in the allow-origin header.
    const origin = res.headers.get('access-control-allow-origin');
    expect(origin).not.toBe('http://evil.example.com');
  });

  it('parses JSON request bodies', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex);
    openServers.push(server);

    // POST to the echo endpoint with a JSON body.
    const res = await fetch(`${baseUrl}/api/echo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    });
    // The echo route should reflect the parsed body back.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ hello: 'world' });
  });

  it('exposes the permission mode on GET /api/mode', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex, 'write');
    openServers.push(server);

    const res = await fetch(`${baseUrl}/api/mode`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: 'write' });
  });

  it('returns 404 for unknown routes', async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const { server, baseUrl } = await startServer(knex);
    openServers.push(server);

    const res = await fetch(`${baseUrl}/not-a-real-path`);
    expect(res.status).toBe(404);
  });
});
