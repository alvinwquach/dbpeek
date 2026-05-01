// ===== FILE PURPOSE =====
// Query route factory — mounts two handlers onto an Express Router:
//
//   POST /api/query        Execute a SQL statement (or batch).
//   POST /api/query/cancel Kill the currently running query via a separate
//                          pool connection (the primary is blocked while the
//                          query executes).
//
// All execution mechanics live in sibling modules:
//   normalize.ts  — NormalizedResult, normalizeResult
//   errors.ts     — mapDatabaseError
//   execute.ts    — StatementResult, executeStatement
//   pid.ts        — getConnectionPid
//
// This file owns only the HTTP layer: request parsing, permission enforcement,
// statement splitting, looping, and response shaping.
//
// ===== REQUEST / RESPONSE CONTRACT =====
//
//   POST /api/query
//     Body: { "sql": string, "params"?: unknown[] | Record<string, string> }
//
//     `params` is OPTIONAL. When absent the query runs as a plain statement.
//     When present it is forwarded verbatim to knex.raw(sql, params) for safe
//     driver-level substitution. Params are only honoured on single-statement
//     input — see executeStatement's JSDoc for why multi-statement omits them.
//
//     WHY knex.raw(sql, params) instead of string interpolation:
//       The driver escapes each value according to its runtime type and the
//       target column type. String interpolation would require us to replicate
//       every driver's escaping rules — a maintenance burden and a likely
//       injection surface.
//
//   Success (200):
//     { columns, rows, rowCount, executionTime }          ← single statement
//     { statements, statementCount, totalExecutionTime,   ← multi-statement
//       columns, rows, rowCount, executionTime }
//
//   Error (400): { error }
//   Error (403): { error }  ← permission denied
//
//   POST /api/query/cancel
//     No body required.
//     Success (200): { cancelled: true }
//                  | { cancelled: false, reason: string }
//
// ===== CANCEL ARCHITECTURE =====
//
//   activePid is a closure variable that tracks the PID of the currently
//   running query. The lifecycle is:
//
//     1. POST /api/query arrives.
//     2. Acquire a pinned connection from the pool (acquireConnection).
//     3. Run getConnectionPid() on that connection → set activePid.
//     4. Run the user's SQL on the same pinned connection.
//     5. POST /api/query/cancel arrives (concurrently from the client).
//     6. The cancel handler reads activePid and issues the kill command on a
//        DIFFERENT pool connection (db.raw() picks any free one).
//     7. The database interrupts the running query on the pinned connection.
//     8. The primary request's await rejects; the finally block clears activePid
//        and returns the connection to the pool.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../../db.js";
import type { Dialect, PermissionMode } from "../../../types/connection.js";
import { validateQuery, splitStatements } from "../../permissions.js";
import { mapDatabaseError } from "./errors.js";
import { executeStatement, type StatementResult } from "./execute.js";
import { getConnectionPid } from "./pid.js";

// ===== ROUTE FACTORY =====

/**
 * Builds the Express Router that serves POST /api/query and POST /api/query/cancel.
 *
 * WHY a factory function rather than a module-level Router:
 *   The router needs access to `db`, `mode`, and `dialect`, which are determined
 *   at CLI startup. A factory captures them in a closure so the same module can
 *   be loaded in tests (with a mock Knex and a different mode) without any
 *   module-level state to reset between test cases.
 *
 * @param db      - Knex instance to execute SQL through. The router borrows it
 *                  for the duration of each request; it does not own the lifecycle.
 * @param mode    - Permission mode set at CLI launch. NEVER read from the request.
 * @param dialect - Active database dialect; used by the cancel endpoint to choose
 *                  the correct kill command, and by getConnectionPid() to choose
 *                  the correct PID query.
 */
