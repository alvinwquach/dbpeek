/**
 * tests/e2e/start-server.cjs — Playwright E2E test server bootstrap.
 *
 * ===== WHAT IT DOES =====
 *
 *   1. PREFLIGHT  — verifies that dist/server/index.cjs exists; exits 1 with a
 *                   helpful message if the project has not been built yet.
 *
 *   2. SEED       — creates a fresh SQLite fixture database at
 *                   tests/e2e/fixtures/test.db with three tables:
 *                     users  (id, name, email, age, active)
 *                     posts  (id, user_id, title, body, published)
 *                     tags   (id, name, color)
 *                   plus deterministic seed data (3 users, 3 posts, 3 tags).
 *
 *   3. CONNECT    — creates a Knex connection for the SQLite fixture file
 *                   using the better-sqlite3 client.
 *
 *   4. SERVE      — calls createApp(config, db) from the built server bundle
 *                   (dist/server/index.cjs) to obtain a configured Express app,
 *                   then starts an http.Server on port 4747.
 *
 *   5. SHUTDOWN   — on SIGTERM (sent by Playwright when all tests finish),
 *                   closes the HTTP server and destroys the Knex pool.
 *
 * ===== WHY CJS =====
 *
 *   The built server is compiled as CommonJS by tsup (format: ["cjs"]) because
 *   the database driver ecosystem is primarily CJS. A .cjs extension on this
 *   file explicitly opts out of Node's ESM treatment (which applies to .js when
 *   package.json has "type": "module"), so require() calls work without any
 *   import() dance.
 *
 * ===== WHY PORT 4747 =====
 *
 *   Chosen to avoid collisions with common local dev ports:
 *     3000 — dbpeek's default CLI port
 *     4000 — Vite dev-proxy target
 *     5173 — Vite dev server
 *   playwright.config.ts's webServer.url and use.baseURL both point here.
 *
 * ===== WHY RECREATE THE DB ON EACH RUN =====
 *
 *   E2E tests should start from a known, deterministic state. If a previous run
 *   left mutations (failed tests don't clean up), a stale DB would cause
 *   spurious failures on the next run. Dropping and recreating on startup is the
 *   simplest way to enforce this invariant without transactions or teardown hooks.
 *
 * ===== PERMISSION MODE =====
 *
 *   The server starts in readonly mode (the default). This lets us test that:
 *     a) SELECT queries work as expected.
 *     b) INSERT / UPDATE / DELETE / DDL statements are blocked with a
 *        permission error message — the "permission blocking" tests in app.spec.ts.
 *
 * ===== PREREQUISITES =====
 *
 *   npm run build:all must be run before this script because it requires:
 *     dist/server/index.cjs — Express app factory (createApp)
 *     dist/client/           — Vite-built React SPA served as static files
 */

'use strict';

// ===== IMPORTS =====

const http = require('http');
const path = require('path');
const fs = require('fs');

// better-sqlite3: synchronous SQLite API — perfect for one-shot fixture setup.
// It is in project dependencies (package.json) so no extra install needed.
const Database = require('better-sqlite3');

// Knex is used to create the connection passed to createApp(). The Express
// routes expect a Knex instance (db.raw() calls), not a better-sqlite3 handle.
// Using Knex here keeps the interface identical to production.
const knex = require('knex');

// ===== PATHS =====

/** Absolute path to the built server entry point. */
const DIST_SERVER = path.join(__dirname, '../../dist/server/index.cjs');

/** Directory where the SQLite fixture lives. Created if absent. */
const FIXTURES_DIR = path.join(__dirname, 'fixtures');

/** Absolute path to the SQLite fixture database file. */
const DB_PATH = path.join(FIXTURES_DIR, 'test.db');

/** Port the test HTTP server listens on. Must match playwright.config.ts. */
const PORT = 4747;

// ===== PRE-FLIGHT CHECK =====

/**
 * Fail fast with a clear message when the build artifacts are absent.
 *
 * WHY this check:
 *   Without it, the first require() below throws a cryptic "Cannot find module"
 *   error that doesn't tell the developer what to do. A pre-flight message
 *   ("run npm run build:all") is immediately actionable.
 */
if (!fs.existsSync(DIST_SERVER)) {
  console.error(
    '[e2e-server] ERROR: dist/server/index.cjs not found.\n' +
    '[e2e-server] Build the project first: npm run build:all'
  );
  process.exit(1);
}

// ===== SEED DATABASE =====

/**
 * Recreate the SQLite fixture database from scratch on every server start.
 *
 * WHY better-sqlite3 for setup (not Knex):
 *   better-sqlite3's exec() runs multi-statement SQL in one call — perfect for
 *   seeding an entire schema in a single string. Knex's schema builder would
 *   require multiple chained promise calls for the same result. We only use
 *   better-sqlite3 for the synchronous setup step; Knex takes over for queries.
 *
 * WHY Integer 0/1 for booleans in SQLite:
 *   SQLite has no native BOOLEAN type. The convention (used by most ORMs and
 *   drivers) is INTEGER with 0 = false, 1 = true. The Knex SQLite adapter
 *   returns them as numbers, matching what the seed inserts.
 */

// Ensure the fixtures directory exists before trying to create the DB.
fs.mkdirSync(FIXTURES_DIR, { recursive: true });

// Drop any existing fixture DB so tests always start from a clean slate.
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}

const sqlite = new Database(DB_PATH);

