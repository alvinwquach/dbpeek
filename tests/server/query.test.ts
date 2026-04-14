/**
 * tests/server/query.test.ts
 *
 * Integration tests for POST /api/query in src/server/routes/query.ts.
 *
 * We spin up a real Express server bound to an ephemeral port (port 0) and
 * use an in-memory SQLite database so tests run with zero external dependencies.
 *
 * Why real HTTP and a real database?
 *   Mocking knex or Express would only verify our wiring, not whether the route
 *   actually validates permissions, executes SQL, and shapes the response
 *   correctly. End-to-end tests catch integration bugs that unit tests miss.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { createKnexInstance } from '../../src/server/db.js';
import { createServer } from '../../src/server/index.js';
import type { Knex } from 'knex';
import type { PermissionMode } from '../../src/server/index.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Create a fresh in-memory SQLite database — no files, no server required. */
function makeKnex(): Knex {
  return createKnexInstance({ dialect: 'sqlite', database: ':memory:' });
}

/**
 * Bind the Express app to a random OS-assigned port and return the running
 * server plus a base URL for fetch() calls.
 */
async function startServer(
  knex: Knex,
  mode: PermissionMode = 'read-only'
): Promise<{ server: http.Server; baseUrl: string }> {
  const app = createServer({ knex, mode });
  return new Promise((resolve, reject) => {
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

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

/**
 * POST a JSON body to /api/query and return the raw Response.
 * Lets each test assert on status and body independently.
 */
async function postQuery(
  baseUrl: string,
  body: unknown
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${baseUrl}/api/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

// ── Teardown ──────────────────────────────────────────────────────────────────

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

// ── Request validation ────────────────────────────────────────────────────────
// These tests verify the route handles bad inputs before even attempting to
// validate permissions or execute SQL.

describe('POST /api/query — request validation', () => {
  let baseUrl: string;

  beforeEach(async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const result = await startServer(knex, 'read-only');
    openServers.push(result.server);
    baseUrl = result.baseUrl;
  });

  it('returns 400 when the sql field is missing', async () => {
    const { status, json } = await postQuery(baseUrl, {});
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 400 when sql is null', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: null });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 400 when sql is a number', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 42 });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 400 when sql is an empty string', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: '' });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 400 when sql is only whitespace', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: '   \n  ' });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });
});

// ── read-only mode ────────────────────────────────────────────────────────────

describe('POST /api/query — read-only mode', () => {
  let baseUrl: string;

  beforeEach(async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const result = await startServer(knex, 'read-only');
    openServers.push(result.server);
    baseUrl = result.baseUrl;
  });

  it('returns 200 with the correct response shape for SELECT 1', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT 1 AS n' });
    expect(status).toBe(200);

    const body = json as { columns: string[]; rows: unknown[]; rowCount: number; executionTime: number };
    expect(Array.isArray(body.columns)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.rowCount).toBe('number');
    expect(typeof body.executionTime).toBe('number');
  });

  it('returns columns matching the SELECT aliases', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT 1 AS n' });
    expect(status).toBe(200);
    const body = json as { columns: string[] };
    expect(body.columns).toContain('n');
  });

  it('returns the correct row data', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT 42 AS answer' });
    expect(status).toBe(200);
    const body = json as { rows: Array<Record<string, unknown>>; rowCount: number };
    expect(body.rowCount).toBe(1);
    expect(body.rows[0]['answer']).toBe(42);
  });

  it('executionTime is a non-negative number in milliseconds', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT 1' });
    expect(status).toBe(200);
    const body = json as { executionTime: number };
    expect(body.executionTime).toBeGreaterThanOrEqual(0);
  });

  it('returns rowCount equal to rows.length', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT 1' });
    expect(status).toBe(200);
    const body = json as { rows: unknown[]; rowCount: number };
    expect(body.rowCount).toBe(body.rows.length);
  });

  it('returns 403 with a reason when INSERT is attempted', async () => {
    const { status, json } = await postQuery(baseUrl, {
      sql: 'INSERT INTO t VALUES (1)',
    });
    expect(status).toBe(403);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 403 when CREATE TABLE is attempted', async () => {
    const { status, json } = await postQuery(baseUrl, { sql: 'CREATE TABLE t (id INT)' });
    expect(status).toBe(403);
  });

  it('returns 400 when the SQL has a syntax error', async () => {
    // SELECT ,,, is syntactically invalid — permission check passes (starts with
    // SELECT), but the database rejects it.
    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT ,,,' });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 400 when querying a table that does not exist', async () => {
    const { status, json } = await postQuery(baseUrl, {
      sql: 'SELECT * FROM nonexistent_table_xyz',
    });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });

  it('returns 0 rows for a SELECT on an empty table', async () => {
    // Create the table directly via knex so the route doesn't need full mode.
    const knex = openKnex[openKnex.length - 1];
    await knex.raw('CREATE TABLE empty_tbl (id INTEGER)');

    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT * FROM empty_tbl' });
    expect(status).toBe(200);
    const body = json as { rows: unknown[]; rowCount: number };
    expect(body.rowCount).toBe(0);
    expect(body.rows).toHaveLength(0);
  });
});