export function createQueryRouter(
  db: Knex,
  mode: PermissionMode,
  dialect: Dialect
): Router {
  const router = Router();

  // ── Active query PID ───────────────────────────────────────────────────────
  // Stores the server-side process/session ID of the query running on the pinned
  // connection. The cancel endpoint reads this to target the right backend.
  // Null means no query is in flight.
  //
  // WHY a closure variable (not a module global):
  //   Single-user tool — at most one query runs at a time. A closure variable
  //   shared between these two handlers is the simplest correct scope. A module
  //   global would leak state between test cases that each call createQueryRouter.
  let activePid: number | null = null;

  // ===== POST / — EXECUTE QUERY =====

  router.post("/", async (req: Request, res: Response) => {
    // ── Step 1: validate the request body ─────────────────────────────────
    // We accept { sql: string, params?: unknown[] | Record<string, unknown> }.
    // Strict validation here means downstream code never handles undefined SQL.
    const body = req.body as { sql?: unknown; params?: unknown } | undefined;
    const sql = body?.sql;

    if (typeof sql !== "string" || sql.trim() === "") {
      return res.status(400).json({
        error: 'Request body must contain a non-empty "sql" string.',
      });
    }

    // Validate optional params. Accept an array or a plain non-null object.
    // Null or primitives are rejected because knex.raw() would throw with an
    // opaque error — a 400 here gives the caller a clearer signal.
    const rawParams = body?.params;
    let params: Knex.RawBinding[] | Knex.ValueDict | undefined;
    if (rawParams !== undefined) {
      if (Array.isArray(rawParams)) {
        // JSON arrays contain strings, numbers, booleans, and nulls — all valid
        // RawBinding values. Trust the driver to coerce as needed.
        params = rawParams as Knex.RawBinding[];
      } else if (typeof rawParams === "object" && rawParams !== null) {
        params = rawParams as Knex.ValueDict;
      } else {
        return res.status(400).json({
          error:
            '"params" must be an array (positional $N bindings) or a plain object (named :name bindings).',
        });
      }
    }

    // ── Step 2: enforce the permission mode ───────────────────────────────
    // All-or-nothing: if ANY statement in a multi-statement batch is forbidden,
    // none execute. This is the security boundary — DO NOT add a bypass here.
    const validation = validateQuery(sql, mode);
    if (!validation.allowed) {
      return res.status(403).json({ error: validation.reason });
    }

    // ── Step 3: split into statements ─────────────────────────────────────
    // Same tokenizer as validateQuery so the execution split cannot diverge
    // from the security split. Divergence would be a security bug.
    const statements = splitStatements(sql);

    if (statements.length === 0) {
      // "Comments only" input (e.g. "-- foo\n") survives the trim() check
      // but yields zero executable statements.
      return res.status(400).json({
        error: 'Request body must contain a non-empty "sql" string.',
      });
    }

    // ── Step 4: acquire a pinned connection for PID tracking ──────────────
    // The PID query and the user query must run on the SAME socket so that
    // activePid matches the executing backend. acquireConnection() checks out
    // one connection; releaseConnection() returns it in the finally block.
    //
    // WHY `as any` on db.client:
    //   Knex exposes acquireConnection/releaseConnection internally but they are
    //   not in the public TypeScript types. The cast is safe: these methods have
    //   existed in Knex since v0.x and tarn.js (the pool) relies on them.
    //
    // WHY fall back to unpinned execution on failure:
    //   Pool exhausted or driver error → the user's query should still run. The
    //   only consequence is that cancel won't work for this request. Refusing the
    //   entire query because of a PID-tracking side-effect would be the wrong trade.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const knexClient = (db as any).client as {
      acquireConnection: () => Promise<unknown>;
      releaseConnection: (conn: unknown) => void;
    };

    let rawConn: unknown;
    try {
      rawConn = await knexClient.acquireConnection();
    } catch {
      rawConn = undefined;
    }

    try {
      // Best-effort PID acquisition. If it fails, activePid stays null and
      // cancel becomes a no-op for this request — the query still runs.
      if (rawConn !== undefined) {
        try {
          activePid = await getConnectionPid(db, dialect, rawConn);
        } catch {
          activePid = null;
        }
      }

      // ── Step 5: single-statement fast path ────────────────────────────
      // Returns the historic { columns, rows, rowCount, executionTime } envelope
      // unchanged, preserving backward compatibility with the client and tests.
      //
      // params is forwarded HERE and ONLY here. The multi-statement loop does
      // not receive params because $N placeholders are positional and scoped to
      // one statement; binding an array to a batch is ambiguous and drivers
      // reject it. See executeStatement's JSDoc for the full rationale.
      if (statements.length === 1) {
        const onlyStatement = statements[0]!;
        try {
          const result = await executeStatement(
            db,
            onlyStatement,
            params,
            rawConn
          );
          return res.status(200).json({
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
          });
        } catch (err: unknown) {
          // Database-level failure (permission check passed; body was validated).
          // 400 rather than 500 because the typical cause is a user query mistake.
          return res.status(400).json({ error: mapDatabaseError(err) });
        }
      }

      // ── Step 6: multi-statement sequential execution ───────────────────
      // Execute in submission order. Halt on the first failure — if statement 2
      // fails because a table is missing, statement 3 will likely fail in a more
      // confusing way. One actionable error is better than a cascade.
      const completed: StatementResult[] = [];
      const statementCount = statements.length;
      const batchStart = process.hrtime.bigint();

      for (let i = 0; i < statements.length; i++) {
        const statementIndex = i + 1; // 1-based for human-readable messages.
        const currentSql = statements[i]!;
        try {
          // params intentionally not forwarded — see step 5 comment above.
          const result = await executeStatement(
            db,
            currentSql,
            undefined,
            rawConn
          );
          completed.push({ statementIndex, ...result });
          // eslint-disable-next-line no-console
          console.log(`Statement ${statementIndex}/${statementCount} complete...`);
        } catch (err: unknown) {
          // Surface both the 1-based index and the structured field so human
          // readers and programmatic clients can both recover the position.
          // `completed` carries results for statements 1..N-1 so the UI can
          // show partial output rather than discarding it.
          return res.status(400).json({
            error: `Statement ${statementIndex}/${statementCount} failed: ${mapDatabaseError(err)}`,
            statementIndex,
            statementCount,
            completed,
          });
        }
      }

      const batchEnd = process.hrtime.bigint();
      const totalExecutionTime = Number(batchEnd - batchStart) / 1_000_000;

      // ── Step 7: aggregate multi-statement response ─────────────────────
      // Expose both the `statements` array and a top-level mirror of the LAST
      // statement. The mirror lets clients that don't yet understand multi-
      // statement responses render something sensible without code changes.
      const last = completed[completed.length - 1]!;
      return res.status(200).json({
        statements: completed,
        statementCount,
        totalExecutionTime,
        columns: last.columns,
        rows: last.rows,
        rowCount: last.rowCount,
        executionTime: last.executionTime,
      });
    } finally {
      // Always clear PID and return the connection to the pool, whether the
      // query succeeded, errored, or was killed by the cancel endpoint.
      activePid = null;
      if (rawConn !== undefined) {
        knexClient.releaseConnection(rawConn);
      }
    }
  });

  // ===== POST /cancel — KILL THE RUNNING QUERY =====

  /**
   * Kills the query currently executing on the primary connection.
   *
   * Uses a SEPARATE pool connection — the primary is blocked inside the driver
   * while the query runs, so the kill must go through a different socket.
   *
   * HOW the client + server coordinate:
   *   1. Client calls AbortController.abort() → fetch throws AbortError.
   *   2. Client simultaneously fires POST /api/query/cancel (fire-and-forget).
   *   3. This handler reads activePid and sends the kill on a free pool connection.
   *   4. The database interrupts the pinned connection's running query.
   *   5. The primary request's await rejects; its finally block clears activePid.
   *
   * WHY 200 even when no active query:
   *   The cancel request is inherently racy — the query might finish between the
   *   user clicking Cancel and the request arriving. 4xx would force unnecessary
   *   error handling for a benign race. { cancelled: false, reason } carries
   *   the detail without implying something went wrong.
   */
  router.post("/cancel", async (_req: Request, res: Response) => {
    if (dialect === "sqlite") {
      return res.status(200).json({
        cancelled: false,
        reason: "SQLite does not support query cancellation",
      });
    }

    if (activePid === null) {
      return res.status(200).json({
        cancelled: false,
        reason: "No active query",
      });
    }

    const pid = activePid;

    try {
      switch (dialect) {
        case "postgres":
          // pg_cancel_backend() sends SIGINT to the backend process — interrupts
          // the query but keeps the connection alive.
          await db.raw("SELECT pg_cancel_backend(?)", [pid]);
          break;

        case "mysql":
          // KILL QUERY terminates only the running statement, not the session.
          // The ID is a safe integer from CONNECTION_ID(); direct interpolation
          // is fine because MySQL does not support placeholders in KILL.
          await db.raw(`KILL QUERY ${pid}`);
          break;

        case "mssql":
          // KILL <spid> terminates the session on SQL Server.
          // SPID is a safe integer from @@SPID.
          await db.raw(`KILL ${pid}`);
          break;
      }

      return res.status(200).json({ cancelled: true });
    } catch (err: unknown) {
      // Kill command failed — PID already gone, or permissions issue.
      // 200 rather than 5xx: the query may have completed by the time the kill
      // arrived, which is a benign race condition not a server error.
      const reason = err instanceof Error ? err.message : String(err);
      return res.status(200).json({ cancelled: false, reason });
    }
  });

  return router;
}
