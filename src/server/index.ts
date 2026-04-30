// ===== FILE PURPOSE =====
// Express app factory — the programmatic entry point for dbpeek's HTTP server.
//
// WHY Express over Fastify/Hono:
//   This is a single-user localhost tool running ~2 req/min. Performance is
//   irrelevant. Express is chosen for familiarity — every Node developer knows
//   its middleware signature (req, res, next), making the codebase accessible
//   to contributors without Fastify/Hono experience. Benchmarks don't matter
//   when the bottleneck is the human reading the SQL result.
//
// ARCHITECTURE:
//   createApp(config, db) → Express app    (sync, no I/O — testable)
//   createServer(config)  → Promise<{ app, db }>  (creates db, calls createApp)
//
//   The CLI calls createServer() and then calls app.listen() itself so it can
//   implement port-fallback logic (3000 → 3001 → … → 3010). Separating app
//   creation from listen() also makes integration tests simpler: tests call
//   createApp() with a mock Knex instance and never touch the network.
//
// CORS POLICY:
//   Restricted to localhost origins only. During Vite dev (port 5173 calls
//   port 3000), the browser's Same-Origin Policy would block the request
//   without CORS headers. We allow only localhost variants so a remote page
//   cannot call dbpeek's API if the user has it running.

import path from "path";
// WHY fileURLToPath instead of new URL(import.meta.url).pathname:
//   On Windows, import.meta.url is a file:// URL with forward slashes
//   (file:///C:/Users/…). Accessing .pathname directly gives "/C:/Users/…" —
//   a path with a leading slash that Node's fs and path modules can't resolve.
//   fileURLToPath() handles the Windows drive-letter edge case and returns
//   a native OS path ("C:\\Users\\…") that path.dirname() and path.join() treat
//   correctly on all platforms.
import { fileURLToPath } from "url";
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "./db.js";
import type { ConnectionConfig, PermissionMode } from "../types/connection.js";
import { registerRoutes } from "./routes/index.js";

// ===== PATH RESOLUTION =====

// WHY __dirname shim:
//   tsup compiles to CJS (see tsup.config.ts), so __dirname IS available at
//   runtime. But TypeScript's type checker runs in the context of the source
//   file, which uses `"type": "module"` in the project tsconfig. The shim
//   is a no-op at runtime (CJS provides __dirname natively) but satisfies
//   the type checker when `moduleResolution` is set to Node16/NodeNext.
//   If tsup switches to ESM output in the future, the shim will be needed
//   for real — keeping it now means zero change required on that day.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== CORS CONFIGURATION =====

/**
 * List of localhost origins allowed to call the API.
 *
 * WHY explicit localhost-only allowlist instead of `cors()` with no options:
 *   `cors()` with no arguments sets `Access-Control-Allow-Origin: *`, which
 *   allows ANY page on the internet to call dbpeek's API if the user has it
 *   running. A malicious site could enumerate the user's database schema.
 *   Restricting to localhost variants prevents cross-origin calls from remote
 *   pages while still allowing the Vite dev server (port 5173) to call the
 *   API (port 3000) during development.
 *
 * WHY 127.0.0.1 in addition to localhost:
 *   Some browsers and tools treat `localhost` and `127.0.0.1` as different
 *   origins. Including both ensures the Vite dev server works regardless of
 *   whether the user navigates to http://localhost:5173 or http://127.0.0.1:5173.
 */
const LOCALHOST_ORIGINS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

