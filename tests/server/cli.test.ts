/**
 * tests/server/cli.test.ts
 *
 * Tests for the CLI argument parser in src/cli/index.ts.
 *
 * What is Vitest?
 *   Vitest is the test framework for this project. It finds files matching
 *   the pattern in vitest.config.ts and runs all the `it(...)` blocks inside
 *   them. Run all tests with: npm test
 *
 * How tests are structured here:
 *   describe('label', () => { ... })  — a named group of related tests
 *   it('what it should do', () => { ... })  — a single test case
 *   expect(value).toBe(expected)  — an assertion: "I expect value to equal expected"
 *   expect(value).toMatchObject({...})  — passes if value contains at least the
 *     listed keys with the listed values (extra keys are allowed)
 *   expect(fn).toThrow(/pattern/)  — passes if calling fn() throws an error
 *     whose message matches the regex pattern
 *
 * Why do we test the CLI parser directly instead of running the real binary?
 *   Spawning a child process for every test would be slow and flaky.
 *   Instead, getConnectionConfig() accepts an `argv` array so we can call it
 *   like a regular function and inspect its return value — much faster.
 */

import { describe, it, expect } from 'vitest';
import { getConnectionConfig } from '../../src/cli/index.js';

/**
 * argv(...args)
 *
 * A small helper that builds the argument array Commander expects.
 *
 * Why the first two entries?
 *   In a real terminal, process.argv always looks like:
 *     ['node', '/path/to/dbpeek', ...user-typed-args]
 *   Commander is designed to skip the first two entries (the runtime and
 *   the script path), so we must include them even in tests.
 *
 * Usage:
 *   argv('-d', 'postgres', '-D', 'mydb')
 *   // → ['node', 'dbpeek', '-d', 'postgres', '-D', 'mydb']
 */
function argv(...args: string[]): string[] {
  return ['node', 'dbpeek', ...args];
}

