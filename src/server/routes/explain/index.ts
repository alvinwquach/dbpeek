// ===== FILE PURPOSE =====
// POST /api/explain — runs the dialect's EXPLAIN command for a user-supplied
// SQL string and returns a normalized plan tree.
//
// This file owns ONLY the route wiring: request validation, permission
// enforcement, dialect dispatch, and response shaping. The per-dialect
// EXPLAIN command syntax and result parsing live in ./parsers/<dialect>.ts —
// keeping this file focused on the security/HTTP contract while each parser
// owns one engine's quirks.
//
// ===== REQUEST / RESPONSE CONTRACT =====
//
//   Request:
//     POST /api/explain
//     Content-Type: application/json
//     Body: { "sql": string }
//
//   Success (200):
//     {
//       "plan": ExplainNode,    // root of the normalized tree
//       "raw":  string          // pretty-printed dialect-native plan,
//                               // shown in the "raw" toggle of the UI
//     }
//
//   Error (400):
//     { "error": "EXPLAIN failed: <driver message>" }
//
//   Permission denied (403):
//     { "error": "INSERT not allowed in read-only mode. Start with --write to enable." }
//
// ===== WHY A SEPARATE ROUTE FROM /api/query =====
//
//   /api/query already runs arbitrary SQL through the permission filter — but
//   EXPLAIN has its own per-dialect command syntax (SET SHOWPLAN_XML on MSSQL,
//   `EXPLAIN (FORMAT JSON)` on Postgres, etc.) and returns a non-tabular
//   result that the row-based normalizer in routes/query.ts cannot interpret.
//   Putting EXPLAIN in its own module keeps the query path's normalizer
//   focused on row results, and lets the EXPLAIN parsers own the dialect
//   dispatch + tree normalization without polluting the security-critical
//   query handler.
//
// ===== SECURITY NOTES =====
//
//   - The user-supplied SQL is wrapped in `EXPLAIN ...` (or the dialect's
//     equivalent) — it is never executed bare. EXPLAIN itself is a read-only
//     planner inspection on Postgres / MySQL / SQLite. (Postgres EXPLAIN
//     ANALYZE would actually execute the query, but we DO NOT use ANALYZE.)
//   - We still pass the SQL through validateQuery() against the active
//     PermissionMode so a user in --readonly cannot use EXPLAIN to issue an
//     INSERT/UPDATE/DELETE. The validator inspects the leading keyword of
//     each statement; an EXPLAIN of a SELECT is a SELECT-prefix EXPLAIN,
//     which the validator already permits in read-only mode.
//   - We refuse multi-statement input. EXPLAIN of a multi-statement batch
//     is ambiguous (which statement?) and would also expand the attack
//     surface for the per-dialect command wrappers.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../../db.js";
import type { Dialect, PermissionMode } from "../../../types/connection.js";
import { validateQuery } from "../../permissions.js";
import { PARSERS } from "./parsers/index.js";
import type { ExplainResponse } from "./types.js";

// Re-export the public types so callers (tests, the shared types layer) can
// import them from the route module entry point rather than reaching into
// ./types.js directly. Mirrors the re-export of `Knex` from src/server/db.ts.
export type { ExplainNode, ExplainResponse } from "./types.js";

// ===== ROUTE FACTORY =====

/**
 * Builds the Express Router that serves POST /api/explain.
 *
 * Mirrors the createQueryRouter factory pattern: db, dialect, and mode are
 * captured in a closure so tests can pass mocks without module-level state.
 *
 * @param db      - Knex instance to execute the EXPLAIN through.
 * @param dialect - Active dialect (selects the per-dialect parser from PARSERS).
 * @param mode    - Permission mode set at CLI launch. EXPLAIN of write/DDL
 *                  statements is rejected when the underlying statement type
 *                  isn't permitted in the active mode.
 */
export function createExplainRouter(
  db: Knex,
  dialect: Dialect,
  mode: PermissionMode
): Router {
  const router = Router();
  const parser = PARSERS[dialect];

  router.post("/", async (req: Request, res: Response): Promise<void> => {
    // ── Step 1: validate request body ──────────────────────────────────────
    const body = req.body as { sql?: unknown } | undefined;
    const sql = body?.sql;
    if (typeof sql !== "string" || sql.trim() === "") {
      res.status(400).json({
        error: 'Request body must contain a non-empty "sql" string.',
      });
      return;
    }

    // ── Step 2: enforce permission mode ────────────────────────────────────
    // EXPLAIN of a SELECT is a SELECT-prefix statement; validateQuery already
    // permits it in any mode. EXPLAIN of an INSERT/UPDATE in --readonly is
    // refused here because the underlying statement type would not be allowed
    // to execute. Defensive: even if EXPLAIN doesn't actually run the body on
    // most dialects, we follow the same policy across the board.
    const validation = validateQuery(sql, mode);
    if (!validation.allowed) {
      res.status(403).json({ error: validation.reason });
      return;
    }

    // ── Step 3: refuse multi-statement input ───────────────────────────────
    // EXPLAIN of "SELECT 1; SELECT 2" is ambiguous (which one?) and the per-
    // dialect commands above are wrapped around a single statement. We keep
    // it simple: one statement per request. A single trailing ";" is tolerated
    // because it is so common in pasted SQL that requiring its absence would
    // be a footgun.
    const trimmed = sql.trim().replace(/;+\s*$/, "");
    if (trimmed.includes(";")) {
      res.status(400).json({
        error: "EXPLAIN supports a single statement per request.",
      });
      return;
    }

    // ── Step 4: run the per-dialect EXPLAIN and normalize ──────────────────
    try {
      const { raw, parsed } = await parser.run(db, trimmed);

      // The raw payload is pretty-printed JSON for the UI's "raw" toggle. For
      // MSSQL we keep the XML string verbatim (already a string).
      const rawPretty =
        typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);

      const payload: ExplainResponse = { plan: parsed, raw: rawPretty };
      res.status(200).json(payload);
    } catch (err: unknown) {
      // Any failure here is an EXPLAIN-time error (bad SQL, missing table,
      // unsupported statement type). 400 mirrors the /api/query convention:
      // user-authored SQL problems are client errors, not 500s.
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: `EXPLAIN failed: ${message}` });
    }
  });

  return router;
}
