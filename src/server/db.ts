/**
 * src/server/db.ts
 *
 * Knex connection manager — the single place in the codebase where database
 * connections are created and destroyed.
 *
 * ─── What is Knex? ───────────────────────────────────────────────────────────
 * Knex is a "query builder" — a library that lets you build and run database
 * queries in TypeScript/JavaScript without writing raw SQL strings by hand.
 * More importantly for us, it supports many different database engines through
 * the same API, so the rest of the app doesn't need to care whether it's
 * talking to Postgres, MySQL, SQLite, or SQL Server.
 *
 * ─── Lazy connections ────────────────────────────────────────────────────────
 * Knex is lazy: calling createKnexInstance() does NOT immediately open a
 * network socket or check credentials. The real TCP handshake only happens
 * the first time you run a query (e.g. knex.raw('SELECT 1')). This keeps
 * startup fast and avoids wasting connections until they are actually needed.
 *
 * ─── Connection pooling ──────────────────────────────────────────────────────
 * A connection pool is a cache of pre-opened database connections that can be
 * reused across requests. Opening a new TCP connection on every HTTP request
 * is slow (100-300 ms for the TLS + auth handshake). Pooling keeps a small
 * number of connections alive and hands them out to callers on demand.
 *
 * Our pool settings:
 *   min: 0  — start with zero open connections (don't connect until needed)
 *   max: 5  — never hold more than 5 simultaneous connections
 *
 * ─── Supported dialects → Knex client names ──────────────────────────────────
 *   'postgres' → 'pg'             (requires the `pg` npm package)
 *   'mysql'    → 'mysql2'         (requires the `mysql2` npm package)
 *   'sqlite'   → 'better-sqlite3' (requires the `better-sqlite3` npm package)
 *   'mssql'    → 'mssql'          (requires the `tedious` npm package)
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────
 *   ConnectionConfig        — TypeScript interface describing the config shape
 *   createKnexInstance(cfg) — factory function that returns a Knex instance
 *   testConnection(knex)    — runs SELECT 1 to verify the connection works
 *   destroyConnection(knex) — drains the pool for graceful shutdown
 *   Knex                    — re-exported type so callers don't need to import knex directly
 */

import knex, { type Knex } from 'knex';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The four database engines dbpeek supports.
 *
 * Using a union type ('a' | 'b' | ...) instead of plain `string` gives us a
 * compile-time guarantee: TypeScript will flag a typo like 'oracledb' the
 * moment you type it — not at runtime when a real user hits the error.
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

/**
 * All the information needed to open a database connection.
 *
 * Fields marked `?` are optional (may be undefined).
 * Fields without `?` are required — TypeScript will error if they're missing.
 *
 * Why `interface` and not `type`?
 *   By convention, use `interface` for object shapes that describe a contract
 *   (a bag of named fields). Use `type` for aliases of primitives or unions.
 *   Both work the same here — it's mainly a style signal.
 */
export interface ConnectionConfig {
  /** Which database engine to connect to. */
  dialect: Dialect;
  /** Hostname or IP of the database server. Not needed for SQLite. */
  host?: string;
  /** TCP port of the database server. Not needed for SQLite. */
  port?: number;
  /**
   * Database name (Postgres / MySQL / MSSQL) or file path (SQLite).
   * SQLite example: ':memory:' for a temporary in-memory database, or
   * './data/mydb.sqlite' for a file on disk.
   */
  database: string;
  /** Username to authenticate with. */
  user?: string;
  /** Password to authenticate with. */
  password?: string;
}

// ── Lookup table ──────────────────────────────────────────────────────────────

/**
 * Maps our dialect names to the Knex client string that Knex expects.
 *
 * Why a lookup object instead of a switch/if-else chain?
 *   1. It's shorter and easier to scan.
 *   2. TypeScript's Record<Dialect, string> guarantees every dialect has an
 *      entry — add a new dialect to the Dialect union and the compiler
 *      immediately tells you to add a row here.
 *   3. Lookup objects are O(1) — tiny win, but good habit.
 *
 * Record<K, V> is a TypeScript utility type meaning "an object whose keys are
 * exactly the members of K, and whose values are all of type V."
 */
