/**
 * tests/server/db.test.ts
 *
 * Tests for the Knex connection manager in src/server/db.ts.
 *
 * Strategy: we use SQLite (better-sqlite3) as the test database because it
 * requires no running server — the database is just a temporary in-memory
 * file. This lets us test real Knex behaviour (driver selection, pooling,
 * query execution) without any network dependencies.
 *
 * For other dialects we verify that createKnexInstance maps the dialect string
 * to the correct Knex client name without actually opening a connection
 * (Knex is lazy — it only connects on the first query).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createKnexInstance, testConnection, destroyConnection } from '../../src/server/db.js';
import type { ConnectionConfig } from '../../src/server/db.js';
import type { Knex } from 'knex';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build an in-memory SQLite config — fast, no server required. */
function sqliteConfig(): ConnectionConfig {
  return {
    dialect: 'sqlite',
    database: ':memory:',
  };
}

// ── createKnexInstance ────────────────────────────────────────────────────────

describe('createKnexInstance', () => {
  const instances: Knex[] = [];

  afterEach(async () => {
    // Destroy all instances created during the test to prevent open handles.
    for (const k of instances.splice(0)) {
      await k.destroy();
    }
  });

  it('returns a Knex instance for sqlite', () => {
    const k = createKnexInstance(sqliteConfig());
    instances.push(k);
    // Knex instances expose a `.client` property whose constructor name reflects
    // the loaded driver. A truthy value here confirms we got a real Knex object.
    expect(k).toBeDefined();
    expect(typeof k.raw).toBe('function');
  });

  it('configures pool min=0 and max=5', () => {
    const k = createKnexInstance(sqliteConfig());
    instances.push(k);
    // Access the internal pool configuration via Knex's client object.
    const poolConfig = (k.client as { config: { pool?: { min?: number; max?: number } } }).config
      .pool;
    expect(poolConfig?.min).toBe(0);
    expect(poolConfig?.max).toBe(5);
  });

  it('maps postgres dialect to pg client', () => {
    const cfg: ConnectionConfig = {
      dialect: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'testdb',
      user: 'user',
      password: 'pass',
    };
    const k = createKnexInstance(cfg);
    instances.push(k);
    // We can't connect, but we can verify the Knex client name was set correctly.
    expect((k.client as { driverName?: string }).driverName ?? k.client.constructor.name).toMatch(
      /pg|Client_PG/i
    );
  });

  it('maps mysql dialect to mysql2 client', () => {
    const cfg: ConnectionConfig = {
      dialect: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'testdb',
      user: 'user',
      password: 'pass',
    };
    const k = createKnexInstance(cfg);
    instances.push(k);
    expect(k.client.constructor.name).toMatch(/mysql/i);
  });

  it('maps mssql dialect to tedious client', () => {
    const cfg: ConnectionConfig = {
      dialect: 'mssql',
      host: 'localhost',
      port: 1433,
      database: 'testdb',
      user: 'sa',
      password: 'pass',
    };
    const k = createKnexInstance(cfg);
    instances.push(k);
    expect(k.client.constructor.name).toMatch(/mssql|tedious/i);
  });
});

// ── testConnection ────────────────────────────────────────────────────────────

describe('testConnection', () => {
  it('resolves to true for a valid in-memory SQLite database', async () => {
    const k = createKnexInstance(sqliteConfig());
    try {
      const ok = await testConnection(k);
      expect(ok).toBe(true);
    } finally {
      await k.destroy();
    }
  });

  it('rejects (throws) when the database is unreachable', async () => {
    // Connect to a postgres host that doesn't exist — the query will fail.
    const k = createKnexInstance({
      dialect: 'postgres',
      host: '127.0.0.1',
      port: 19999, // nothing listening here
      database: 'nonexistent',
      user: 'nobody',
      password: 'wrong',
    });
    try {
      await expect(testConnection(k)).rejects.toThrow();
    } finally {
      await k.destroy();
    }
  });
});

// ── destroyConnection ─────────────────────────────────────────────────────────

describe('destroyConnection', () => {
  it('destroys the connection pool without throwing', async () => {
    const k = createKnexInstance(sqliteConfig());
    // Run a query first to ensure the pool actually opened a connection.
    await testConnection(k);
    // destroyConnection should complete without error.
    await expect(destroyConnection(k)).resolves.toBeUndefined();
  });

  it('can be called on a knex instance that was never queried', async () => {
    const k = createKnexInstance(sqliteConfig());
    // Knex is lazy — no connection opened yet. Destroy should still succeed.
    await expect(destroyConnection(k)).resolves.toBeUndefined();
  });
});
