#!/usr/bin/env node
// ^^^ This "shebang" tells the OS to run this file with Node.js when executed
// directly (e.g. ./dist/cli/index.js). Without it, the shell wouldn't know
// what program to use.

/**
 * src/cli/index.ts
 *
 * The CLI entry point — the first code that runs when someone types `dbpeek`.
 *
 * ─── Responsibilities of this file ───────────────────────────────────────────
 * 1. Parse terminal arguments (flags + optional URL) into a ConnectionConfig.
 * 2. Map the parsed config to a Knex instance and permission mode.
 * 3. Verify the database is reachable (testConnection).
 * 4. Start the Express HTTP server, trying ports 3000–3010 in order.
 * 5. Open the user's default browser to the server URL.
 * 6. Shut down cleanly on Ctrl-C (SIGINT) or kill (SIGTERM).
 *
 * ─── Two ways to connect ─────────────────────────────────────────────────────
 *   URL argument:     npx dbpeek "postgres://user:pass@localhost:5432/mydb"
 *   Individual flags: npx dbpeek -d postgres -h localhost -P 5432 -D mydb
 *
 * ─── What this file exports ──────────────────────────────────────────────────
 *   ConnectionConfig       — TypeScript interface for a parsed config object
 *   Dialect                — union type of the four supported database engines
 *   getConnectionConfig()  — parses argv → ConnectionConfig
 *   startOnAvailablePort() — tries a list of ports, returns the bound one
 *
 * ─── What this file does NOT export ──────────────────────────────────────────
 *   The `main()` function is not exported because it should only be called once
 *   (when the real binary starts). Tests call getConnectionConfig() and
 *   startOnAvailablePort() directly instead of invoking main().
 *
 * ─── Pseudocode for main() ───────────────────────────────────────────────────
 *   1. Parse argv → ConnectionConfig
 *   2. Determine the permission mode from config.write / config.full
 *   3. Create a Knex instance with the parsed config
 *   4. Call testConnection(knex) — exit with error if it fails
 *   5. Create the Express app with createServer({ knex, mode })
 *   6. Call startOnAvailablePort(app, [3000, 3001, …, 3010])
 *   7. Print "dbpeek is running on http://localhost:<port>"
 *   8. Open the browser with the `open` package
 *   9. Register SIGINT + SIGTERM handlers that call destroyConnection + exit
 *
 * ─── Pseudocode for startOnAvailablePort() ───────────────────────────────────
 *   For each candidate port in the list:
 *     Try to bind app.listen(port)
 *     If it succeeds → return { server, port }
 *     If it fails with EADDRINUSE → try the next port
 *   If all ports are taken → throw "No available port found"
 */

import { Command } from 'commander';
import http from 'http';
import { fileURLToPath } from 'url';
import type { Express } from 'express';
import {
  createKnexInstance,
  testConnection,
  destroyConnection,
} from '../server/db.js';
import { createServer } from '../server/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The four database engines dbpeek supports.
 *
 * Why `type` and not `interface`?
 *   Use `type` when you're describing a simple value — a string, a union of
 *   strings, a tuple, etc. It cannot be extended with `extends` or merged by
 *   declaring it twice.
 *   Use `interface` (see ConnectionConfig below) when you're describing the
 *   shape of an object that other code might need to extend or implement.
 *
 * Why a union type (A | B | C)?
 *   A plain `string` would allow anything — someone could accidentally pass
 *   "oracle" and only find out at runtime. A union type is a compile-time
 *   contract: TypeScript will highlight the mistake the moment you type it,
 *   before you even run the code.
 */
export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

/**
 * The shape of the parsed connection config object.
 *
 * Why `interface` and not `type`?
 *   `interface` is the idiomatic choice when describing the structure of an
 *   object (a bag of named fields). It reads like a contract: "anything that
 *   claims to be a ConnectionConfig must have these fields."
 *   In practice, for a plain object like this the difference is mostly style,
 *   but `interface` signals intent — "this is an object shape, not a value alias."
 *
 * Fields marked with `?` are optional — they may be undefined.
 * Fields without `?` are required — TypeScript will error if they're missing.
 *
 * Examples of each field:
 *   dialect   → 'postgres'
 *   host      → 'localhost' or 'db.example.com'
 *   port      → 5432 (number, not a string)
 *   database  → 'mydb' or './data/mydb.sqlite' (SQLite uses a file path)
 *   user      → 'alice'
 *   password  → 's3cr3t'
 *   write     → true  (allows INSERT / UPDATE / DELETE)
 *   full      → true  (allows all DDL: CREATE / DROP / ALTER)
 */
