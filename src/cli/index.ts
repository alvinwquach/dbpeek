#!/usr/bin/env node
// ===== FILE PURPOSE =====
// CLI entry point: npx dbpeek "postgres://user:pass@host:5432/db"
//
// Responsibilities:
//   1. Parse and validate the connection config from argv.
//   2. Create a Knex instance and verify the database is reachable.
//   3. Start the Express server on the first available port (3000–3010).
//   4. Print a connection banner to stdout.
//   5. Open the default browser to the server URL.
//   6. Handle SIGINT/SIGTERM: destroy the Knex pool, close the HTTP server,
//      then exit cleanly.
//
// WHY port fallback (3000 → 3010):
//   Port 3000 is the most commonly occupied dev port (React, Rails, etc.).
//   Silently trying the next port means `npx dbpeek` works without the user
//   having to kill whatever else is running on 3000. We cap at 3010 to avoid
//   silently binding to an unexpected port after too many retries.

import http from "http";
import { Command, InvalidArgumentError } from "commander";
import open from "open";

import {
  type Dialect,
  type PermissionMode,
  type ConnectionConfig,
  DEFAULT_PORTS,
} from "../types/connection.js";
import { parseConnectionUrl } from "./parseUrl.js";
import {
  createKnexInstance,
  testConnection,
  destroyConnection,
} from "../server/db.js";
import { createServer } from "../server/index.js";

// Re-export so the test file only needs one import source.
export type { Dialect, PermissionMode, ConnectionConfig };
export { DEFAULT_PORTS };

// ===== CONSTANTS =====

/** Default host for all network dialects when -h is not supplied. */
const DEFAULT_HOST = "localhost";

/** First port to try when starting the HTTP server. */
const BASE_PORT = 3000;

/** Inclusive upper bound for port fallback attempts. */
const MAX_PORT = 3010;

// ===== FLAG VALIDATORS =====

/**
 * Validates the -d/--dialect flag value at parse time.
 * Commander calls this as an argParser, so throwing InvalidArgumentError
 * produces a clean "error: option '-d' argument '...' is invalid" message.
 *
 * WHY `value as Dialect` on both the includes() call and the return:
 *   Array.prototype.includes() is typed as `includes(searchElement: T)` where
 *   T is the element type of the array. `valid` is `Dialect[]`, so includes()
 *   only accepts a `Dialect` — but `value` arrives as `string`. The cast tells
 *   TypeScript "treat this string as a Dialect for the purpose of this check."
 *   It is safe because the includes() result is the actual runtime guard: if
 *   includes() returns false we throw, so the cast on the return is guaranteed
 *   to be correct when reached.
 */
function parseDialect(value: string): Dialect {
  const valid: Dialect[] = ["postgres", "mysql", "sqlite", "mssql"];
  if (!valid.includes(value as Dialect)) {
    throw new InvalidArgumentError(
      `"${value}" is not a supported dialect. Choose one of: ${valid.join(", ")}`
    );
  }
  return value as Dialect;
}

/**
 * Validates the -P/--port flag value at parse time.
 * Rejects anything outside the valid TCP port range (1–65535).
 *
 * WHY uppercase -P for port and -D for database:
 *   Lowercase -p is already taken by --password and lowercase -d by --dialect.
 *   Uppercase variants are the conventional fallback in CLI tools when the
 *   natural lowercase letter is already claimed (e.g. tar uses -C for directory).
 *
 * WHY parseInt with explicit radix 10:
 *   Without a radix, parseInt("010") returns 8 in older JS engines (octal
 *   interpretation). Passing 10 makes the decimal intent explicit and avoids
 *   the ambiguity entirely, regardless of the runtime version.
 */
function parsePort(value: string): number {
  const number = parseInt(value, 10);
  if (isNaN(number) || number < 1 || number > 65535) {
    throw new InvalidArgumentError(
      `"${value}" is not a valid port. Expected a number between 1 and 65535.`
    );
  }
  return number;
}

// ===== COMMAND BUILDER =====

/**
 * Builds a fresh commander Command instance on every call.
 *
 * WHY a factory instead of a module-level singleton: commander is stateful —
 * parsed option values persist on the Command object after parse() is called.
 * Tests invoke getConnectionConfig() many times with different argv arrays, so
 * each call must start from a clean slate to avoid cross-test contamination.
 */
