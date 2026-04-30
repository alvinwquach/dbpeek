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

// WHY fileURLToPath(import.meta.url) instead of the native CJS __dirname:
//   package.json sets "type": "module", so TypeScript (with moduleResolution:
//   NodeNext) treats every .ts file as ESM and does not expose the CJS globals
//   __dirname and __filename in the type scope. Using import.meta.url is the
//   idiomatic ESM way to locate the current file, and TypeScript accepts it.
//
// WHY this works at runtime despite compiling to CJS:
//   tsup.config.ts sets shims: true, which instructs tsup to inject a banner
//   at the top of the CJS output that defines:
//     var import_meta = { url: require("url").pathToFileURL(__filename).href }
//   esbuild then rewrites import.meta → import_meta, so import.meta.url becomes
//   the correct file:// URL for the compiled .cjs file. fileURLToPath() converts
//   it back to a native OS path, and path.dirname() gives the directory.
//   Without shims: true, import.meta would be {} and import.meta.url undefined,
//   causing fileURLToPath to throw a TypeError on the first require().
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
 * WHY `config` is passed to the Express layer:
 *   The status route needs access to connection metadata (dialect, host, port,
 *   database, user) to expose them in the API response. While the password is
 *   stored in Knex's internal pool config and never exposed to route handlers,
 *   routes need the other fields to identify the connection to the UI. The
 *   route layer receives the full config but only exposes safe fields.
 *
 * @param config - The full ConnectionConfig. Route handlers extract only the
 *   non-sensitive fields (dialect, host, port, database, user, permissionMode)
 *   for the API response. The password is NOT passed to route handlers.
 * @param db - An initialised Knex instance (pool created, connectivity not yet
 *   verified — that's testConnection's job).
 * @returns A configured Express app, ready for app.listen().
 */
export function createApp(config: ConnectionConfig, db: Knex): Express {
  const app = express();

  // ── Middleware stack ────────────────────────────────────────────────────────

  // CORS: localhost origins only (see LOCALHOST_ORIGINS above).
  app.use(localhostCors);

  // JSON body parser. 10 MB limit is generous for a dev tool — real query
  // payloads are tiny, but leaves room for potential future bulk operations.
  app.use(express.json({ limit: "10mb" }));

  // ── Static file serving ────────────────────────────────────────────────────

  // WHY `path.join(__dirname, "../client")`:
  //   At runtime, this file lives at dist/server/index.js.
  //   __dirname = <project-root>/dist/server/
  //   One "../" up reaches <project-root>/dist/
  //   Then "client" resolves to <project-root>/dist/client/ — exactly where
  //   `vite build` writes its output (outDir: "../../dist/client" relative to
  //   root src/client/ in vite.config.ts).
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
  const clientDistPath = path.join(__dirname, "../client");
  app.use(express.static(clientDistPath));

  // ── API routes ─────────────────────────────────────────────────────────────
  registerRoutes(app, config, db);

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
 * Creates the Express app and returns both the app and the db handle.
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
 * @param db - An initialised Knex instance.
 * @returns `{ app, db }` — the Express app and the Knex instance (for shutdown).
 */
export function createServer(
  config: ConnectionConfig,
  db: Knex
): { app: Express; db: Knex } {
  const app = createApp(config, db);
  return { app, db };
}