export interface ConnectionConfig {
  dialect: Dialect;
  host?: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  write: boolean;
  full: boolean;
}

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

/**
 * Default TCP ports for each dialect.
 * When the user doesn't specify a port, we use the well-known default so
 * they don't have to type it every time.
 *
 * SQLite is a local file — it doesn't use a network port at all, so we
 * store 0 as a placeholder (it is never applied, see the port logic below).
 *
 * Why `Record<Dialect, number>` instead of a plain object `{ [key: string]: number }`?
 *   Record<K, V> is a TypeScript utility type meaning "an object with exactly
 *   the keys listed in K, each holding a value of type V."
 *
 *   Using `Record<Dialect, number>` instead of `{ [key: string]: number }` gives
 *   us two compile-time guarantees:
 *     1. Completeness: TypeScript will error if we forget to add an entry for a
 *        dialect — add a new dialect to the Dialect union and the compiler
 *        immediately tells you to update this table.
 *     2. No extras: we can't accidentally add a key like "oracle" that isn't
 *        a valid Dialect.
 */
const DIALECT_DEFAULT_PORTS: Record<Dialect, number> = {
  postgres: 5432,
  mysql: 3306,
  sqlite: 0, // not used — SQLite is a local file, not a network server
  mssql: 1433,
};

/**
 * Maps URL protocol strings (as returned by the built-in `URL` class) to
 * Dialect values.
 *
 * The `URL` class always includes the colon, so `new URL("postgres://...").protocol`
 * returns `"postgres:"` — that's why the keys have a trailing colon.
 *
 * We support both "postgres:" and "postgresql:" because both forms are used
 * in the wild (e.g. Heroku DATABASE_URL uses "postgres://").
 *
 * Why `Record<string, Dialect>` here instead of `Record<Dialect, ...>`?
 *   The keys are URL protocol strings (e.g. "postgres:"), which are not the
 *   same set as Dialect values. We're going the other direction — mapping an
 *   open-ended set of URL strings *to* a Dialect — so `string` is the right
 *   key type. We still benefit from the value constraint: only valid Dialect
 *   values are allowed on the right-hand side.
 */
const URL_SCHEME_TO_DIALECT: Record<string, Dialect> = {
  'postgres:': 'postgres',
  'postgresql:': 'postgres', // common alias — both mean the same dialect
  'mysql:': 'mysql',
  'mssql:': 'mssql',
};

// ---------------------------------------------------------------------------
// URL parser
// ---------------------------------------------------------------------------

/**
 * parseConnectionUrl
 *
 * Takes a raw connection URL string like "postgres://alice:s3cr3t@db.host:5432/mydb"
 * and returns a partial ConnectionConfig with whatever fields could be extracted.
 *
 * Why `Partial<ConnectionConfig>`?
 *   We only return the fields present in the URL. The caller (getConnectionConfig)
 *   merges this with any separately provided flags. `Partial<T>` is a TypeScript
 *   utility type that makes every field of T optional.
 *
 * URL anatomy reminder:
 *   postgres :// alice  : s3cr3t  @ db.host : 5432 / mydb
 *   ^^^^^^^^     ^^^^^   ^^^^^^^   ^^^^^^^   ^^^^   ^^^^
 *   protocol   username  password  hostname  port  pathname
 *
 * Special characters in passwords:
 *   Characters like "@" or "/" must be percent-encoded in a URL
 *   (e.g. "@" → "%40"). We call decodeURIComponent() to turn them back
 *   into their original form before storing them.
 */