function buildCommand(): Command {
  const cmd = new Command();

  cmd
    .name("dbpeek")
    .description(
      "Connect to any database and explore it in your browser. One command, nothing to install."
    )
    // [connection-string] is optional — user may supply flags instead.
    .argument("[connection-string]", "Database connection URL")
    .option(
      "-d, --dialect <dialect>",
      "Database dialect: postgres, mysql, sqlite, mssql",
      parseDialect
    )
    .option("-h, --host <host>", "Database server hostname or IP", DEFAULT_HOST)
    .option(
      "-P, --port <port>",
      "Database server port (defaults: postgres=5432, mysql=3306, mssql=1433)",
      parsePort
    )
    .option("-D, --database <name>", "Database name, or file path for SQLite")
    .option("-u, --user <user>", "Database login username", "")
    .option("-p, --password <password>", "Database login password", "")
    .option("--write", "Allow INSERT, UPDATE, DELETE in addition to SELECT")
    .option("--full", "Allow all SQL including CREATE, DROP, ALTER (implies --write)")
    // exitOverride() makes commander throw instead of calling process.exit(),
    // so tests can catch parse errors without intercepting the process.
    .exitOverride();

  return cmd;
}

// ===== PUBLIC API =====

/**
 * Parses a process.argv-style array and returns a fully-resolved ConnectionConfig.
 *
 * MERGING RULES (highest priority first):
 *   1. URL fields  — when a connection string is provided, its fields win.
 *   2. Flag values — used when no URL is given or a URL field is absent.
 *   3. Dialect port defaults — applied last if no port appeared anywhere.
 *
 * WHY URL wins over flags: the URL is a single authoritative source. A flag
 * silently overriding one field of a URL would produce confusing behaviour
 * (e.g. connecting to the wrong host without any error).
 *
 * @param argv - process.argv-style array. Defaults to process.argv.
 * @throws {Error} with a human-friendly message on any validation failure.
 */
export function getConnectionConfig(
  argv: string[] = process.argv
): ConnectionConfig {
  const cmd = buildCommand();

  // ── Step 1: parse argv ─────────────────────────────────────────────────────
  try {
    cmd.parse(argv);
  } catch (err: unknown) {
    // Normalise CommanderError to a plain Error so callers don't need to import
    // commander just to catch parse failures.
    if (err instanceof Error) throw new Error(err.message);
    throw err;
  }

  // WHY the explicit generic on cmd.opts<{...}>():
  //   Commander's opts() return type is `OptionValues` (essentially
  //   `Record<string, unknown>`). Without the generic, every property access
  //   below would be `unknown`, requiring a cast at every use site. The generic
  //   narrows the return type to exactly the flags this command declares, giving
  //   us autocomplete and type-safety for free with zero runtime cost.
  const opts = cmd.opts<{
    dialect?: Dialect;
    host: string;
    port?: number;
    database?: string;
    user: string;
    password: string;
    write?: boolean;
    full?: boolean;
  }>();

  const positional = cmd.args[0];

  // ── Step 2: parse URL if provided ─────────────────────────────────────────
  let urlFields: (Partial<ConnectionConfig> & { dialect: Dialect }) | null = null;
  if (positional) {
    urlFields = parseConnectionUrl(positional);
  }

  // ── Step 3: merge URL over flags ───────────────────────────────────────────
  const dialect: Dialect | undefined = urlFields?.dialect ?? opts.dialect;
  const host: string = urlFields?.host ?? opts.host;
  const user: string = urlFields?.user ?? opts.user;
  const password: string = urlFields?.password ?? opts.password;
  // Treat an empty-string database from the URL as absent so the flag can fill in.
  const database: string | undefined =
    (urlFields?.database !== "" ? urlFields?.database : undefined) ?? opts.database;
  // Defer port default resolution until after dialect is validated.
  const explicitPort: number | undefined = urlFields?.port ?? opts.port;

  // ── Step 4: validate required fields ──────────────────────────────────────
  if (!dialect) {
    throw new Error(
      "Please specify a database dialect with -d (postgres, mysql, sqlite, mssql)"
    );
  }

  if (!database) {
    throw new Error(
      "Please specify a database name with -D or in the connection string"
    );
  }

  // ── Step 5: resolve port default ──────────────────────────────────────────
  const port: number = explicitPort ?? DEFAULT_PORTS[dialect];

  // ── Step 6: resolve permission mode ───────────────────────────────────────
  // WHY check opts.full before opts.write:
  //   The flags form a precedence ladder: full > write > readonly. Checking
  //   full first means `--write --full` correctly resolves to "full" — if we
  //   checked write first and set permissionMode = "write", the full check
  //   would never overwrite it because the else-if would be skipped.
  let permissionMode: PermissionMode = "readonly";
  if (opts.full) permissionMode = "full";
  else if (opts.write) permissionMode = "write";

  return { dialect, host, port, database, user, password, permissionMode };
}

