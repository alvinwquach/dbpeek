import knex, { type Knex } from "knex";

// Re-export the Knex type so route handlers can type-hint the db parameter
// without importing knex themselves.
export type { Knex };

// Dialect detection: derive the knex client name from the protocol in the
// connection string. We do this once at startup so every route handler gets a
// fully-configured, already-connected pool — no lazy init, no per-request reconnects.
function detectClient(connectionString: string): string {
  if (connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://")) {
    return "pg";
  }
  if (connectionString.startsWith("mysql://") || connectionString.startsWith("mysql2://")) {
    return "mysql2";
  }
  if (connectionString.startsWith("mssql://") || connectionString.startsWith("sqlserver://")) {
    return "tedious";
  }
  // SQLite connection strings are file paths, not URLs.
  // Treat anything without a recognised scheme as a SQLite file path so that
  // `npx dbpeek ./mydb.sqlite` works without any prefix.
  return "better-sqlite3";
}

// createConnection builds a knex instance and verifies connectivity by running
// a trivial query. It throws on failure so the CLI can exit with a useful message
// before ever binding to a port.
export async function createConnection(connectionString: string): Promise<Knex> {
  const client = detectClient(connectionString);

  const db = knex({
    client,

    // knex accepts a raw connection string for pg, mysql2, and tedious.
    // For better-sqlite3 the connection object must be { filename: "..." }.
    connection: client === "better-sqlite3"
      ? { filename: connectionString }
      : connectionString,

    // useNullAsDefault silences a knex warning for SQLite: SQLite does not
    // support DEFAULT values for most column types, so knex substitutes NULL.
    useNullAsDefault: client === "better-sqlite3",

    pool: {
      // min: 1 keeps one connection alive so the first real query is fast.
      // For SQLite (which is file-based and has no network overhead) this has
      // no practical effect, but it's harmless.
      min: 1,

      // max: 10 is a safe default for a local dev tool.  Most databases default
      // to 100 max connections; we stay well below that.
      max: 10,
    },
  });

  // Probe the connection. `db.raw("select 1")` is the lightest possible query
  // and works across all supported dialects.
  await db.raw("select 1");

  return db;
}