function parseConnectionUrl(raw: string): Partial<ConnectionConfig> {
  // The built-in `URL` class parses any valid URL string into its components.
  // It throws a TypeError if the string isn't a valid URL.
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid connection URL: "${raw}"`);
  }

  // url.protocol is the scheme with a trailing colon, e.g. "postgres:"
  const dialect = URL_SCHEME_TO_DIALECT[url.protocol];
  if (!dialect) {
    // Strip the trailing colon for the error message so it reads naturally.
    throw new Error(
      `Unsupported URL scheme "${url.protocol.replace(':', '')}". ` +
        `Supported schemes: postgres://, mysql://, mssql://`
    );
  }

  // url.pathname is everything after the host:port — for a DB URL that's
  // the leading slash followed by the database name, e.g. "/mydb".
  // We strip the leading slash with replace() to get just "mydb".
  const database = url.pathname.replace(/^\//, '');
  if (!database) {
    throw new Error(`Connection URL is missing the database name (path segment).`);
  }

  // Start building the result with the fields we know for certain.
  const result: Partial<ConnectionConfig> = { dialect, database };

  // Only copy optional fields if they are actually present in the URL.
  // An empty string from url.hostname / url.port means the URL omitted it.
  if (url.hostname) result.host = url.hostname;

  // url.port is always a string (or ""). parseInt with radix 10 converts
  // it to a number — the ", 10" argument means "parse as base-10 (decimal)".
  if (url.port) result.port = parseInt(url.port, 10);

  // decodeURIComponent reverses percent-encoding, e.g. "%40" → "@"
  if (url.username) result.user = decodeURIComponent(url.username);
  if (url.password) result.password = decodeURIComponent(url.password);

  return result;
}

// ---------------------------------------------------------------------------
// getConnectionConfig — main export for CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * getConnectionConfig
 *
 * Parses terminal arguments into a ConnectionConfig object.
 *
 * @param argv - The raw argument list. Defaults to process.argv (the real
 *   terminal input). Tests pass their own array so they don't have to spin
 *   up a real process:
 *     getConnectionConfig(['node', 'dbpeek', '-d', 'postgres', '-D', 'mydb'])
 *
 * The first two entries are always 'node' and the script path — Commander
 * knows to skip them automatically.
 *
 * Throws an Error with a human-readable message if:
 *   - No dialect was provided (neither via URL nor -d flag)
 *   - No database was provided
 *   - The dialect value is not one of the four supported options
 *   - The URL is malformed or uses an unsupported scheme
 */