// ── write mode ────────────────────────────────────────────────────────────────

describe('POST /api/query — write mode', () => {
  let baseUrl: string;

  beforeEach(async () => {
    const knex = makeKnex();
    openKnex.push(knex);

    // Seed a table directly so INSERT/UPDATE/DELETE tests have something to work with.
    await knex.raw('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    await knex.raw("INSERT INTO items (id, name) VALUES (1, 'alpha'), (2, 'beta')");

    const result = await startServer(knex, 'write');
    openServers.push(result.server);
    baseUrl = result.baseUrl;
  });

  it('allows SELECT', async () => {
    const { status } = await postQuery(baseUrl, { sql: 'SELECT * FROM items' });
    expect(status).toBe(200);
  });

  it('allows INSERT and returns 200', async () => {
    const { status, json } = await postQuery(baseUrl, {
      sql: "INSERT INTO items (id, name) VALUES (3, 'gamma')",
    });
    expect(status).toBe(200);
    // Non-SELECT statements return no rows but still include shape fields.
    const body = json as { columns: string[]; rows: unknown[]; rowCount: number; executionTime: number };
    expect(Array.isArray(body.columns)).toBe(true);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.executionTime).toBe('number');
  });

  it('INSERT is reflected in a subsequent SELECT', async () => {
    await postQuery(baseUrl, { sql: "INSERT INTO items (id, name) VALUES (99, 'new')" });

    const { status, json } = await postQuery(baseUrl, {
      sql: "SELECT name FROM items WHERE id = 99",
    });
    expect(status).toBe(200);
    const body = json as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]['name']).toBe('new');
  });

  it('allows UPDATE and returns 200', async () => {
    const { status } = await postQuery(baseUrl, {
      sql: "UPDATE items SET name = 'updated' WHERE id = 1",
    });
    expect(status).toBe(200);
  });

  it('allows DELETE and returns 200', async () => {
    const { status } = await postQuery(baseUrl, { sql: 'DELETE FROM items WHERE id = 2' });
    expect(status).toBe(200);
  });

  it('returns 403 for CREATE TABLE', async () => {
    const { status } = await postQuery(baseUrl, { sql: 'CREATE TABLE new_tbl (id INT)' });
    expect(status).toBe(403);
  });

  it('returns 403 for DROP TABLE', async () => {
    const { status } = await postQuery(baseUrl, { sql: 'DROP TABLE items' });
    expect(status).toBe(403);
  });
});

// ── full mode ─────────────────────────────────────────────────────────────────

describe('POST /api/query — full mode', () => {
  let baseUrl: string;

  beforeEach(async () => {
    const knex = makeKnex();
    openKnex.push(knex);
    const result = await startServer(knex, 'full');
    openServers.push(result.server);
    baseUrl = result.baseUrl;
  });

  it('allows CREATE TABLE via the route', async () => {
    const { status } = await postQuery(baseUrl, {
      sql: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)',
    });
    expect(status).toBe(200);
  });

  it('data inserted after CREATE is visible in a SELECT', async () => {
    await postQuery(baseUrl, {
      sql: 'CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT)',
    });
    await postQuery(baseUrl, { sql: "INSERT INTO products VALUES (1, 'widget')" });

    const { status, json } = await postQuery(baseUrl, { sql: 'SELECT * FROM products' });
    expect(status).toBe(200);
    const body = json as { rows: Array<Record<string, unknown>>; rowCount: number };
    expect(body.rowCount).toBe(1);
    expect(body.rows[0]['name']).toBe('widget');
  });

  it('allows DROP TABLE', async () => {
    await postQuery(baseUrl, { sql: 'CREATE TABLE tmp (id INT)' });
    const { status } = await postQuery(baseUrl, { sql: 'DROP TABLE tmp' });
    expect(status).toBe(200);
  });

  it('returns 400 for a DB error even in full mode', async () => {
    // Dropping a table that doesn't exist is a DB error, not a permission error.
    const { status, json } = await postQuery(baseUrl, { sql: 'DROP TABLE no_such_table_xyz' });
    expect(status).toBe(400);
    expect((json as { error: string }).error).toBeTruthy();
  });
});