// ===== PORT BINDING =====

/**
 * Attempts to bind an HTTP server to `port`. If the port is in use (EADDRINUSE),
 * recurses with `port + 1` up to `MAX_PORT`.
 *
 * WHY `return new Promise(...)` instead of async/await:
 *   http.Server.listen() signals success via the "listening" event and failure
 *   via the "error" event — it does not return a Promise and cannot be awaited.
 *   `new Promise(...)` is the correct primitive for converting event-emitter
 *   callbacks into a Promise: we attach both event listeners inside the
 *   executor, then resolve/reject from whichever fires first. An async function
 *   can only await Promises, so it cannot directly observe these events without
 *   this wrapper.
 *
 * WHY recursion instead of a loop:
 *   The "port in use" signal arrives asynchronously on the "error" event, not
 *   synchronously. A for/while loop would need to await a Promise at each
 *   iteration anyway, making it equivalent to recursion but harder to read.
 *   Recursion with `.then(resolve, reject)` forwards the inner result to the
 *   outer Promise naturally, keeping the control flow explicit.
 *
 * WHY we remove listeners before retrying:
 *   The same `server` object is reused across retries. Each call to listen()
 *   re-attaches event listeners to it. Without removeListener(), stale handlers
 *   accumulate and the Promise resolves or rejects multiple times — once per
 *   accumulated listener — which is undefined behaviour for a Promise.
 *
 * @param server - An http.Server created from the Express app.
 * @param port   - The port number to try first.
 * @returns The port number the server successfully bound to.
 * @throws {Error} if every port from BASE_PORT to MAX_PORT is occupied.
 */
function listenWithFallback(
  server: http.Server,
  port: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    function onListening() {
      cleanup();
      resolve(port);
    }

    function onError(err: NodeJS.ErrnoException) {
      cleanup();
      if (err.code === "EADDRINUSE") {
        if (port >= MAX_PORT) {
          reject(
            new Error(
              `All ports ${BASE_PORT}–${MAX_PORT} are in use. ` +
                `Free one of them and try again.`
            )
          );
        } else {
          // Recurse: try the next port.
          listenWithFallback(server, port + 1).then(resolve, reject);
        }
      } else {
        // Non-EADDRINUSE errors (e.g. EACCES on port < 1024) are fatal.
        reject(err);
      }
    }

    function cleanup() {
      server.removeListener("listening", onListening);
      server.removeListener("error", onError);
    }

    server.listen(port, "127.0.0.1", onListening);
    server.on("error", onError);
  });
}

// ===== MAIN =====

/**
 * Main entry point. Called when the CLI is executed directly.
 *
 * Sequence:
 *   1. Parse argv → ConnectionConfig.
 *   2. Create Knex instance (synchronous, no I/O).
 *   3. Test connectivity (async — fails fast on bad credentials or unreachable host).
 *   4. Build the Express app.
 *   5. Bind to the first available port in [BASE_PORT, MAX_PORT].
 *   6. Print the connection banner.
 *   7. Open the default browser.
 *   8. Register SIGINT/SIGTERM handlers for graceful shutdown.
 *
 * WHY the connection test (step 3) happens before Express is started (step 4):
 *   If the database is unreachable, we want to fail fast with a clear error
 *   message — not start a server that returns 500s on every query request.
 *   The user sees "Cannot connect to postgres database…" immediately, corrects
 *   the connection string, and retries. No port is ever occupied by a broken server.
 */
