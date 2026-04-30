// ===== FILE PURPOSE =====
// Knex connection manager — the single source of truth for database access.
//
// WHY Knex:
//   It wraps pg, mysql2, better-sqlite3, and tedious behind ONE API.
//   We call knex.raw(userSQL) to execute user queries — Knex is NOT building
//   queries, just managing the connection pool and normalising results across
//   dialects. This keeps route handlers dialect-agnostic.
//
// WHY a shared instance:
//   The pool is created ONCE here and shared by reference to all route handlers.
//   This avoids the "orphaned pool" bug where the CLI and the API routes each
//   create their own pool, consuming twice the server-side connection slots and
//   making graceful shutdown impossible (you can only destroy a pool you hold a
//   reference to).
//
// ARCHITECTURE:
//   createKnexInstance(config) → Knex   (synchronous factory, no I/O)
//   testConnection(db)         → Promise<void>  (verifies reachability)
//   destroyConnection(db)      → Promise<void>  (drains the pool cleanly)
//
//   The CLI calls all three in sequence:
//     const db = createKnexInstance(config);
//     await testConnection(db);   // fail fast before starting Express
//     ...
//     await destroyConnection(db); // graceful shutdown on SIGINT/SIGTERM

import knex, { type Knex } from "knex";
// WHY import Dialect alongside ConnectionConfig:
//   Dialect is used as the key type in DIALECT_TO_KNEX_CLIENT's Record<Dialect, string>.
//   Without it, the Record would fall back to Record<string, string>, losing the
//   exhaustiveness check that causes a compile error when a new dialect is added
//   to the union but not to the map.
import type { ConnectionConfig, Dialect } from "../types/connection.js";

// Re-export Knex type so route handlers can annotate `db` parameters without
// importing knex themselves. Prevents every route file from depending on knex
// directly, which would make it harder to swap the DB layer later.
export type { Knex };

// ===== DIALECT → KNEX CLIENT MAP =====

/**
 * Maps the user-facing Dialect string to the internal knex client identifier.
 *
 * WHY a Record<Dialect, string> lookup instead of a switch/if-else chain:
 *   The lookup table is exhaustiveness-checked by TypeScript — adding a new
 *   Dialect to the union without updating this map is a compile-time error.
 *   A switch/if-else chain would silently fall through to a default branch.
 *
 * WHY the knex client names differ from our Dialect names:
 *   Knex uses its own internal identifiers ("pg", "mysql2", "tedious",
 *   "better-sqlite3") that don't match the dialect names users type at the CLI
 *   ("postgres", "mysql", "mssql", "sqlite"). This map is the single place that
 *   translates between the two naming schemes.
 */
const DIALECT_TO_KNEX_CLIENT: Record<Dialect, string> = {
  postgres: "pg",
  mysql: "mysql2",
  mssql: "tedious",
  sqlite: "better-sqlite3",
};

// ===== CONNECTION SHAPE HELPERS =====

/**
 * Builds the `connection` value passed to the knex config for network dialects.
 *
 * WHY a function instead of inlining:
 *   The connection object shape is different for each dialect — pg accepts a
 *   flat object, tedious requires a nested `options` sub-object for the
 *   database name. Isolating this logic here keeps createKnexInstance() readable
 *   and makes dialect-specific quirks easy to find and change.
 *
 * @param config - The fully-resolved ConnectionConfig from the CLI parser.
 * @param dialect - The resolved dialect (same as config.dialect, passed
 *   explicitly to help TypeScript narrow the return type per branch).
 */
function buildNetworkConnection(
  config: ConnectionConfig
): Knex.ConnectionConfig {
  if (config.dialect === "mssql") {
    // WHY the `options` sub-object for tedious (MSSQL driver):
    //   The tedious client requires the database name inside `options.database`
    //   rather than at the top level. Passing `database` at the top level is
    //   silently ignored, causing a "Login failed" or "default database" error.
    //   This is a tedious quirk not shared by pg or mysql2.
    return {
      server: config.host,
      user: config.user,
      password: config.password,
      options: {
        database: config.database,
        port: config.port,
        // WHY encrypt: false by default:
        //   Local dev SQL Server instances (e.g. Docker) typically don't have a
        //   valid TLS certificate. Setting encrypt to false avoids the
        //   "UNABLE_TO_VERIFY_LEAF_SIGNATURE" error that would otherwise block
        //   every local connection attempt. Users connecting to Azure SQL or a
        //   production instance should set this to true — but that's a future
        //   --ssl flag, not a concern for the initial localhost-first tool.
        encrypt: false,
        // WHY trustServerCertificate: true alongside encrypt: false:
        //   These are two separate tedious settings. encrypt: false disables the
        //   TLS requirement, but some SQL Server versions still attempt a handshake
        //   and reject the connection if the certificate can't be verified.
        //   trustServerCertificate: true suppresses that verification step,
        //   ensuring local Docker instances with self-signed certs connect cleanly.
        trustServerCertificate: true,
      },
    } as unknown as Knex.ConnectionConfig;
  }

  // pg and mysql2 share the same flat connection shape.
  // WHY `as unknown as Knex.ConnectionConfig`:
  //   Knex's public ConnectionConfig type doesn't declare top-level `port` —
  //   it is only valid inside driver-specific sub-types that aren't exposed.
  //   The cast is safe: pg and mysql2 both accept this object at runtime.
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  } as unknown as Knex.ConnectionConfig;
}

