/**
 * tests/server/cli-server.test.ts
 *
 * Integration tests for the CLI server startup logic.
 *
 * What are we testing here?
 *   When the user runs `dbpeek`, the CLI must:
 *     1. Try to bind to port 3000 first.
 *     2. If 3000 is taken, try 3001, 3002, … up to 3010.
 *     3. Successfully start and expose a /health endpoint.
 *
 * Why not test browser-opening or SIGINT here?
 *   - `open` launches a real browser process — not safe in CI.
 *   - SIGINT/SIGTERM handling is OS-level and hard to test portably.
 *   We test the observable HTTP behaviour instead and trust that the
 *   Node.js signal API works as documented.
 *
 * Strategy:
 *   We import the `startOnAvailablePort` helper directly (not the full CLI
 *   binary) so we can call it like a regular function without spawning a
 *   child process. The helper is a pure function: given a list of candidate
 *   ports and an Express app, it returns the bound port number.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'http';
import net from 'net';
import { createKnexInstance } from '../../src/server/db.js';
import { createServer } from '../../src/server/index.js';
import { startOnAvailablePort } from '../../src/cli/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Occupy a TCP port so we can simulate "port already in use". */
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const blocker = net.createServer();
    blocker.listen(port, '127.0.0.1', () => resolve(blocker));
    blocker.on('error', reject);
  });
}

/** Release an occupied port. */
function releasePort(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/** Close an HTTP server cleanly. */
function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

// ── Teardown tracking ─────────────────────────────────────────────────────────

const openServers: (http.Server | net.Server)[] = [];

afterEach(async () => {
  // Close every server we opened during the test so ports are freed and
  // Vitest doesn't complain about open handles.
  for (const s of openServers.splice(0)) {
    await new Promise<void>((res) => s.close(() => res()));
  }
});

// ── startOnAvailablePort ───────────────────────────────────────────────────────

describe('startOnAvailablePort', () => {
  it('binds to the first candidate port when it is free', async () => {
    // Use a high port number unlikely to be in use on any machine.
    const knex = createKnexInstance({ dialect: 'sqlite', database: ':memory:' });
    const app = createServer({ knex, mode: 'read-only' });

    const { server, port } = await startOnAvailablePort(app, [19800]);
    openServers.push(server);
    await knex.destroy();

    expect(port).toBe(19800);

    // Verify the server actually responds on that port.
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
  });

  it('skips an occupied port and binds to the next candidate', async () => {
    // Occupy 19801 so startOnAvailablePort must fall through to 19802.
    const blocker = await occupyPort(19801);
    openServers.push(blocker);

    const knex = createKnexInstance({ dialect: 'sqlite', database: ':memory:' });
    const app = createServer({ knex, mode: 'read-only' });

    const { server, port } = await startOnAvailablePort(app, [19801, 19802]);
    openServers.push(server);
    await knex.destroy();

    // Should have fallen through to 19802.
    expect(port).toBe(19802);
  });

  it('throws when all candidate ports are occupied', async () => {
    // Occupy both candidates.
    const b1 = await occupyPort(19803);
    const b2 = await occupyPort(19804);
    openServers.push(b1, b2);

    const knex = createKnexInstance({ dialect: 'sqlite', database: ':memory:' });
    const app = createServer({ knex, mode: 'read-only' });
    await knex.destroy();

    await expect(startOnAvailablePort(app, [19803, 19804])).rejects.toThrow(
      /no available port/i
    );
  });
});