export function getConnectionConfig(argv: string[] = process.argv): ConnectionConfig {
  // Create a fresh Commander instance every time this function is called.
  // This is important for testing — each test call gets a clean slate with
  // no state left over from a previous call.
  const program = new Command();

  program
    .name('dbpeek')
    .description('Inspect and query databases from the browser')
    // [url] is an optional positional argument (square brackets = optional).
    // Positional arguments are values that are NOT prefixed with a dash.
    // Example: npx dbpeek "postgres://user:pass@localhost:5432/mydb"
    //                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                      this is the positional argument
    .argument('[url]', 'Connection string URL (e.g. postgres://user:pass@localhost:5432/mydb)')
    // Flags (also called "options") start with one or two dashes.
    // .option(flags, description, defaultValue)
    // The <dialect> placeholder in angle brackets means the flag requires a value.
    // A flag without angle brackets (like --write) is a boolean toggle.
    .option('-d, --dialect <dialect>', 'Database dialect (postgres|mysql|sqlite|mssql)')
    .option('-h, --host <host>', 'Database host', 'localhost') // 'localhost' is the default
    .option('-P, --port <port>', 'Database port (uses dialect default if omitted)')
    .option('-D, --database <database>', 'Database name or file path (SQLite)')
    .option('-u, --user <user>', 'Database user')
    .option('-p, --password <password>', 'Database password')
    // Boolean flags — present means true, absent means false.
    .option('--write', 'Unlock INSERT/UPDATE/DELETE operations', false)
    .option('--full', 'Unlock all DDL operations (CREATE/DROP/ALTER)', false)
    .allowUnknownOption(false) // throw an error if the user types an unrecognised flag
    // By default Commander calls process.exit() on errors, which would crash
    // the test runner. exitOverride() makes it throw a JavaScript Error instead,
    // so tests can catch and assert on error messages normally.
    .exitOverride();

  // This is where Commander actually reads and parses the argument list.
  // Everything above just registers the rules; this line applies them.
  program.parse(argv);

  // program.opts() returns an object containing all the parsed flag values.
  // We give it a generic type parameter so TypeScript knows the shape.
  // Note: port comes back as a string because all CLI input is raw text —
  // we convert it to a number with parseInt() further below.
  const opts = program.opts<{
    dialect?: string;
    host: string;
    port?: string;
    database?: string;
    user?: string;
    password?: string;
    write: boolean;
    full: boolean;
  }>();

  // program.args holds any positional arguments that were typed after the flags.
  // Array destructuring: const [first, second] = array;
  // We only expect at most one positional arg (the URL), so we grab index 0.
  const [urlArg] = program.args;

  // Build the "merged" config starting from the flags.
  // We use `Partial<ConnectionConfig>` here because not every field is filled
  // in yet — we're assembling the object piece by piece.
  let merged: Partial<ConnectionConfig> & { write: boolean; full: boolean } = {
    host: opts.host, // always has a value because we set 'localhost' as default above
    write: opts.write,
    full: opts.full,
  };

  // Only copy optional flags if they were actually provided.
  // Checking truthiness (if (opts.dialect)) filters out undefined and empty string.
  if (opts.dialect) merged.dialect = opts.dialect as Dialect;
  if (opts.port) merged.port = parseInt(opts.port, 10); // convert string → number
  if (opts.database) merged.database = opts.database;
  if (opts.user) merged.user = opts.user;
  if (opts.password) merged.password = opts.password;

  // If the user supplied a URL argument, parse it and let those values win
  // over any conflicting flags. This makes the URL the "primary" input method.
  //
  // The spread operator { ...merged, ...fromUrl } means: copy everything from
  // `merged`, then copy everything from `fromUrl`, overwriting any duplicate keys.
  // We then explicitly re-apply write/full because we never want the URL to
  // affect those — they're always flag-only.
  if (urlArg) {
    const fromUrl = parseConnectionUrl(urlArg);
    merged = { ...merged, ...fromUrl, write: merged.write, full: merged.full };
  }

  // ---------------------------------------------------------------------------
  // Validation — throw descriptive errors before we try to connect to anything
  // ---------------------------------------------------------------------------

  const validDialects: Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];

  // Check for an unrecognised dialect string (e.g. the user typed "oracle").
  // This can only come from a -d flag since the URL parser already rejects
  // unknown schemes.
  if (merged.dialect && !validDialects.includes(merged.dialect)) {
    throw new Error(
      `Unknown dialect "${merged.dialect}". Valid options: ${validDialects.join(', ')}`
    );
  }

  // Dialect is the minimum required piece of information — without it we
  // don't know which database driver to load.
  if (!merged.dialect) {
    throw new Error(
      `Dialect is required. Use -d <dialect> (postgres|mysql|sqlite|mssql) ` +
        `or provide a connection URL.`
    );
  }

  // Database name (or file path for SQLite) is also required — without it
  // we don't know what to connect to.
  if (!merged.database) {
    if (merged.dialect === 'sqlite') {
      // Give SQLite a more specific error because it uses a file path, not a name.
      throw new Error(`SQLite requires a file path. Use -D <path> (e.g. -D ./data/mydb.sqlite)`);
    }
    throw new Error(`Database name is required. Use -D <database>.`);
  }

  // Fill in the default port if the user didn't specify one.
  // We skip this for SQLite because it's a local file — there's no port.
  if (!merged.port && merged.dialect !== 'sqlite') {
    merged.port = DIALECT_DEFAULT_PORTS[merged.dialect];
  }

  // At this point we've verified that dialect and database are present, so
  // it's safe to assert the full ConnectionConfig type with `as`.
  return merged as ConnectionConfig;
}

// ---------------------------------------------------------------------------
// startOnAvailablePort — try a list of ports in order
// ---------------------------------------------------------------------------

