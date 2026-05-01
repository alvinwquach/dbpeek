// ===== FILE PURPOSE =====
// Schema introspection routes — exposes metadata about the connected database
// so the UI can render a tree of tables and columns and use it to power
// SQL autocomplete.
//
//   GET /api/schema                              → tables + estimated row counts
//   GET /api/schema/:table                       → columns + PK/FK/index metadata
//   GET /api/schema/:table/:column/stats         → aggregate stats for one column
//                                                  (distinct, null %, min/max/avg
//                                                  for numeric, top values for
//                                                  non-numeric)
//
// ===== WHY THIS FILE EXISTS AS A SEPARATE MODULE =====
//
// Schema introspection is the ONE part of the application where dialect
// portability completely breaks down. Each of the four supported engines
// (Postgres, MySQL, SQLite, MSSQL) stores its own metadata in a different
// place, with a different schema, returned in a different shape:
//
//   - Postgres exposes catalogs (pg_class, pg_constraint, pg_index, ...).
//   - MySQL exposes the SQL-standard information_schema.* views.
//   - SQLite has no catalog tables — only PRAGMA statements that return
//     a fixed-shape result set per call (PRAGMA table_info, PRAGMA
//     foreign_key_list, PRAGMA index_list).
//   - MSSQL has its own sys.* catalog views (sys.tables, sys.columns, ...).
//
// Bundling all four implementations into the query/status route files
// would drown the security-critical bits in dialect plumbing. Keeping
// schema in its own module:
//   1. Makes the dialect-specific quirks easy to find and audit.
//   2. Lets the query route stay focused on the security boundary.
//   3. Keeps the test surface for each route file small and focused.
//
// ===== WHY GETTING THIS RIGHT MATTERS =====
//
// The output of these endpoints feeds the SQL autocomplete in CodeMirror.
// A typo in a table or column name returned here means the editor will
// suggest names that DON'T EXIST in the user's database — the worst kind
// of silent failure for a developer tool. Each dialect's query is therefore
// pinned to documented system catalogs (cited in the comment above each
// implementation) rather than driver shortcuts that may change.
//
// ===== RESPONSE CONTRACT =====
//
//   GET /api/schema (200):
//     {
//       "tables": [
//         { "name": string, "rowCount": number }   // rowCount is an estimate
//                                                  // (may be 0 if statistics
//                                                  // have never been gathered)
//       ]
//     }
//
//   GET /api/schema/:table (200):
//     {
//       "columns": [
//         {
//           "name":          string,
//           "type":          string,         // dialect-native type label
//           "nullable":      boolean,
//           "defaultValue":  string | null,  // raw default expression
//           "isPrimaryKey":  boolean,
//           "foreignKey":    { "table": string, "column": string } | null,
//           "isIndexed":     boolean
//         }
//       ]
//     }
//
//   GET /api/schema/:table (404):
//     { "error": "Table not found: <name>" }
//
//   GET /api/schema/:table (400):
//     { "error": <database error message> }
//
// ===== WHY :table IS WHITELISTED, NOT BIND-PARAMETERIZED =====
//
// SQLite's PRAGMA statements (table_info, foreign_key_list, index_list,
// index_info) cannot accept bind parameters for the table name — the
// PRAGMA grammar requires a literal identifier or quoted string at parse
// time. Postgres, MySQL, and MSSQL CAN bind the name, but we use the same
// whitelisting strategy in all four for consistency and defense-in-depth:
//
//   1. Call listTables() to get the canonical list of tables in the
//      database.
//   2. Reject the request with 404 if `:table` is not in that list.
//   3. Only then call describeTable(), passing the validated name.
//
// This guarantees `:table` is always a real, server-confirmed identifier
// before it reaches any dialect's introspection query — closing the door
// on PRAGMA injection in SQLite while keeping the four implementations
// uniform.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../../db.js";
import type { ConnectionConfig } from "../../../types/connection.js";
import { HANDLERS } from "./handlers/index.js";
import { computeColumnStats, isNumericType } from "./utils.js";

// ===== ROUTE FACTORY =====

/**
 * Builds the Express Router that serves the schema introspection endpoints.
 *
 * WHY a factory function rather than a module-level Router:
 *   The router needs `config.dialect` (to dispatch into HANDLERS) and `db`
 *   (to run the queries) — both determined at CLI startup, not at module
 *   import. A factory captures them in a closure so tests can pass a mock
 *   ConnectionConfig and a mock Knex without any module-level state to
 *   reset between tests. Mirrors the pattern in createQueryRouter and
 *   createStatusRouter.
 *
 * @param config - The resolved ConnectionConfig. Only `dialect` is used by
 *   this route; the rest is ignored.
 * @param db - Knex instance to execute introspection queries against.
 */
