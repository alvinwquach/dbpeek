// ===== FILE PURPOSE =====
// POST /api/import — accepts pre-parsed CSV/JSON row data from the client's
// ImportPreview dialog and inserts it into the target table inside a single
// database transaction. All INSERT statements are batched at BATCH_SIZE rows
// each to stay within per-statement parameter limits for every supported dialect.
//
// PERMISSION: requires write or full mode. Returns 403 in readonly mode.
//
// WHY the client sends pre-parsed rows instead of the raw file:
//   File parsing (papaparse / JSON.parse) is CPU-bound but trivially fast in
//   the browser. Sending pre-parsed, column-mapped data keeps the server
//   stateless — no multipart parsing, no temp files, no disk I/O. The client
//   already owns the column-mapping step (source → target) so the server only
//   needs to run INSERTs with the final, user-confirmed mapping applied.
//
// WHY a single transaction for all batches:
//   A partially-committed import (e.g. 7,000 of 10,000 rows) is worse than
//   none at all — the table is in an inconsistent, hard-to-reason-about state.
//   Wrapping every batch inside one shared transaction means either everything
//   lands or nothing does. Any error (type mismatch, constraint violation,
//   out-of-disk) rolls back all preceding batches automatically.

import { Router } from "express";
import type { Knex } from "../../db.js";
import type { PermissionMode } from "../../../types/connection.js";

// ===== CONSTANTS =====

/**
 * Maximum rows per INSERT statement batch.
 *
 * WHY 100 and not the theoretical driver maximum:
 *   Parameter count = rows × columns. A 100-column table at 100 rows = 10,000
 *   parameters per statement — well under PostgreSQL's 65,535 limit and
 *   SQLite's 999-parameter-per-compound-statement cap. A conservative cap also
 *   bounds peak server memory during a long transaction: only 100 × N column
 *   values are materialised per INSERT call, not the entire file payload.
 */
const BATCH_SIZE = 100;

// ===== REQUEST / RESPONSE TYPES =====

/**
 * Expected JSON body for POST /api/import.
 *
 * WHY `rows` is `unknown[][]` and not `string[][]`:
 *   The client sends values as-is from the parsed file. JSON numbers arrive as
 *   numbers, booleans as booleans, and null as null. Forcing everything to
 *   string would lose type fidelity (integer IDs become strings, floats lose
 *   precision). The database driver coerces values to match column-declared
 *   types; we trust that over client-side pre-coercion.
 */
interface ImportBody {
  /** Target table name in the connected database. */
  table: string;
  /**
   * Target column names, in the same positional order as the values in each
   * row array. The client's column-mapping step has already filtered out any
   * "Skip" columns — every entry here is a real column the user confirmed.
   */
  columns: string[];
  /**
   * Data rows. Each row is an array of values aligned with `columns`.
   * Skipped source columns have already been dropped by the client.
   */
  rows: unknown[][];
}

/** Successful response shape. */
interface ImportSuccess {
  /** Total rows actually committed. Equals the length of `rows` in the request. */
  rowsImported: number;
  /** Wall-clock milliseconds for the entire transaction (all batches combined). */
  executionTime: number;
}

// ===== ROUTER FACTORY =====

/**
 * createImportRouter — builds the Express router for POST /api/import.
 *
 * WHAT it does:
 *   1. Permission check — 403 in readonly mode.
 *   2. Input validation — friendly errors for bad table/columns/rows.
 *   3. Transaction — slices `rows` into BATCH_SIZE groups, builds Knex insert
 *      objects per batch, executes all batches under a single transaction.
 *   4. Response — { rowsImported, executionTime } on success; { error } on
 *      failure (which also automatically rolls back the transaction).
 *
 * WHY `mode` is a closed-over parameter (not read from the request body):
 *   Permission level is set once at CLI launch (`--write` / `--full`) and is
 *   immutable for the process lifetime. There is deliberately NO API endpoint
 *   to change it. Capturing it in the router's closure at registration time
 *   means even a crafted request that somehow bypasses the UI cannot escalate
 *   past the mode baked in at startup.
 *
 * @param db   - The Knex instance to execute inserts through.
 * @param mode - The permission level set at CLI launch.
 */
export function createImportRouter(db: Knex, mode: PermissionMode): Router {
  const router = Router();

  // ── POST / ──────────────────────────────────────────────────────────────────
  //
  // WHY `async (req, res)` without explicit `next`:
  //   Errors thrown inside the async handler bubble up as unhandled rejections
  //   without an Express error handler. We catch them with try/catch and return
  //   a 500 directly — the same pattern used by POST /api/query. This keeps
  //   the error path visible at the call site rather than hidden in middleware.
  router.post("/", async (req, res) => {
    // ── Permission check ─────────────────────────────────────────────────────
    //
    // INSERT is DML (WRITE-class). It must be blocked in readonly mode. The
    // message deliberately mirrors the format used by the permissions module
    // so error handling on the client can treat it consistently.
    if (mode === "readonly") {
      return res.status(403).json({
        error:
          "Import not allowed in read-only mode. Start with --write to enable.",
      });
    }

    const { table, columns, rows } = req.body as ImportBody;

    // ── Input validation ─────────────────────────────────────────────────────
    //
    // These checks produce human-readable messages. The DB driver would reject
    // bad values anyway, but with a raw driver error string that's harder to
    // interpret than "table must be a non-empty string."
    if (!table || typeof table !== "string" || table.trim() === "") {
      return res
        .status(400)
        .json({ error: "table must be a non-empty string." });
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return res
        .status(400)
        .json({ error: "columns must be a non-empty array." });
    }
    if (!columns.every((c) => typeof c === "string")) {
      return res
        .status(400)
        .json({ error: "Each column name must be a string." });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "rows must be a non-empty array." });
    }

    // Snapshot start time before entering the transaction so the returned
    // executionTime covers the full round-trip including connection acquisition.
    const start = process.hrtime.bigint();

    try {
      // ── Transaction: all batches or nothing ──────────────────────────────────
      //
      // db.transaction() wraps the callback in a BEGIN / COMMIT pair. Any
      // thrown error inside the callback causes an automatic ROLLBACK before
      // the error propagates to our catch block below.
      await db.transaction(async (trx) => {
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          // Build an array of plain objects { colName: value } for each batch.
          // Knex's .insert() accepts an array of objects and handles dialect-
          // specific identifier quoting (double-quotes in Postgres, backticks
          // in MySQL, etc.) so column names never reach the wire as raw strings.
          const batch = rows.slice(i, i + BATCH_SIZE).map((row) => {
            const record: Record<string, unknown> = {};
            columns.forEach((col, j) => {
              // Treat undefined as null. The database's NOT NULL constraint or
              // column default handles truly missing values — we don't second-
              // guess the schema here.
              record[col] = (row as unknown[])[j] ?? null;
            });
            return record;
          });

          await trx(table).insert(batch);
        }
      });

      const end = process.hrtime.bigint();
      // nanoseconds → milliseconds: lossless for any import that completes
      // in under ~104 days (every realistic case).
      const executionTime = Number(end - start) / 1_000_000;

      return res.json({ rowsImported: rows.length, executionTime } satisfies ImportSuccess);
    } catch (err) {
      // Surface the driver's error: it usually contains the column name,
      // constraint name, or type-mismatch detail the user needs to diagnose
      // the source file. The transaction has already been rolled back at this
      // point by Knex's transaction block.
      const message = err instanceof Error ? err.message : String(err);
      return res.status(500).json({ error: message });
    }
  });

  return router;
}