/**
 * startOnAvailablePort
 *
 * Attempts to bind the Express app to each port in `candidates` and returns
 * the first one that succeeds.
 *
 * Why do we need this?
 *   Port 3000 is commonly used by other tools (Create React App, Rails, etc.).
 *   Rather than crashing when the preferred port is taken, we automatically
 *   try the next one. This mirrors how tools like Vite and Next.js behave.
 *
 * Pseudocode:
 *   For each port in candidates:
 *     1. Create a plain Node.js http.Server wrapping the Express app.
 *     2. Call server.listen(port, '127.0.0.1') — bind to localhost only.
 *        (Binding to localhost means the server is not reachable from other
 *        machines on the network — a sensible default for a local dev tool.)
 *     3. If the 'listening' event fires → success, return { server, port }.
 *     4. If the 'error' event fires with code EADDRINUSE → the port is taken,
 *        close the server and try the next candidate.
 *     5. Any other error → re-throw (it's something we can't recover from).
 *   If every port failed → throw an error listing all candidates.
 *
 * @param app        - the Express application returned by createServer()
 * @param candidates - list of port numbers to try, in priority order
 * @returns            { server, port } once a port is successfully bound
 * @throws             if every candidate port is already in use
 */
export async function startOnAvailablePort(
  app: Express,
  candidates: number[]
): Promise<{ server: http.Server; port: number }> {
  // Iterate through each candidate port one at a time.
  // We use a traditional for-of loop (not forEach) because we need to use
  // await inside the loop body — async callbacks inside forEach don't work
  // as expected.
  for (const port of candidates) {
    // tryPort wraps the callback-based server.listen() in a Promise so we can
    // use async/await. It resolves with the server on success, or resolves with
    // a failure descriptor on EADDRINUSE (so we can continue the loop).
    const result = await tryPort(app, port);
    if (result.success) {
      // This port is free and we are now listening on it.
      return { server: result.server, port };
    }
    // EADDRINUSE means "address already in use" — another process has this
    // port. We swallow this specific error and try the next port.
    if (result.code !== 'EADDRINUSE') {
      // Something unexpected went wrong (permissions error, invalid port, etc.).
      // Re-throw so the caller sees a real error message.
      throw result.error;
    }
    // Continue to the next port in the list.
  }

  // We exhausted all candidates without finding a free port.
  throw new Error(
    `No available port found. Tried: ${candidates.join(', ')}. ` +
      `Stop another process using those ports and try again.`
  );
}

// ── Internal helper ───────────────────────────────────────────────────────────

/**
 * tryPort
 *
 * Attempts to bind a Node.js http.Server to a single port.
 *
 * Returns a discriminated union so the caller can branch without try/catch:
 *   { success: true,  server }        — the server is now listening
 *   { success: false, code, error }   — binding failed (caller checks `code`)
 *
 * Why a discriminated union instead of throw/catch in the caller?
 *   startOnAvailablePort needs to distinguish EADDRINUSE (try next port) from
 *   other errors (re-throw). A discriminated union makes that branching
 *   explicit and avoids catching errors just to re-throw them.
 *
 * Why '127.0.0.1' instead of '0.0.0.0'?
 *   '0.0.0.0' binds to all network interfaces, making the server reachable
 *   from other machines on your LAN. '127.0.0.1' (localhost) only accepts
 *   connections from the same machine — much safer for a local dev tool that
 *   has direct access to your database credentials.
 *
 * Why wrap server.listen() in a Promise?
 *   server.listen() is callback-based (old Node.js style). Wrapping it in a
 *   Promise lets us use it with async/await, which is much easier to read and
 *   reason about than nested callbacks.
 */
type TryPortResult =
  | { success: true; server: http.Server }
  | { success: false; code: string; error: Error };

