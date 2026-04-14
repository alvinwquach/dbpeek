#!/usr/bin/env node
// ^^^ This "shebang" tells the OS to run this file with Node.js when executed
// directly (e.g. ./dist/cli/index.js). Without it, the shell wouldn't know
// what program to use.

/**
 * src/cli/index.ts
 *
 * This is the CLI entry point — the first code that runs when someone types
 * `dbpeek` in their terminal.
 *
 * What does a CLI entry point do?
 *   It reads the arguments the user typed (e.g. flags like --host or a URL),
 *   validates them, and turns them into a plain JavaScript object your app
 *   can use. Think of it as the "front door" that checks your ID before
 *   letting you in.
 *
 * What is Commander?
 *   Commander is a popular Node.js library that takes the raw text the user
 *   typed and automatically:
 *     - Parses flags (e.g. "--host localhost" → { host: "localhost" })
 *     - Generates a --help page for free
 *     - Shows friendly errors when a required value is missing
 *   We import its `Command` class and build our CLI by chaining method calls
 *   onto it (see getConnectionConfig below).
 *
 * Two ways to connect:
 *   1. URL argument  — npx dbpeek "postgres://user:pass@localhost:5432/mydb"
 *   2. Individual flags — npx dbpeek -d postgres -h localhost -P 5432 -D mydb
 *
 * What this file exports:
 *   - ConnectionConfig  (the TypeScript type for a parsed config object)
 *   - Dialect           (the union type of supported database engines)
 *   - getConnectionConfig(argv?)  (the function that does the parsing)
 *
 * What this file does NOT do:
 *   It does not open a database connection or start a server. Its only job
 *   is to read flags → validate them → return a config object. Keeping those
 *   responsibilities separate makes the code easier to test and change later.
 *
 * Pseudocode for getConnectionConfig:
 *   1. Register all flags and the optional URL argument with Commander
 *   2. Call program.parse(argv) so Commander reads the terminal input
 *   3. Copy flag values into a "merged" object
 *   4. If a URL argument was supplied, parse it and let it override the flags
 *   5. Validate: dialect must be set, database must be set
 *   6. Fill in default ports for dialects that have one
 *   7. Return the final ConnectionConfig object
 */

import { Command } from 'commander';

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
// Main export
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