/** cors middleware that allows only localhost origins. */
const localhostCors = cors({
  origin(origin, callback) {
    // WHY allow requests with no origin:
    //   Non-browser clients (curl, Postman, the CLI health-check itself) send
    //   requests with no `Origin` header. Blocking them here would break the
    //   CLI's own startup connectivity probe. The CORS header is a browser
    //   mechanism — non-browser callers aren't subject to it anyway.
    if (!origin) return callback(null, true);

    const allowed = LOCALHOST_ORIGINS.some((re) => re.test(origin));
    if (allowed) return callback(null, true);

    callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  // WHY credentials: true:
  //   Reserved for future cookie-based session support (e.g. if we add a
  //   login wall). Setting it now avoids a breaking CORS change later.
  credentials: true,
});

// ===== APP FACTORY =====

/**
 * Builds and returns a configured Express application.
 *
 * WHY `createApp` is separate from `createServer`:
 *   createApp() is a pure factory — it accepts an already-created Knex instance
 *   and returns an Express app. No async I/O, no side effects. This makes it
 *   trivially testable: pass a mock Knex, get an app, hit routes with supertest
 *   or http.request. createServer() is the async wrapper that wires up the real
 *   Knex connection for production use.
 *
 * WHY `permissionMode` is a separate parameter from config:
 *   The rest of `config` (host, port, database, credentials) is only needed by
 *   the DB layer. Passing the full ConnectionConfig to the Express layer would
 *   give route handlers access to the raw database password, which violates the
 *   principle of least privilege. Passing only `permissionMode` gives the query
 *   route exactly the information it needs to enforce SQL permissions without
 *   exposing credentials.
 *
 * @param db - An initialised Knex instance (pool created, connectivity not yet
 *   verified — that's testConnection's job).
 * @param permissionMode - SQL permission level for this session, forwarded to
 *   route handlers so they can enforce the allowlist.
 * @returns A configured Express app, ready for app.listen().
 */
export function createApp(db: Knex, permissionMode: PermissionMode): Express {
  const app = express();

  // ── Middleware stack ────────────────────────────────────────────────────────

  // CORS: localhost origins only (see LOCALHOST_ORIGINS above).
  app.use(localhostCors);

  // JSON body parser. 10 MB limit is generous for a dev tool — real query
  // payloads are tiny, but leaves room for potential future bulk operations.
  app.use(express.json({ limit: "10mb" }));

  // ── Static file serving ────────────────────────────────────────────────────

  // WHY `path.join(__dirname, "../../client/dist")`:
  //   At runtime, this file is at dist/server/index.js. The Vite output lands
  //   at dist/client/ (see vite.config.ts). Going up two levels from
  //   dist/server/ reaches dist/, then down into client/dist reaches the built
  //   React app. The path is relative to the compiled output, not the source.
  //
  // WHY serve static files BEFORE API routes:
  //   Express matches middleware in registration order. Serving static files
  //   first means asset requests (JS, CSS, images) are handled by serve-static
  //   without going through the route table. API routes are registered after,
  //   so `/api/*` paths correctly reach the route handlers.
  //
  // WHY `index: "index.html"` (the default):
  //   This is a SPA — all deep links (e.g. /tables/users) should serve
  //   index.html and let React Router handle routing client-side. The fallback
  //   route below handles this by catching any unmatched path.
  const clientDistPath = path.join(__dirname, "../../client/dist");
  app.use(express.static(clientDistPath));

  // ── API routes ─────────────────────────────────────────────────────────────
  registerRoutes(app, db, permissionMode);

  // ── SPA fallback ───────────────────────────────────────────────────────────

  // WHY a wildcard fallback for non-API paths:
  //   React Router manages client-side navigation. If the user refreshes
  //   http://localhost:3000/tables/users, Express would return 404 without
  //   this fallback because there is no static file at that path. Returning
  //   index.html for any unmatched non-API path hands control back to React
  //   Router, which re-renders the correct view.
  //
  // WHY the negative lookahead (/(?!api/)):
  //   We only want to fall back to index.html for UI routes. API paths that
  //   don't match a registered route should return 404 from the route layer,
  //   not silently return the React app. The regex excludes /api/* so that
  //   typo'd API calls (e.g. /api/qeury instead of /api/query) get a proper
  //   404 JSON response rather than the HTML shell.
  // WHY _req (underscore prefix):
  //   The Express route handler signature requires a `req` parameter even when
  //   the handler doesn't use it. Prefixing with _ is the TypeScript/ESLint
  //   convention for "intentionally unused parameter" — it suppresses the
  //   "no-unused-vars" lint warning without disabling the rule site-wide.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDistPath, "index.html"));
  });

  return app;
}

// ===== SERVER FACTORY (production entry point) =====

/**
 * Creates a Knex instance and returns both the Express app and the db handle.
 *
 * WHY return `{ app, db }` instead of just `app`:
 *   The CLI needs the `db` reference to call destroyConnection() on SIGINT/SIGTERM.
 *   If createServer() only returned `app`, the CLI would have no way to clean up
 *   the pool on shutdown — connections would remain open until the database server
 *   timed them out.
 *
 * WHY not call testConnection() here:
 *   testConnection() is called by the CLI BEFORE createServer(), so that a bad
 *   connection string is rejected before Express ever binds to a port. If we
 *   called it inside createServer(), a connectivity failure would happen after
 *   the port is already allocated, making the error message less clear. Keeping
 *   it in the CLI also means tests that call createServer() with a mock Knex
 *   instance don't need to mock the probe query.
 *
 * @param config - Fully resolved ConnectionConfig from the CLI parser.
 * @returns `{ app, db }` — the Express app and the Knex instance (for shutdown).
 */
export function createServer(
  config: ConnectionConfig,
  db: Knex
): { app: Express; db: Knex } {
  const app = createApp(db, config.permissionMode);
  return { app, db };
}