function tryPort(app: Express, port: number): Promise<TryPortResult> {
  return new Promise((resolve) => {
    // http.createServer(app) wraps the Express app in a plain Node.js HTTP
    // server. Express itself is just a request handler function — the actual
    // TCP socket management is done by Node's built-in http module.
    const server = http.createServer(app);

    // 'listening' fires once the OS has successfully bound the port and the
    // server is ready to accept incoming connections.
    server.once('listening', () => {
      resolve({ success: true, server });
    });

    // 'error' fires if binding fails (port taken, permissions, etc.).
    // NodeJS.ErrnoException extends Error with an optional `code` string like
    // 'EADDRINUSE', 'EACCES', etc.
    server.once('error', (err: NodeJS.ErrnoException) => {
      // Close the failed server so the OS can reclaim any partially-bound
      // resources before we try the next port.
      server.close();
      resolve({
        success: false,
        code: err.code ?? 'UNKNOWN',
        error: err,
      });
    });

    // Start the binding attempt.
    // '127.0.0.1' → loopback address (localhost only, not LAN-visible)
    server.listen(port, '127.0.0.1');
  });
}

// ---------------------------------------------------------------------------
// Permission mode resolver
// ---------------------------------------------------------------------------

/**
 * resolvePermissionMode
 *
 * Derives the PermissionMode string from the boolean write/full flags.
 *
 * The flag semantics:
 *   full=true  → 'full'       (DDL allowed — most permissive)
 *   write=true → 'write'      (DML allowed — middle tier)
 *   both false → 'read-only'  (SELECT only — safest default)
 *
 * Why check `full` before `write`?
 *   `full` is a superset of `write`. If both are set we honour `full`
 *   (the most permissive flag the user explicitly requested).
 *
 * @param config - parsed ConnectionConfig from getConnectionConfig()
 * @returns        one of 'read-only' | 'write' | 'full'
 */
function resolvePermissionMode(config: ConnectionConfig): 'read-only' | 'write' | 'full' {
  if (config.full) return 'full';
  if (config.write) return 'write';
  return 'read-only';
}

// ---------------------------------------------------------------------------
// main — runs only when this file is the entry point (not during tests)
// ---------------------------------------------------------------------------

/**
 * main
 *
 * Orchestrates the full startup sequence:
 *   1. Parse CLI arguments.
 *   2. Test the database connection.
 *   3. Start the HTTP server on an available port.
 *   4. Open the browser.
 *   5. Register shutdown handlers.
 *
 * Why is main() async?
 *   Several of the steps involve I/O (connecting to the database, binding a
 *   TCP port) that return Promises. `async` lets us write sequential-looking
 *   code with `await` instead of deeply nested callbacks.
 *
 * Why wrap everything in try/catch?
 *   If anything in the startup sequence fails (wrong password, all ports taken,
 *   etc.) we want to print a clear error message and exit with a non-zero code
 *   (process.exitCode = 1) instead of showing Node.js's default stack trace.
 */