export function createSchemaRouter(
  config: ConnectionConfig,
  db: Knex
): Router {
  const router = Router();
  const handler = HANDLERS[config.dialect];

  // ── GET /api/schema ─────────────────────────────────────────────────────
  // Lists all tables with estimated row counts.
  router.get("/", async (_req: Request, res: Response): Promise<void> => {
    try {
      const tables = await handler.listTables(db);
      res.status(200).json({ tables });
    } catch (err: unknown) {
      // Any error here is a database/connectivity problem (the route has no
      // user input to validate). 500 is correct: a healthy database with a
      // valid connection should always return a table list.
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── GET /api/schema/:table ──────────────────────────────────────────────
  // Describes one table's columns. Whitelists `:table` against listTables()
  // before invoking describeTable — see the file header for the security
  // rationale.
  router.get(
    "/:table",
    async (req: Request, res: Response): Promise<void> => {
      // WHY the explicit narrowing instead of trusting req.params.table to
      // be a string:
      //   With `noUncheckedIndexedAccess` enabled in tsconfig, Express's
      //   req.params is typed as Record<string, string | undefined>. The
      //   route pattern guarantees `:table` is set at runtime, but
      //   TypeScript can't see that. A defensive empty-string check costs
      //   nothing and keeps the type clean for the downstream calls.
      const tableName = req.params.table;
      if (!tableName) {
        res.status(400).json({ error: "Missing table name in URL." });
        return;
      }

      try {
        // Whitelist check: the requested table MUST appear in the result of
        // listTables(). This guards against PRAGMA injection in SQLite and
        // is the canonical 404 trigger for the other dialects too.
        const tables = await handler.listTables(db);
        const exists = tables.some((t) => t.name === tableName);
        if (!exists) {
          res.status(404).json({ error: `Table not found: ${tableName}` });
          return;
        }

        const columns = await handler.describeTable(db, tableName);
        res.status(200).json({ columns });
      } catch (err: unknown) {
        // Errors past the whitelist check are database failures. 400 is the
        // right code (mirrors the query route) — a malformed table name that
        // somehow passed the whitelist would be a client bug, not a server
        // bug, and surfacing the raw driver message helps the user diagnose.
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    }
  );

  // ── GET /api/schema/:table/:column/stats ────────────────────────────────
  //
  // Returns aggregate statistics for one column (the ColumnStats payload
  // documented above the type definition). Behavior summary:
  //
  //   - Numeric column     → { distinct, nullPct, min, max, avg }
  //   - Non-numeric column → { distinct, nullPct, topValues: [{ value, count }] }
  //
  // SECURITY: this route runs SQL whose identifiers come from the URL. We
  // protect against injection by:
  //   1. Whitelisting `:table` against listTables() (same as /:table).
  //   2. Whitelisting `:column` against describeTable() — only after step 1
  //      passes. The column name reaching the aggregate query has been
  //      confirmed to exist in the database.
  //   3. Passing both names through knex's `??` placeholder so they are
  //      ALSO dialect-correctly quoted at the SQL level. This is
  //      defense-in-depth — the whitelist makes injection impossible; the
  //      `??` makes it impossible for a column literally named "select"
  //      (or one with embedded punctuation) to break the SQL syntactically.
  router.get(
    "/:table/:column/stats",
    async (req: Request, res: Response): Promise<void> => {
      // Same noUncheckedIndexedAccess defensive narrowing pattern as /:table.
      // Both params are guaranteed non-null at runtime by the route pattern,
      // but TypeScript types them as `string | undefined`.
      const tableName = req.params.table;
      const columnName = req.params.column;
      if (!tableName || !columnName) {
        res
          .status(400)
          .json({ error: "Missing table or column name in URL." });
        return;
      }

      try {
        // ── Step 1: table whitelist ─────────────────────────────────────
        // If the table does not exist, return 404 BEFORE inspecting columns.
        // This matches the error message format used by /:table so the client
        // can display the same "Table not found: X" copy in either case.
        const tables = await handler.listTables(db);
        if (!tables.some((t) => t.name === tableName)) {
          res
            .status(404)
            .json({ error: `Table not found: ${tableName}` });
          return;
        }

        // ── Step 2: column whitelist + type lookup ──────────────────────
        // We need the column's native type label anyway (to decide numeric
        // vs. non-numeric), so describeTable() does double duty here:
        // whitelist check AND type detection in a single round-trip.
        const columns = await handler.describeTable(db, tableName);
        const colInfo = columns.find((c) => c.name === columnName);
        if (!colInfo) {
          res
            .status(404)
            .json({ error: `Column not found: ${columnName}` });
          return;
        }

        // ── Step 3: compute and return stats ────────────────────────────
        const numeric = isNumericType(colInfo.type);
        const stats = await computeColumnStats(
          db,
          config.dialect,
          tableName,
          columnName,
          numeric
        );
        res.status(200).json(stats);
      } catch (err: unknown) {
        // 400 mirrors the /:table error path: errors that survive the two
        // whitelist checks are database-level failures (timeout, dropped
        // connection, etc.) and surfacing the raw message helps debugging.
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    }
  );

  return router;
}