async function main(): Promise<void> {
  // ── Step 1: Parse config ───────────────────────────────────────────────────
  let config: ConnectionConfig;
  try {
    config = getConnectionConfig(process.argv);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    process.exit(1);
  }

  // ── Step 2: Create Knex instance ───────────────────────────────────────────
  const db = createKnexInstance(config);

  // ── Step 3: Test connectivity ──────────────────────────────────────────────
  try {
    await testConnection(db, config);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    await destroyConnection(db);
    process.exit(1);
  }

  // ── Step 4: Build Express app ──────────────────────────────────────────────
  const { app } = createServer(config, db);
  const server = http.createServer(app);

  // ── Step 5: Bind to port ───────────────────────────────────────────────────
  let boundPort: number;
  try {
    boundPort = await listenWithFallback(server, BASE_PORT);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${msg}`);
    await destroyConnection(db);
    process.exit(1);
  }

  // ── Step 6: Print banner ───────────────────────────────────────────────────
  // Format: "Connected to postgres database myapp on db.example.com:5432"
  // Port is omitted for SQLite (sentinel value 0, file-based — no network).
  const locationPart =
    config.dialect === "sqlite"
      ? config.database
      : `${config.host}:${config.port}`;

  console.log(
    `Connected to ${config.dialect} database ${config.database} on ${locationPart}`
  );
  console.log(`Server running at http://localhost:${boundPort}`);

  // ── Step 7: Open browser ───────────────────────────────────────────────────
  // WHY fire-and-forget (no await):
  //   open() spawns an OS process and resolves when the process has been
  //   started, not when the browser has finished loading. Awaiting it would
  //   only delay the SIGINT handler registration below by a few milliseconds
  //   with no practical benefit. If open() fails (headless environment, CI),
  //   we log a hint instead of crashing.
  open(`http://localhost:${boundPort}`).catch(() => {
    console.log(`Open your browser to http://localhost:${boundPort}`);
  });

  // ── Step 8: Graceful shutdown ──────────────────────────────────────────────

  /**
   * Tears down the server cleanly on SIGINT (Ctrl-C) or SIGTERM (kill).
   *
   * WHY server.close() before destroyConnection():
   *   server.close() stops accepting new connections but keeps existing ones
   *   alive until they finish. This means any in-flight query that started
   *   before Ctrl-C gets to complete (and the Knex pool can return its
   *   connection) before we destroy the pool. Destroying the pool first would
   *   cause in-flight queries to fail with "pool destroyed" errors.
   *
   * WHY process.exit(0) after cleanup:
   *   server.close() resolves only after all open keep-alive connections drop.
   *   With a browser tab open, that could be seconds. Calling process.exit(0)
   *   in the close callback avoids hanging indefinitely — by then the pool is
   *   already drained, so there is no remaining cleanup work.
   */
  async function shutdown(signal: string): Promise<void> {
    console.log(`\nReceived ${signal}. Shutting down…`);
    server.close(async () => {
      await destroyConnection(db);
      process.exit(0);
    });
  }

  // WHY process.once instead of process.on:
  //   process.on() would re-register the handler on every call to main(), and
  //   a second Ctrl-C during shutdown would invoke it again — calling
  //   server.close() and destroyConnection() a second time on an already-closing
  //   server. process.once() removes the listener after the first invocation,
  //   making double-signal safe.
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

// WHY the process.argv[1] guard:
//   When Vitest (or any test runner) imports this module to access exported
//   symbols like getConnectionConfig(), main() must NOT execute — it would
//   call process.exit(1) after failing to parse the test runner's own argv,
//   killing the test process. tsup compiles to CJS so import.meta.url is not
//   available; instead we compare process.argv[1] (the script path Node is
//   running) against __filename (this file's path). They match only when the
//   user runs `node dist/cli/index.js` directly, not when it is imported.
//
//   In source (ts-node / tsx), __filename is the .ts source path and
//   process.argv[1] is also the .ts source path, so the guard works there too.
if (
  typeof __filename !== "undefined" &&
  process.argv[1] &&
  (process.argv[1] === __filename ||
    process.argv[1].endsWith("/cli/index.js") ||
    process.argv[1].endsWith("/cli/index.ts"))
) {
  main();
}