async function main(): Promise<void> {
  // ── Step 1: parse CLI arguments ─────────────────────────────────────────────
  // getConnectionConfig() reads process.argv by default. Any validation error
  // (missing dialect, unknown flag, bad URL) will throw here — caught below.
  let config: ConnectionConfig;
  try {
    config = getConnectionConfig();
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  // ── Step 2: determine permission mode ───────────────────────────────────────
  // Convert the boolean flags from the config into the string mode that
  // createServer() and route handlers expect.
  const mode = resolvePermissionMode(config);

  // ── Step 3: create the Knex instance ────────────────────────────────────────
  // createKnexInstance() is "lazy" — it does NOT open a connection yet.
  // The actual TCP handshake happens in testConnection() below.
  const knex = createKnexInstance({
    dialect: config.dialect,
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
  });

  // ── Step 4: verify the database connection ──────────────────────────────────
  // testConnection() runs SELECT 1. If credentials are wrong or the host is
  // unreachable, it throws — we catch that and show a friendly message.
  try {
    await testConnection(knex);
    console.log(`✓ Connected to ${config.dialect} database "${config.database}"`);
  } catch (err) {
    console.error(`Failed to connect to the database: ${(err as Error).message}`);
    await destroyConnection(knex);
    process.exitCode = 1;
    return;
  }

  // ── Step 5: build the Express app ───────────────────────────────────────────
  // createServer() returns a configured Express app without starting it.
  // We start it ourselves below so we can control the port.
  const app = createServer({ knex, mode });

  // ── Step 6: bind to an available port ───────────────────────────────────────
  // We try ports 3000 → 3010 in sequence.
  //
  // Array.from({ length: 11 }, (_, i) => 3000 + i) generates:
  //   [3000, 3001, 3002, ..., 3010]
  //
  // The callback receives two arguments:
  //   _  → the current element value (always undefined for { length: N }) — ignored
  //   i  → the current index (0, 1, 2, …)
  // We only use `i` to compute the port: 3000 + 0 = 3000, 3000 + 1 = 3001, etc.
  const candidatePorts = Array.from({ length: 11 }, (_, i) => 3000 + i);

  let server: http.Server;
  let port: number;
  try {
    ({ server, port } = await startOnAvailablePort(app, candidatePorts));
  } catch (err) {
    console.error(`Could not start server: ${(err as Error).message}`);
    await destroyConnection(knex);
    process.exitCode = 1;
    return;
  }

  // ── Step 7: print the success message ───────────────────────────────────────
  const url = `http://localhost:${port}`;
  console.log(`\ndbpeek is running on ${url}`);
  console.log(`Permission mode: ${mode}`);
  console.log(`Press Ctrl-C to stop.\n`);

  // ── Step 8: open the browser ────────────────────────────────────────────────
  // The `open` package launches the user's default browser pointing at `url`.
  // We import it dynamically (await import()) because it is a pure ESM package
  // that exposes its export as `default` — dynamic import handles this cleanly.
  //
  // Browser-opening is best-effort: if it fails (headless server, WSL without
  // a display, CI environment) we log a hint but keep the server running.
  try {
    const { default: open } = await import('open');
    await open(url);
  } catch {
    console.log(`Could not open browser automatically. Navigate to ${url} manually.`);
  }

  // ── Step 9: graceful shutdown ────────────────────────────────────────────────
  // SIGINT  → sent when the user presses Ctrl-C in the terminal
  // SIGTERM → sent by Docker, systemd, Kubernetes, or `kill <pid>`
  //
  // Without these handlers, Node.js exits immediately, leaving the database
  // connection pool open. Some databases penalise dangling connections
  // (e.g. services with a hard connection limit like Heroku Postgres free tier).
  //
  // The shutdown sequence:
  //   1. Stop accepting new HTTP requests (server.close).
  //      In-flight requests are allowed to finish before the server closes.
  //   2. Drain and close the database connection pool (destroyConnection).
  //   3. Exit with code 0 (clean exit — signals "no error").
  async function shutdown(signal: string): Promise<void> {
    console.log(`\nReceived ${signal}. Shutting down gracefully…`);
    // server.close() stops the server from accepting new connections.
    // The callback fires once all existing connections have ended.
    server.close(() => {
      console.log('HTTP server closed.');
    });
    // Drain the Knex connection pool — waits for in-flight queries to finish.
    await destroyConnection(knex);
    console.log('Database connections closed.');
    process.exit(0);
  }

  // Register the same handler for both signals.
  // Using an arrow function () => shutdown(signal) defers execution —
  // the handler only runs when the OS delivers the signal, not right now.
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

// ---------------------------------------------------------------------------
// Entry point guard
// ---------------------------------------------------------------------------

// `import.meta.url` is the file:// URL of *this* module
// (e.g. "file:///Users/alice/projects/dbpeek/src/cli/index.ts").
//
// We compare it to process.argv[1] (the script Node was asked to run) to
// decide whether this file is being executed directly or imported by a test.
//
// This is the ES module equivalent of the CommonJS pattern:
//   if (require.main === module) { main(); }
//
// Without this guard, importing getConnectionConfig or startOnAvailablePort
// in a test would trigger main() and try to start a real server.
const isDirectlyRun =
  process.argv[1] === fileURLToPath(import.meta.url) ||
  // When compiled by tsup, the output path differs from the source path.
  // We also match the binary name ('dbpeek') so the guard still fires after
  // `npm run build && npm link`.
  Boolean(process.argv[1]?.endsWith('dbpeek'));

if (isDirectlyRun) {
  main().catch((err: unknown) => {
    console.error('Unexpected error:', err);
    process.exitCode = 1;
  });
}
