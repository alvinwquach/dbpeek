// ===== FILE PURPOSE =====
// Route registration hub — the single place where every API endpoint is mounted
// onto the Express app.
//
// WHY centralise route registration here instead of calling app.use() directly
// in server/index.ts:
//   As the route count grows, each route group lives in its own file
//   (routes/query.ts, routes/schema.ts, ...). This file is the index that
//   imports and mounts all of them. Having one registration point means:
//     1. The full API surface is visible at a glance without opening each file.
//     2. Cross-cutting concerns (auth middleware, rate-limiting) can be applied
//        to groups of routes in one place rather than repeated in every file.
//     3. server/index.ts stays focused on Express setup and doesn't accumulate
//        route-specific logic.

import type { Express } from "express";
import type { Knex } from "../db.js";
import type { PermissionMode } from "../../types/connection.js";
import { createQueryRouter } from "./query.js";

/**
 * Mounts all API route handlers onto the Express app.
 *
 * WHY `db` and `permissionMode` are parameters rather than module-level globals:
 *   Route handlers are closures — they capture `db` and `permissionMode` at
 *   registration time. Passing them as parameters (rather than importing them
 *   from a global module) means the same route file can be used in tests with a
 *   mock Knex instance and a different permission level, without any module-level
 *   state to reset between test cases.
 *
 * WHY permissionMode is threaded all the way to createQueryRouter:
 *   The query route validates every SQL string against the mode set at CLI
 *   launch. Passing the mode through registerRoutes (rather than reading it
 *   from a shared variable inside the handler) keeps the data flow explicit
 *   and avoids a hidden global dependency. It also means the mode is captured
 *   in the closure ONCE — there is no API path that mutates it at runtime,
 *   which is the core of the security guarantee in permissions.ts.
 */
export function registerRoutes(
  app: Express,
  db: Knex,
  permissionMode: PermissionMode
): void {
  // ── Health check ───────────────────────────────────────────────────────────
  //
  // WHY _req (underscore prefix): the handler signature requires a `req`
  // parameter even though this route doesn't inspect the request. The leading
  // underscore is the TypeScript/ESLint convention for an intentionally unused
  // parameter — it suppresses the lint warning without a rule override.
  //
  // WHY /api/health and not just /health:
  //   The /api/ prefix is the boundary between the Express route table and the
  //   SPA fallback in server/index.ts. Without the prefix, a request to /health
  //   would be caught by the SPA wildcard and return index.html instead of JSON.
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Query execution ────────────────────────────────────────────────────────
  //
  // WHY app.use("/api/query", router) mounts at a subpath:
  //   The router's own routes ("/" inside the router) become "/api/query"
  //   externally. Mounting at a subpath lets us add sibling routes inside the
  //   query namespace later (e.g. POST /api/query/explain) without changing
  //   the registration call. It also keeps the security-critical query handler
  //   isolated to a dedicated module file.
  app.use("/api/query", createQueryRouter(db, permissionMode));

  // ── Future routes ──────────────────────────────────────────────────────────
  // Each group will be extracted to its own file and mounted here, e.g.:
  //   app.use("/api/schema", schemaRouter(db));
  //   app.use("/api/tables", tablesRouter(db));
}