describe('getConnectionConfig', () => {
  // ── URL parsing ─────────────────────────────────────────────────────────────
  // These tests verify that a single connection URL is split correctly into
  // all its component fields (dialect, host, port, database, user, password).

  it('parses a full postgres URL', () => {
    const cfg = getConnectionConfig(argv('postgres://alice:s3cr3t@db.example.com:5432/mydb'));

    // toMatchObject checks that cfg contains at least these key/value pairs.
    // Extra fields on cfg (like ones we didn't list) are allowed and ignored.
    expect(cfg).toMatchObject({
      dialect: 'postgres',
      host: 'db.example.com',
      port: 5432, // must be a number, not the string "5432"
      database: 'mydb',
      user: 'alice',
      password: 's3cr3t',
      write: false, // default — user did not pass --write
      full: false,  // default — user did not pass --full
    });
  });

  it('parses a postgresql:// alias as postgres dialect', () => {
    // "postgresql://" and "postgres://" are both valid and mean the same thing.
    // Heroku, for example, uses the "postgresql://" form in its DATABASE_URL.
    const cfg = getConnectionConfig(argv('postgresql://u:p@localhost/testdb'));
    expect(cfg.dialect).toBe('postgres');
    expect(cfg.database).toBe('testdb');
  });

  it('parses a mysql URL', () => {
    const cfg = getConnectionConfig(argv('mysql://root:pass@127.0.0.1:3306/shop'));
    expect(cfg).toMatchObject({
      dialect: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'shop',
      user: 'root',
      password: 'pass',
    });
  });

  it('parses an mssql URL', () => {
    // The password contains "@" which must be percent-encoded as "%40" in a URL
    // so the parser doesn't confuse it with the "@" that separates credentials
    // from the host. We verify that decodeURIComponent() reverses it correctly.
    const cfg = getConnectionConfig(argv('mssql://sa:P%40ssw0rd@sqlserver/Northwind'));
    expect(cfg).toMatchObject({
      dialect: 'mssql',
      host: 'sqlserver',
      database: 'Northwind',
      user: 'sa',
      password: 'P@ssw0rd', // %40 should be decoded back to @
    });
  });

  // ── Default ports ───────────────────────────────────────────────────────────
  // When the URL doesn't include a port, we apply the well-known default for
  // the dialect. Each dialect gets its own test so the mapping is explicit.

  it('applies default port when URL omits it (postgres)', () => {
    const cfg = getConnectionConfig(argv('postgres://u:p@host/db'));
    expect(cfg.port).toBe(5432);
  });

  it('applies default port when URL omits it (mysql)', () => {
    const cfg = getConnectionConfig(argv('mysql://u:p@host/db'));
    expect(cfg.port).toBe(3306);
  });

  it('applies default port when URL omits it (mssql)', () => {
    const cfg = getConnectionConfig(argv('mssql://u:p@host/db'));
    expect(cfg.port).toBe(1433);
  });

  // ── Flag-based connection ───────────────────────────────────────────────────
  // Some users prefer flags over a URL (e.g. when scripting or when the
  // password contains special characters that are tricky to encode in a URL).

  it('builds config from individual flags', () => {
    const cfg = getConnectionConfig(
      argv('-d', 'postgres', '-h', 'pghost', '-P', '5433', '-D', 'mydb', '-u', 'bob', '-p', 'pw')
    );
    expect(cfg).toMatchObject({
      dialect: 'postgres',
      host: 'pghost',
      port: 5433, // -P "5433" (string) must be converted to the number 5433
      database: 'mydb',
      user: 'bob',
      password: 'pw',
    });
  });

  it('accepts sqlite with a file path via -D', () => {
    // SQLite databases are local files, not network servers.
    // The -D flag carries a file path instead of a database name.
    const cfg = getConnectionConfig(argv('-d', 'sqlite', '-D', './data/mydb.sqlite'));
    expect(cfg).toMatchObject({
      dialect: 'sqlite',
      database: './data/mydb.sqlite',
    });
    // SQLite has no port — the config should leave it undefined rather than
    // setting it to 0 or any other placeholder value.
    expect(cfg.port).toBeUndefined();
  });

  it('defaults host to localhost when not specified', () => {
    // We registered 'localhost' as the default value for -h in Commander,
    // so omitting -h should still give us a host.
    const cfg = getConnectionConfig(argv('-d', 'mysql', '-D', 'shop'));
    expect(cfg.host).toBe('localhost');
  });

  // ── Write / full flags ──────────────────────────────────────────────────────
  // By default dbpeek is read-only. These flags progressively unlock mutations.
  // --write allows data changes (INSERT/UPDATE/DELETE).
  // --full  allows schema changes (CREATE/DROP/ALTER) on top of --write.

  it('sets write=true when --write flag is present', () => {
    const cfg = getConnectionConfig(argv('postgres://u:p@h/db', '--write'));
    expect(cfg.write).toBe(true);
    expect(cfg.full).toBe(false); // --full was not passed, should stay false
  });

  it('sets full=true when --full flag is present', () => {
    const cfg = getConnectionConfig(argv('postgres://u:p@h/db', '--full'));
    expect(cfg.full).toBe(true);
    expect(cfg.write).toBe(false); // --write was not passed, should stay false
  });

  it('allows both --write and --full together', () => {
    const cfg = getConnectionConfig(argv('postgres://u:p@h/db', '--write', '--full'));
    expect(cfg.write).toBe(true);
    expect(cfg.full).toBe(true);
  });

  // ── URL overrides flags ─────────────────────────────────────────────────────
  // When a URL and flags are both provided, URL values win for connection
  // parameters. This lets users keep a base URL and override selectively.

  it('URL argument overrides -d and -h flags', () => {
    // The user typed -d mysql and -h ignored, but also provided a postgres URL.
    // The URL should win for dialect and host.
    const cfg = getConnectionConfig(
      argv('-d', 'mysql', '-h', 'ignored', 'postgres://u:p@actual-host/db')
    );
    expect(cfg.dialect).toBe('postgres');
    expect(cfg.host).toBe('actual-host');
  });

  // ── Validation errors ───────────────────────────────────────────────────────
  // These tests confirm that missing or invalid input produces a clear error
  // message instead of a cryptic crash.
  //
  // Pattern: expect(() => someCall()).toThrow(/regex/)
  //   The arrow function () => ... delays execution so `expect` can wrap it
  //   in a try/catch. The regex is matched case-insensitively with the /i flag.

  it('throws when no dialect or URL is provided', () => {
    // -D mydb tells us the database name but not which engine to use.
    expect(() => getConnectionConfig(argv('-D', 'mydb'))).toThrow(/dialect is required/i);
  });

  it('throws when dialect is provided but database is missing', () => {
    // We know the engine (postgres) but not which database on that server.
    expect(() => getConnectionConfig(argv('-d', 'postgres'))).toThrow(/database name is required/i);
  });

  it('throws a helpful message for sqlite missing -D', () => {
    // SQLite needs a file path. The error should mention -D so the user knows
    // what flag to add — not just "database is required".
    expect(() => getConnectionConfig(argv('-d', 'sqlite'))).toThrow(/sqlite requires a file path/i);
  });

  it('throws for an unknown dialect value', () => {
    // "oracle" is not in our supported list — the error names the valid options.
    expect(() => getConnectionConfig(argv('-d', 'oracle', '-D', 'db'))).toThrow(
      /unknown dialect/i
    );
  });

  it('throws for an unsupported URL scheme', () => {
    // "oracle://" has no matching entry in URL_SCHEME_TO_DIALECT.
    expect(() => getConnectionConfig(argv('oracle://u:p@h/db'))).toThrow(
      /unsupported url scheme/i
    );
  });

  it('throws for a URL missing the database path segment', () => {
    // "postgres://u:p@host" has no path after the host, so pathname would be
    // "" or "/" after stripping the slash — we catch that case explicitly.
    expect(() => getConnectionConfig(argv('postgres://u:p@host'))).toThrow(
      /missing the database name/i
    );
  });
});
