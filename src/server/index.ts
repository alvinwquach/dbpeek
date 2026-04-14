/**
 * src/server/index.ts
 *
 * Express server factory — the module that builds the HTTP server for dbpeek.
 *
 * ─── What is Express? ────────────────────────────────────────────────────────
 * Express is a lightweight Node.js framework for building HTTP servers. You
 * register "routes" (URL path + HTTP verb pairs), attach middleware (code that
 * runs for every request), and Express does the rest: it calls your code when
 * a matching request arrives.
 *
 * ─── What is middleware? ─────────────────────────────────────────────────────
 * Middleware is a function that runs between the incoming request and the
 * route handler. Express processes middleware in the order you register it with
 * app.use(). Each middleware can:
 *   - Modify the request (req) or response (res) objects.
 *   - Call next() to pass control to the next middleware / route.
 *   - Send a response itself (short-circuiting later handlers).
 *
 * ─── What is CORS? ───────────────────────────────────────────────────────────
 * CORS (Cross-Origin Resource Sharing) is a browser security policy that
 * blocks JavaScript from one origin (scheme + hostname + port) from reading
 * responses from a different origin.
 *
 * During development, the React frontend runs on http://localhost:5173 (Vite)
 * while this API server runs on http://localhost:3000. Because the ports
 * differ, they are considered "different origins" and the browser will block
 * all API calls from the frontend — unless the server adds the right HTTP
 * headers to opt in.
 *
 * We restrict CORS to localhost-only origins for security: we don't want
 * random websites on the internet to be able to query your local database.
 *
 * ─── Permission modes ────────────────────────────────────────────────────────
 * dbpeek starts in safe read-only mode by default. Users can opt into wider
 * access with CLI flags:
 *
 *   'read-only'  — only SELECT queries (default, safest)
 *   'write'      — also allows INSERT / UPDATE / DELETE
 *   'full'       — also allows CREATE / DROP / ALTER (DDL)
 *
 * The mode is passed to createServer() and stored on app.locals so that route
 * handlers can check it before executing mutations.
 *
 * ─── Pseudocode ──────────────────────────────────────────────────────────────
 *   1. Create an Express application instance.
 *   2. Attach CORS middleware (localhost origins only).
 *   3. Attach JSON body-parser so route handlers can read req.body.
 *   4. Store the knex instance and permission mode on app.locals.
 *   5. Register routes:
 *        GET  /health    — liveness check (returns { status: 'ok' })
 *        GET  /api/mode  — returns the current permission mode
 *        POST /api/echo  — reflects the JSON body (used in tests + debugging)
 *        (future) mount feature routers from src/server/routes/index.ts
 *   6. Serve static files from '../client/dist' (the compiled React build).
 *   7. Return the Express app (NOT a running server — the caller decides the
 *      port and calls app.listen() when ready).
 *
 * ─── Why return the app instead of calling app.listen() here? ────────────────
 * Keeping the factory (createServer) separate from the startup (app.listen)
 * makes testing simple: tests can create the app and bind it to a random
 * OS-assigned port (port 0) without fighting over port 3000.
 *
 * ─── Exports ─────────────────────────────────────────────────────────────────
 *   ServerConfig  — TypeScript interface for createServer's argument
 *   createServer  — factory that returns a configured Express app
 */

import express, { type Express } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Knex } from './db.js';

// ── __dirname shim ────────────────────────────────────────────────────────────
// ES modules (files with "type": "module" in package.json) do not have the
// CommonJS __dirname variable. We recreate it with two built-in Node.js helpers:
//
//   import.meta.url  — the file:// URL of the current module
//   fileURLToPath()  — converts a file:// URL to an OS path string
//   path.dirname()   — returns the directory portion of a path
//
// __dirname ends up being something like "/Users/alice/projects/dbpeek/src/server"
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The permission modes that dbpeek supports.
 *
 * 'read-only'  — SELECT only (the safe default)
 * 'write'      — also allows INSERT / UPDATE / DELETE
 * 'full'       — also allows CREATE / DROP / ALTER (DDL)
 */
export type PermissionMode = 'read-only' | 'write' | 'full';

/**
 * Configuration object passed to createServer().
 *
 * knex  — an already-initialised Knex instance (created by createKnexInstance
 *          in src/server/db.ts). Route handlers use this to run queries.
 * mode  — the permission mode chosen via CLI flags (default: 'read-only').
 */
export interface ServerConfig {
  knex: Knex;
  mode: PermissionMode;
}

// ── CORS origin filter ────────────────────────────────────────────────────────

/**
 * isLocalhostOrigin
 *
 * Returns true if the HTTP Origin header points to localhost (any port).
 *
 * Why restrict to localhost?
 *   dbpeek is a local developer tool. There is no reason for a request coming
 *   from a remote website to be able to query your local database. Restricting
 *   CORS to localhost origins is a simple but effective security layer.
 *
 * Recognised localhost forms:
 *   http://localhost        http://localhost:5173
 *   http://127.0.0.1        http://127.0.0.1:3000
 *   http://[::1]            http://[::1]:8080      (IPv6 loopback)
 *
 * How the regex works:
 *   /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
 *    ^                  — must match from the start of the string
 *    https?             — http OR https (the ? makes the 's' optional)
 *    :\/\/              — literal "://"
 *    (localhost|...)    — any of the three loopback hostname forms
 *    (:\d+)?            — optional port number (:5173, :3000, etc.)
 *    $                  — must match to the end of the string
 *
 * @param origin - the value of the HTTP Origin header (may be undefined)
 */
function isLocalhostOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * createServer
 *
 * Builds and returns a fully configured Express application.
 * Does NOT start listening — call app.listen(port) after you receive the app.
 *
 * @param config - knex instance + permission mode
 * @returns        a configured Express app ready to be listened on
 */
export function createServer(config: ServerConfig): Express {
  // ── Step 1: create the Express app ─────────────────────────────────────────
  // express() returns a new application object. Think of it as a blank canvas
  // onto which we paint middleware and routes with app.use() and app.get() etc.
  const app = express();

  // ── Step 2: CORS middleware ─────────────────────────────────────────────────
  // The cors() function returns a middleware that adds the appropriate response
  // headers so the browser allows the request.
  //
  // We pass a custom `origin` callback instead of using cors({ origin: '*' })
  // (which would allow any website to talk to your local database).
  //
  // The callback signature is: (origin, callback)
  //   origin   — the value of the Origin header (undefined for same-origin or
  //              non-browser requests like curl)
  //   callback — call with (error, allow?) to tell cors() what to do:
  //                callback(null, true)  — allow the request
  //                callback(null, false) — block the request (no allow header)
  app.use(
    cors({
      origin: (origin, callback) => {
        if (isLocalhostOrigin(origin)) {
          // Allow: the request comes from localhost (our frontend dev server or
          // the browser talking to its own localhost tab).
          callback(null, true);
        } else {
          // Block: don't reflect the origin back in the response headers.
          // We pass false (not an Error) so cors sends back no allow-origin
          // header, which causes the browser to block the cross-origin request.
          callback(null, false);
        }
      },
    })
  );

  // ── Step 3: JSON body parser ────────────────────────────────────────────────
  // Without this middleware, req.body is undefined for POST/PUT/PATCH requests
  // with a JSON payload. express.json() reads the raw request body, parses it,
  // and attaches the resulting object to req.body before calling next().
  app.use(express.json());

  // ── Step 4: store knex + mode on app.locals ─────────────────────────────────
  // app.locals is a plain object that lives for the lifetime of the application.
  // Storing things here makes them available to every route handler via
  // req.app.locals — no need to import the knex instance in every route file.
  app.locals['knex'] = config.knex;
  app.locals['mode'] = config.mode;

  // ── Step 5: routes ──────────────────────────────────────────────────────────

  /**
   * GET /health
   *
   * Liveness check — returns { status: 'ok' } when the server is running.
   *
   * Uses for this endpoint:
   *   - Docker HEALTHCHECK: `HEALTHCHECK CMD curl -f http://localhost:3000/health`
   *   - CI smoke test after deployment
   *   - Quick sanity check: `curl http://localhost:3000/health`
   *
   * The underscore prefix on _req is a convention meaning "this parameter is
   * required by the Express signature but we don't use it in this handler."
   * TypeScript would warn about an unused variable without the underscore.
   */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  /**
   * GET /api/mode
   *
   * Returns the current permission mode as JSON.
   * Useful for the React frontend to know which buttons to enable/disable.
   *
   * Example response: { "mode": "read-only" }
   */
  app.get('/api/mode', (_req, res) => {
    res.json({ mode: config.mode });
  });

  /**
   * POST /api/echo
   *
   * Reflects the JSON request body back to the caller unchanged.
   *
   * Why does this exist?
   *   It serves two purposes:
   *     1. Tests can POST a body and verify that express.json() parsed it.
   *     2. Developers debugging the server can send any JSON and see it echoed.
   *
   * Example:
   *   curl -X POST http://localhost:3000/api/echo \
   *     -H 'Content-Type: application/json' \
   *     -d '{"hello":"world"}'
   *   → { "hello": "world" }
   */
  app.post('/api/echo', (req, res) => {
    // req.body is the parsed JSON object — express.json() populated it earlier.
    res.json(req.body);
  });

  // TODO: mount feature routers once they exist, e.g.:
  //   import router from './routes/index.js';
  //   app.use('/api', router);
  // This will make every route in routes/index.ts available under /api.

  // ── Step 6: static files ────────────────────────────────────────────────────
  // express.static() serves files from a directory.
  // In production, `npm run build` compiles the React frontend into
  // src/client/dist/. We serve that directory so users can open the app in
  // a browser without running the Vite dev server separately.
  //
  // path.resolve(__dirname, '../client/dist') computes the absolute path:
  //   __dirname → .../src/server
  //   ../client/dist → .../src/client/dist
  //
  // If the dist/ directory doesn't exist yet (e.g. during development before
  // the first `npm run build`), Express silently skips this middleware —
  // no error is thrown.
  const clientDistPath = path.resolve(__dirname, '../client/dist');
  app.use(express.static(clientDistPath));

  // ── Step 7: return the app ─────────────────────────────────────────────────
  // We return the app *without* calling app.listen() so that:
  //   - Tests can bind to a random OS-assigned port (port 0) without conflict.
  //   - The CLI can try multiple ports before calling app.listen().
  //   - The same factory function works in both development and production.
  return app;
}
