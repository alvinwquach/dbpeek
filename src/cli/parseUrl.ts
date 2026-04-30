// ===== FILE PURPOSE =====
// Parses a database connection URL string into a partial ConnectionConfig.
// Isolated here so the URL-parsing logic can be read and tested independently
// of commander option parsing in index.ts.

import { type ConnectionConfig, type Dialect, DEFAULT_PORTS } from "../types/connection.js";

// ===== CONSTANTS =====

/**
 * Maps a WHATWG URL protocol string (includes trailing colon) to a Dialect.
 *
 * WHY `Record<string, Dialect>` and not `Record<Dialect, ...>` or a Map:
 *   The keys here are URL protocol strings like "postgres:" — they are not
 *   Dialect values themselves, so `Record<Dialect, ...>` would be the wrong key
 *   type. A plain object with `Record<string, Dialect>` gives O(1) keyed lookup
 *   without needing a Map. We don't need Map's iteration guarantees or non-string
 *   key support, so the simpler object literal is the right choice.
 *
 * WHY the trailing colon on every key:
 *   The WHATWG URL constructor always returns `URL.protocol` with a trailing colon
 *   (e.g. "postgres:", never "postgres"). Storing keys in that exact form means the
 *   lookup `PROTOCOL_TO_DIALECT[parsed.protocol]` works with no string manipulation.
 *
 * WHY aliases (postgresql, mysql2, sqlserver) are included:
 *   These are real scheme variants that users copy from their existing configs or
 *   ORMs. Rejecting them would force unnecessary URL rewrites.
 */
const PROTOCOL_TO_DIALECT: Record<string, Dialect> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "mysql2:": "mysql",
  "mssql:": "mssql",
  "sqlserver:": "mssql",
  // sqlite: is absent — SQLite connections are file paths, not URLs.
};

// ===== URL PARSER =====

/**
 * Parses a database connection URL into a partial ConnectionConfig.
 *
 * WHY the return type is `Partial<ConnectionConfig> & { dialect: Dialect }`:
 *   `Partial<ConnectionConfig>` signals that not every field is guaranteed to be
 *   present — a URL like "postgres://localhost/db" omits user, password, and port,
 *   so those fields are undefined. The `& { dialect: Dialect }` intersection makes
 *   dialect non-optional because it is always derivable from the URL protocol; if
 *   it cannot be derived, this function throws instead of returning. This lets the
 *   caller (getConnectionConfig) safely read `urlFields.dialect` without a null
 *   check while still treating every other field as potentially absent.
 *
 * WHY not return a full `ConnectionConfig`:
 *   This function's only job is to extract what the URL contains. Filling in
 *   defaults (host fallback, port default, permission mode) is the caller's
 *   responsibility — it has the flag values needed for the merge. Keeping the
 *   boundary clean means this function can be tested in isolation without needing
 *   to know anything about commander flags or DEFAULT_PORTS.
 *
 * HOW it works:
 *   1. Feed the string to the WHATWG URL constructor for standards-based parsing.
 *   2. Map URL.protocol to a Dialect via PROTOCOL_TO_DIALECT.
 *   3. Parse URL.port (empty string when omitted → fall back to dialect default).
 *   4. Strip the leading "/" from URL.pathname to get the database name.
 *   5. Decode percent-encoded characters in username, password, and pathname.
 *
 * @param urlString - A raw connection URL string from the CLI positional argument.
 * @returns Partial config with all fields present in the URL decoded and typed.
 * @throws {Error} when the URL is syntactically invalid or uses an unsupported protocol.
 */
export function parseConnectionUrl(
  urlString: string
): Partial<ConnectionConfig> & { dialect: Dialect } {
  // WHY the try/catch around `new URL()`:
  //   The WHATWG URL constructor throws a TypeError on malformed input (e.g. a bare
  //   word or a SQLite file path). We catch that and re-throw a human-friendly Error
  //   with an example of the expected format, because a raw TypeError message
  //   ("Failed to construct 'URL': Invalid URL") is not useful to a CLI user.
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(
      `Invalid connection string: "${urlString}". ` +
        `Expected a URL like postgres://user:pass@host:5432/dbname`
    );
  }

  const dialect = PROTOCOL_TO_DIALECT[parsed.protocol];
  if (!dialect) {
    throw new Error(
      `Unsupported protocol "${parsed.protocol.replace(":", "")}" in connection string. ` +
        `Supported: postgres, postgresql, mysql, mssql, sqlserver`
    );
  }

  // WHY fall back to DEFAULT_PORTS when URL.port is empty:
  //   URL.port is an empty string (not undefined) when the port is omitted from
  //   the URL. We resolve the dialect default here so the merged config always
  //   has a concrete number rather than undefined, which keeps the merge logic
  //   in getConnectionConfig simpler.
  const port =
    parsed.port !== "" ? parseInt(parsed.port, 10) : DEFAULT_PORTS[dialect];

  // WHY slice(1) on pathname:
  //   URL.pathname always includes the leading "/" (e.g. "/mydb"). The database
  //   name is everything after that slash.
  const rawPath = parsed.pathname.slice(1);

  // WHY decodeURIComponent on pathname, username, and password:
  //   The URL constructor percent-encodes special characters in these components
  //   (e.g. a database named "my database" becomes "my%20database" in the URL).
  //   Passing the encoded form to knex would cause a "database not found" error,
  //   so we decode back to the original string before returning.
  const database = rawPath ? decodeURIComponent(rawPath) : "";
  const user = parsed.username ? decodeURIComponent(parsed.username) : "";
  const password = parsed.password ? decodeURIComponent(parsed.password) : "";

  // WHY URL.hostname instead of URL.host:
  //   URL.host includes the port suffix ("localhost:5432"), while URL.hostname is
  //   just the bare hostname ("localhost"). We store host and port separately, so
  //   hostname is the right property here.
  const host = parsed.hostname || "localhost";

  return { dialect, host, port, database, user, password };
}
