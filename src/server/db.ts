import knex, { type Knex } from "knex";

// Re-export the Knex type so route handlers can type-hint the db parameter
// without importing knex themselves.
export type { Knex };

// ===== CLIENT DETECTION =====

/**
 * Derives the knex client name from the protocol prefix of a connection string.
 *
 * WHY a plain function instead of a lookup map:
 *   The detection logic uses startsWith() rather than URL parsing because SQLite
 *   connection strings are bare file paths ("./mydb.sqlite", "/var/data/db") with
 *   no protocol at all. A URL parser would throw on those inputs. The if/else chain
 *   handles the protocol cases first and falls through to SQLite for everything else.
 *
 * WHY this returns a string and not the Dialect type from src/types/connection.ts:
 *   Knex uses its own internal client identifiers ("pg", "mysql2", "tedious",
 *   "better-sqlite3") that differ from the user-facing dialect names ("postgres",
 *   "mysql", "mssql", "sqlite"). Keeping the return type as string avoids creating
 *   a false equivalence between the two naming schemes.
 */
function detectClient(connectionString: string): string {
  if (
    connectionString.startsWith("postgres://") ||
    connectionString.startsWith("postgresql://")
  ) {
    return "pg";
  }
  if (
    connectionString.startsWith("mysql://") ||
    connectionString.startsWith("mysql2://")
  ) {
    return "mysql2";
  }
  if (
    connectionString.startsWith("mssql://") ||
    connectionString.startsWith("sqlserver://")
  ) {
    return "tedious";
  }
  // Anything without a recognised scheme is treated as a SQLite file path.
  // This makes `npx dbpeek ./mydb.sqlite` work without any prefix.
  return "better-sqlite3";
}

// ===== CONNECTION FACTORY =====

/**
 * Builds a knex instance and verifies connectivity before returning it.
 *
 * WHY `async` / `Promise<Knex>`:
 *   `async` is required because we `await db.raw("select 1")` to probe the
 *   connection before handing the instance back to the caller. Without the probe,
 *   a misconfigured connection string would only surface as an error on the first
 *   real query — potentially inside a route handler, producing a confusing 500
 *   response rather than a startup-time failure. Returning a Promise<Knex> rather
 *   than a Knex directly makes the async contract explicit to callers: they must
 *   await this function before using the db handle.
 *
 * WHY we don't just return the knex instance synchronously:
 *   knex() itself is synchronous — it only validates config, it does not open a
 *   socket. The async work (TCP handshake, auth, TLS) happens lazily on the first
 *   query. Awaiting db.raw("select 1") here forces that work to happen at startup
 *   so we can fail fast with a clear error message instead of silently serving a
 *   broken app.
 *
 * @param connectionString - A database URL (postgres://, mysql://, mssql://) or a
 *   SQLite file path. Passed directly to knex; not validated here.
 * @returns A connected, pool-initialised Knex instance ready for queries.
 * @throws {Error} if the database is unreachable or the credentials are rejected.
 */
export async function createConnection(connectionString: string): Promise<Knex> {
  const client = detectClient(connectionString);

  const db = knex({
    client,

    // WHY the conditional connection shape:
    //   knex accepts a raw connection string for pg, mysql2, and tedious.
    //   better-sqlite3 is different — it is a synchronous, file-based driver
    //   that does not use a connection string at all. knex requires the connection
    //   to be an object with a `filename` key for SQLite; passing a bare string
    //   causes a runtime error inside the driver.
    connection:
      client === "better-sqlite3"
        ? { filename: connectionString }
        : connectionString,

    // WHY useNullAsDefault:
    //   SQLite does not support DEFAULT expressions for most column types, so knex
    //   substitutes NULL when a value is omitted in an INSERT. Without this flag,
    //   knex emits a warning on every insert. Setting it to true only for SQLite
    //   (where it is needed) avoids suppressing the warning for other dialects
    //   where it would mask a real misconfiguration.
    useNullAsDefault: client === "better-sqlite3",

    pool: {
      // WHY min: 1:
      //   Keeps one idle connection alive so the first real query doesn't pay
      //   the TCP handshake + auth cost. For SQLite this has no practical effect
      //   (file open is microseconds), but it is harmless and keeps the config
      //   consistent across dialects.
      min: 1,

      // WHY max: 10:
      //   A local dev tool is unlikely to run more than a handful of concurrent
      //   queries. Most database servers default to 100 max connections; staying
      //   at 10 avoids exhausting server-side connection limits in environments
      //   where dbpeek runs alongside other tools sharing the same database.
      max: 10,
    },
  });

  // WHY db.raw("select 1"):
  //   The lightest query that works across all four supported dialects without
  //   touching any user table. Forces the pool to open a real connection and run
  //   the auth handshake so we surface credential or network errors here at
  //   startup, not later inside a route handler.
  await db.raw("select 1");

  return db;
}
