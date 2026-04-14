/**
 * src/server/db.ts
 *
 * Knex connection manager — the single place where database connections are created.
 * All route handlers should receive a Knex instance from here rather than
 * constructing their own, so connection config stays in one place.
 *
 * What is Knex?
 *   Knex is a "query builder" — a library that lets you write database queries
 *   in JavaScript/TypeScript instead of raw SQL strings. It also handles
 *   connecting to many different database types using the same API.
 *
 * Pseudocode:
 *   1. Accept a ConnectionConfig describing which client driver to use
 *      and the raw connection string from the CLI
 *   2. Initialise a Knex instance with those settings
 *   3. Return the instance so callers can run queries (.select, .raw, etc.)
 *
 * Supported clients (driven by the connection string scheme):
 *   - 'pg'             → PostgreSQL  (requires the `pg` package)
 *   - 'mysql2'         → MySQL / MariaDB  (requires the `mysql2` package)
 *   - 'better-sqlite3' → SQLite  (requires the `better-sqlite3` package)
 *   - 'tedious'        → Microsoft SQL Server  (requires the `tedious` package)
 */

import knex, { type Knex } from 'knex';

// An "interface" in TypeScript is like a blueprint that describes the shape
// of an object — it lists the fields it must have and what type each field is.
// This one describes the minimum information needed to open a database connection.
export interface ConnectionConfig {
  // Knex client identifier — maps directly to the driver package name.
  // Think of a "driver" as a translator between our code and a specific database.
  // e.g. 'pg', 'mysql2', 'better-sqlite3', 'tedious'
  client: string;

  // Standard database URL supplied by the user on the command line.
  // The format is: scheme://username:password@host:port/database_name
  // e.g. postgres://user:pass@localhost:5432/mydb
  connectionString: string;
}

/**
 * createConnection
 *
 * Initialises and returns a Knex instance for the given database.
 *
 * Important: Knex is "lazy" — calling this function does NOT immediately
 * open a network connection to your database. No socket is opened, no
 * credentials are checked. The real connection only happens the moment
 * you run your first query (e.g. knex.select(...) or knex.raw(...)).
 * This keeps startup fast and avoids wasting connections until they're needed.
 *
 * @param config - client driver name and connection URL
 * @returns       a ready-to-use Knex query builder (but not yet connected)
 */
export function createConnection(config: ConnectionConfig): Knex {
  return knex({
    client: config.client,               // tells Knex which driver package to load
    connection: config.connectionString, // the URL is passed directly to that driver
  });
}

// Re-export the Knex type so other files can reference it without importing
// from the 'knex' package directly. This keeps imports consistent across the codebase.
// (A "type" export only exists at compile time — it produces no runtime code.)
export type { Knex };
