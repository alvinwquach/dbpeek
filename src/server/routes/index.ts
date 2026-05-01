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
import type { ConnectionConfig } from "../../types/connection.js";
import { createQueryRouter } from "./query/index.js";
import { createStatusRouter } from "./status.js";
import { createSchemaRouter } from "./schema/index.js";
import { createExplainRouter } from "./explain/index.js";

/**
 * Mounts all API route handlers onto the Express app.
 *
 * WHY `config` and `db` are parameters rather than module-level globals:
 *   Route handlers are closures — they capture `config` and `db` at registration
 *   time. Passing them as parameters (rather than importing them from a global
 *   module) means the same route file can be used in tests with a mock
 *   ConnectionConfig and mock Knex instance, without any module-level state to
 *   reset between test cases.
 *
 * WHY config (not just permissionMode) is threaded through:
 *   The status route needs access to connection metadata (dialect, host, port,
 *   database, user) to expose them in the API response. The query route needs
 *   the permissionMode. Passing the full config means each route extracts only
 *   the fields it needs — no route has access to the password.
 */
export function registerRoutes(
  app: Express,
  config: ConnectionConfig,
  db: Knex
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
  // WHY config.dialect is passed alongside permissionMode:
  //   The query router now needs the dialect to (a) choose the correct
  //   PID query when pinning a connection for cancel support, and (b)
  //   choose the correct kill command in POST /api/query/cancel.
  app.use("/api/query", createQueryRouter(db, config.permissionMode, config.dialect));

  // ── Status ─────────────────────────────────────────────────────────────────
  //
  // GET /api/status exposes connection metadata (dialect, host, port, database,
  // user, mode) and connectivity status. The password is never included in the
  // response — it exists only in the Knex pool config in server memory.
  app.use("/api/status", createStatusRouter(config, db));

  // ── Schema introspection ───────────────────────────────────────────────────
  //
  // GET /api/schema           → list of tables with estimated row counts
  // GET /api/schema/:table    → columns, types, PK/FK/index metadata
  //
  // Powers the UI's schema tree and SQL autocomplete. The router needs the
  // full config because it dispatches per dialect (Postgres / MySQL / SQLite
  // / MSSQL each query their own metadata catalogs).
  app.use("/api/schema", createSchemaRouter(config, db));

  // ── EXPLAIN plan visualization ─────────────────────────────────────────────
  //
  // POST /api/explain wraps the user's SQL in the dialect-specific EXPLAIN
  // command (EXPLAIN (FORMAT JSON) on Postgres, EXPLAIN FORMAT=JSON on MySQL,
  // EXPLAIN QUERY PLAN on SQLite, SET SHOWPLAN_XML on MSSQL) and returns a
  // dialect-agnostic { type, table, cost, rows, children[] } tree the UI
  // renders as an indented tree with cost-coloured bars.
  //
  // The router needs `dialect` (to dispatch the right command + parser) and
  // `permissionMode` (so EXPLAIN of a write/DDL statement is refused under
  // --readonly the same way a bare write would be).
  app.use(
    "/api/explain",
    createExplainRouter(db, config.dialect, config.permissionMode)
  );
}