// ===== PUBLIC API =====

/**
 * Creates a Knex instance from a resolved ConnectionConfig.
 *
 * WHY synchronous (no async/await):
 *   knex() only validates the config and sets up the pool factory — it does NOT
 *   open a socket. The actual TCP handshake happens lazily on the first query.
 *   Making this function async would be misleading: a returned Promise<Knex>
 *   would imply network I/O happened, but it wouldn't have. Callers who need
 *   connectivity proof should call testConnection() separately.
 *
 * WHY pool min:0, max:5:
 *   min:0 means the pool starts empty and opens connections on demand. For a
 *   single-user localhost tool that runs ~2 req/min, there is no reason to keep
 *   a warm idle connection burning a server-side slot at all times.
 *   max:5 is generous for one user — real workloads rarely exceed 1-2 concurrent
 *   queries — but leaves headroom for schema browsing tabs that might fire a few
 *   parallel requests.
 *
 * @param config - Fully resolved ConnectionConfig produced by getConnectionConfig().
 * @returns A configured Knex instance (pool not yet active; no I/O performed).
 */
export function createKnexInstance(config: ConnectionConfig): Knex {
  const client = DIALECT_TO_KNEX_CLIENT[config.dialect];

  // WHY the conditional connection shape:
  //   better-sqlite3 is a synchronous, file-based driver. Knex requires the
  //   connection to be `{ filename: string }` for SQLite; passing a plain object
  //   with host/port causes a runtime crash inside the driver. All other dialects
  //   use the network connection shape built by buildNetworkConnection().
  const connection =
    config.dialect === "sqlite"
      ? { filename: config.database }
      : buildNetworkConnection(config);

  return knex({
    client,
    connection,

    // WHY useNullAsDefault only for SQLite:
    //   SQLite does not support DEFAULT expressions for most column types, so knex
    //   substitutes NULL when a value is omitted in an INSERT. Without this flag,
    //   knex emits a noisy warning on every insert. We enable it only for SQLite
    //   because the other drivers handle DEFAULT correctly and we don't want to
    //   suppress a useful warning for them.
    useNullAsDefault: config.dialect === "sqlite",

    pool: {
      min: 0,
      max: 5,
    },
  });
}

/**
 * Probes the database to confirm it is reachable and credentials are accepted.
 *
 * WHY a separate function from createKnexInstance:
 *   Separating creation from validation lets callers (and tests) mock one
 *   without the other. The CLI needs to call both; tests that only want to
 *   verify pool configuration can call createKnexInstance() without triggering
 *   real network I/O.
 *
 * WHY `SELECT 1` as the probe query:
 *   It is the lightest query that works across all four supported dialects
 *   without touching any user table. It forces the pool to open a real TCP
 *   connection and run the auth handshake, surfacing credential or network
 *   errors at startup rather than inside a route handler.
 *
 * WHY we re-throw with a prefixed message:
 *   The raw driver errors (e.g. "ECONNREFUSED", "password authentication failed
 *   for user "alice"") are terse and don't mention dbpeek context. Wrapping them
 *   gives the user a clear starting point: "Cannot connect to postgres database
 *   mydb: ECONNREFUSED".
 *
 * @param db - A Knex instance created by createKnexInstance().
 * @param config - The config used to build `db`, used only for the error message.
 * @throws {Error} with a human-friendly message when the DB is unreachable or
 *   credentials are rejected.
 */
export async function testConnection(
  db: Knex,
  config: ConnectionConfig
): Promise<void> {
  try {
    await db.raw("SELECT 1");
  } catch (err: unknown) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot connect to ${config.dialect} database "${config.database}" ` +
        `on ${config.host}:${config.port}: ${cause}`
    );
  }
}

/**
 * Drains the connection pool and releases all database sockets.
 *
 * WHY this must be called on shutdown:
 *   knex uses a pool (tarn.js under the hood) that keeps idle connections alive.
 *   If the process exits without destroying the pool, those server-side
 *   connections remain in IDLE state until the database server times them out
 *   (typically 8h for Postgres, 28800s for MySQL). On a shared database this
 *   wastes connection slots. Calling destroy() sends the proper TCP FIN and
 *   lets the server reclaim the slot immediately.
 *
 * WHY async:
 *   db.destroy() returns a Promise that resolves only after all connections
 *   have been closed. Awaiting it ensures the process doesn't exit while sockets
 *   are still in CLOSE_WAIT. Without await, a `process.exit()` immediately after
 *   would leave the pool in a partially-drained state.
 *
 * @param db - The Knex instance to destroy. Safe to call even if the pool is
 *   already empty (knex handles the no-op case internally).
 */
export async function destroyConnection(db: Knex): Promise<void> {
  await db.destroy();
}
