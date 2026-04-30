#!/usr/bin/env node
// ===== FILE PURPOSE =====
// CLI entry point: npx dbpeek "postgres://user:pass@host:5432/db"
//
// Responsibilities:
//   1. Define and register all commander flags.
//   2. Merge a positional connection string URL with individual flags
//      (URL fields always win when both are provided).
//   3. Validate that dialect and database are present.
//   4. Return a fully-resolved ConnectionConfig for the server to consume.
//
// Server boot does NOT happen here — that is the next branch.

import { Command, InvalidArgumentError } from "commander";

import {
  type Dialect,
  type PermissionMode,
  type ConnectionConfig,
  DEFAULT_PORTS,
} from "../types/connection.js";
import { parseConnectionUrl } from "./parseUrl.js";

// Re-export so the test file only needs one import source.
export type { Dialect, PermissionMode, ConnectionConfig };
export { DEFAULT_PORTS };

// ===== CONSTANTS =====

/** Default host for all network dialects when -h is not supplied. */
const DEFAULT_HOST = "localhost";

// ===== FLAG VALIDATORS =====

/**
 * Validates the -d/--dialect flag value at parse time.
 * Commander calls this as an argParser, so throwing InvalidArgumentError
 * produces a clean "error: option '-d' argument '...' is invalid" message.
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
 */
function parsePort(value: string): number {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 65535) {
    throw new InvalidArgumentError(
      `"${value}" is not a valid port. Expected a number between 1 and 65535.`
    );
  }
  return n;
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
  // --full supersedes --write; both supersede the default read-only mode.
  let permissionMode: PermissionMode = "readonly";
  if (opts.full) permissionMode = "full";
  else if (opts.write) permissionMode = "write";

  return { dialect, host, port, database, user, password, permissionMode };
}