const DIALECT_TO_KNEX_CLIENT: Record<Dialect, string> = {
  postgres: 'pg',
  mysql: 'mysql2',
  sqlite: 'better-sqlite3',
  mssql: 'mssql',
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * createKnexInstance
 *
 * Builds and returns a configured Knex query-builder instance.
 *
 * Pseudocode:
 *   1. Look up the Knex client name from our DIALECT_TO_KNEX_CLIENT map.
 *   2. Build the `connection` object that Knex passes to the driver.
 *      - For SQLite: only the `filename` field is needed.
 *      - For all others: host, port, database, user, password.
 *   3. Call knex({ client, connection, pool }) and return the result.
 *      Knex does NOT open any sockets at this point — it is lazy.
 *
 * @param config - dialect + host/port/database/user/password
 * @returns       a ready-to-use Knex instance (not yet connected)
 */
export function createKnexInstance(config: ConnectionConfig): Knex {
  // Step 1: resolve the Knex client identifier.
  // e.g. 'postgres' → 'pg', 'sqlite' → 'better-sqlite3'
  const client = DIALECT_TO_KNEX_CLIENT[config.dialect];

  // Step 2: build the connection object.
  //
  // SQLite is a local file — it uses `filename` instead of host/port/user.
  // ':memory:' is a special SQLite value meaning "create a temporary in-memory
  // database" — useful for tests because nothing is written to disk.
  //
  // For all other dialects we pass the standard network fields.
  // Knex passes this object directly to the underlying driver, so we only
  // include fields that are actually defined (no undefined values).
  const connection =
    config.dialect === 'sqlite'
      ? { filename: config.database }
      : {
          host: config.host,
          port: config.port,
          database: config.database,
          user: config.user,
          password: config.password,
        };

  // Step 3: initialise Knex.
  //
  // knex({ client, connection, pool, useNullAsDefault })
  //   client         — which driver package to load
  //   connection     — the credentials/address built above
  //   pool.min       — don't open connections until the first query
  //   pool.max       — cap at 5 simultaneous connections
  //   useNullAsDefault — SQLite-specific: tells Knex to use NULL for missing
  //                      values instead of the string 'DEFAULT', which SQLite
  //                      does not understand. It's a no-op for other drivers.
  return knex({
    client,
    connection,
    pool: {
      min: 0, // start with zero open connections
      max: 5, // never exceed 5 at once
    },
    useNullAsDefault: true, // safe to set for all dialects; required for SQLite
  });
}

// ── Health check ──────────────────────────────────────────────────────────────

/**
 * testConnection
 *
 * Runs a minimal query to verify that the database is reachable and that the
 * credentials are correct.
 *
 * Pseudocode:
 *   1. Run `SELECT 1` — the simplest possible query that every SQL dialect
 *      supports. It doesn't touch any tables, so it works even on an empty DB.
 *   2. If the query succeeds, return true.
 *   3. If it throws (wrong password, host unreachable, etc.), let the error
 *      bubble up so the caller can show a helpful message to the user.
 *
 * Why not return false on error instead of throwing?
 *   Errors contain useful details (e.g. "connection refused", "role does not
 *   exist"). Swallowing them would make debugging hard. Let the caller decide
 *   whether to re-throw or catch and display a friendly message.
 *
 * @param knexInstance - the Knex instance to test
 * @returns              true if the connection works
 * @throws               if the database is unreachable or credentials are wrong
 */
export async function testConnection(knexInstance: Knex): Promise<boolean> {
  // knex.raw() runs a raw SQL string without going through the query builder.
  // 'SELECT 1' is recognised by every SQL database engine in existence.
  await knexInstance.raw('SELECT 1');
  return true;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

/**
 * destroyConnection
 *
 * Drains and closes the connection pool so the Node.js process can exit
 * cleanly without leaving orphaned TCP connections behind.
 *
 * When should you call this?
 *   On SIGINT (Ctrl-C), SIGTERM (kill signal from Docker/systemd), or any
 *   other situation where the server is shutting down intentionally.
 *   Failing to call this on exit often causes Node.js to hang for several
 *   seconds while idle connections time out.
 *
 * Pseudocode:
 *   1. Call knex.destroy() — Knex drains in-progress queries, then closes
 *      every socket in the pool.
 *   2. Return the resulting Promise so the caller can await it.
 *
 * @param knexInstance - the Knex instance whose pool should be drained
 * @returns              a Promise that resolves once all connections are closed
 */
export async function destroyConnection(knexInstance: Knex): Promise<void> {
  // knex.destroy() returns a Promise — we await it so callers can chain
  // shutdown steps (e.g. "close DB, then close HTTP server, then exit").
  await knexInstance.destroy();
}

// ── Re-export ─────────────────────────────────────────────────────────────────

// Re-export the Knex type so other files can write `import type { Knex } from
// './db.js'` instead of importing from the 'knex' package directly.
// The `type` keyword means this export vanishes at runtime — it's only used
// by the TypeScript compiler to check types.
export type { Knex };
