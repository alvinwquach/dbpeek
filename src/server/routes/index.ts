// ===== FILE PURPOSE =====
// Route registration hub — the single place where every API endpoint is mounted
// onto the Express app.
//
// WHY centralise route registration here instead of calling app.use() directly
// in server/index.ts:
//   As the route count grows, each route group (schema, query, tables) will move
//   into its own file (e.g. routes/query.ts). This file becomes the index that
//   imports and mounts all of them. Having one registration point means:
//     1. The full API surface is visible at a glance without opening each file.
//     2. Cross-cutting concerns (auth middleware, rate-limiting) can be applied
//        to groups of routes in one place rather than repeated in every file.
//     3. server/index.ts stays focused on Express setup and doesn't accumulate
//        route-specific logic.

import type { Express } from "express";
import type { Knex } from "../db.js";
import type { PermissionMode } from "../../types/connection.js";

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
 * WHY permissionMode is threaded through here even though no route uses it yet:
 *   The query route (coming next) will call validateStatement() and needs to know
 *   whether the session allows write or full access. Passing it at registration
 *   time — rather than reading it from a shared variable inside the handler —
 *   keeps the data flow explicit and avoids a hidden global dependency.
 */
export function registerRoutes(
  app: Express,
  db: Knex,
  permissionMode: PermissionMode
): void {
  // WHY `void db` and `void permissionMode`:
  //   Both parameters will be consumed by route handlers added in the next
  //   iteration. Until then, referencing them with void suppresses TypeScript's
  //   "declared but its value is never read" hint without disabling the rule
  //   globally or introducing a fake usage that misleads readers.
  void db;
  void permissionMode;

  // ── Health check ───────────────────────────────────────────────────────────

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

  // ── Future routes ──────────────────────────────────────────────────────────
  // Each group will be extracted to its own file and mounted here, e.g.:
  //   app.use("/api/schema", schemaRouter(db));
  //   app.use("/api/query",  queryRouter(db, permissionMode));
  //   app.use("/api/tables", tablesRouter(db));
}