sqlite.exec(`
  -- ===== SCHEMA =====

  -- users: represents application users with a numeric age for chart tests.
  CREATE TABLE users (
    id     INTEGER PRIMARY KEY,
    name   TEXT    NOT NULL,
    email  TEXT    NOT NULL,
    age    INTEGER,
    active INTEGER NOT NULL DEFAULT 1
  );

  -- posts: belongs to users; tests JOIN queries and foreign key display.
  CREATE TABLE posts (
    id        INTEGER PRIMARY KEY,
    user_id   INTEGER NOT NULL,
    title     TEXT    NOT NULL,
    body      TEXT,
    published INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  -- tags: small lookup table; tests single-table queries and DDL viewer.
  CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT    NOT NULL UNIQUE,
    color TEXT
  );

  -- ===== SEED DATA =====
  -- Three rows per table keeps result sets small and assertions easy to write.
  -- Values are chosen so:
  --   - age column (numeric) triggers chart detection in ChartView.
  --   - active column (0/1) exercises boolean cell rendering in ValueViewer.
  --   - name/email columns are TEXT for sidebar search and filter tests.

  INSERT INTO users VALUES (1, 'Alice Smith',  'alice@example.com', 30, 1);
  INSERT INTO users VALUES (2, 'Bob Jones',    'bob@example.com',   25, 1);
  INSERT INTO users VALUES (3, 'Carol White',  'carol@example.com', 35, 0);

  INSERT INTO posts VALUES (1, 1, 'Hello World',  'First post body',   1);
  INSERT INTO posts VALUES (2, 1, 'Second Post',  'Some content here', 0);
  INSERT INTO posts VALUES (3, 2, 'Bob''s Post',  'Bob wrote this',    1);

  INSERT INTO tags VALUES (1, 'typescript', '#3178c6');
  INSERT INTO tags VALUES (2, 'javascript', '#f7df1e');
  INSERT INTO tags VALUES (3, 'react',      '#61dafb');
`);

// Close the better-sqlite3 handle — Knex opens its own connection below.
// SQLite's WAL mode (not enabled here) would allow concurrent readers, but
// the default journal mode is fine for sequential test execution.
sqlite.close();

console.log('[e2e-server] SQLite fixture created at', DB_PATH);

// ===== KNEX CONNECTION =====

/**
 * Knex instance for the test SQLite database.
 *
 * WHY Knex (not better-sqlite3 directly) for the server:
 *   createApp() is typed to accept a Knex instance and uses db.raw() for all
 *   SQL execution. Passing a better-sqlite3 Database object directly would
 *   bypass the permission validation and dialect normalisation in route handlers.
 *
 * useNullAsDefault: true:
 *   Required by Knex's SQLite adapter. Without it, Knex throws a warning when
 *   INSERT statements don't explicitly set columns that have DEFAULT NULL — even
 *   though SQLite handles the default correctly at the DB level.
 */
const db = knex({
  client: 'better-sqlite3',
  connection: {
    filename: DB_PATH,
  },
  useNullAsDefault: true,
});

// ===== EXPRESS APP =====

/**
 * Import createApp from the built server bundle.
 *
 * WHY require() the .cjs path directly:
 *   The package.json "main" field points to the old .js path that no longer
 *   exists after tsup compiles with "type": "module" in scope. Requiring the
 *   explicit .cjs path bypasses the resolution ambiguity and matches exactly
 *   what the CLI uses at runtime.
 */
const { createApp } = require(DIST_SERVER);

/**
 * Connection configuration passed to createApp.
 *
 * KEY SETTINGS:
 *   dialect: 'sqlite'   — tells the status/schema routes to use SQLite handlers
 *   database: DB_PATH   — the path shown in the status bar and used for DDL queries
 *   permissionMode: 'readonly' — SELECT-only; INSERT/DDL produce permission errors
 *                                (exercised by the "permission blocking" tests)
 *
 * WHY readonly:
 *   The E2E tests use a shared SQLite file. Readonly mode prevents tests from
 *   mutating the fixture data and polluting other tests that rely on the initial
 *   3-row state. The "permission blocking" tests intentionally exercise the
 *   readonly enforcement and expect a 403-style error response.
 */
const config = {
  dialect: 'sqlite',
  host: 'localhost',
  port: 0,          // SQLite has no network port; 0 is the sentinel value
  database: DB_PATH,
  user: '',
  password: '',
  permissionMode: 'readonly',
};

const app = createApp(config, db);

// ===== HTTP SERVER =====

const server = http.createServer(app);

server.listen(PORT, '127.0.0.1', () => {
  // Playwright's webServer.url polling detects the server is ready when
  // a GET to http://localhost:4747 returns a 2xx/3xx status. Express's static
  // file middleware serves dist/client/index.html on GET /, satisfying this.
  console.log(`[e2e-server] Ready at http://localhost:${PORT}`);
});

// ===== GRACEFUL SHUTDOWN =====

/**
 * SIGTERM handler — sent by Playwright after all tests finish.
 *
 * Sequence:
 *   1. server.close()    — stop accepting new connections; finish active ones.
 *   2. db.destroy()      — drain the Knex connection pool.
 *   3. process.exit(0)   — terminate cleanly.
 *
 * WHY not unlink DB_PATH here:
 *   The DB file will be recreated on the next test run anyway. Deleting it in
 *   the shutdown hook would fail if the file is still open (Windows file locks)
 *   and adds no correctness benefit.
 */
process.on('SIGTERM', () => {
  server.close(() => {
    db.destroy().finally(() => process.exit(0));
  });
});
