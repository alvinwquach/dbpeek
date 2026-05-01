// ===== FILE PURPOSE =====
// Statement executor — runs a single SQL statement through Knex, optionally
// with parameter bindings and/or a pinned pool connection, and returns a
// timed, normalized result.
//
// WHY isolated here:
//   The single-statement and multi-statement route paths both need the same
//   execute-and-time logic. Isolating it eliminates "single is timed differently
//   than multi" bugs and keeps the route factory (index.ts) focused on HTTP
//   concerns rather than execution mechanics.

import type { Knex } from "../../db.js";
import { normalizeResult, type NormalizedResult } from "./normalize.js";

// ===== EXPORTED TYPES =====

/**
 * The shape returned for ONE statement inside a multi-statement batch.
 *
 * WHY a dedicated type rather than reusing NormalizedResult:
 *   A multi-statement response carries metadata (`statementIndex`) that does
 *   NOT belong on a single-statement envelope. Splitting the types makes the
 *   API contract explicit: NormalizedResult is a raw shape; StatementResult is
 *   "that, plus where it sat in the batch and how long it took."
 *
 * WHY statementIndex is 1-based:
 *   The number is shown directly to the user ("Statement 2/4 failed"). 1-based
 *   indexing matches how humans count and lines up with editor line numbers.
 *   The internal arrays remain 0-based; we only translate at the API boundary.
 */
export interface StatementResult extends NormalizedResult {
  /** 1-based position of this statement in the submitted batch. */
  statementIndex: number;
  /** Wall-clock milliseconds for THIS statement only (not the batch total). */
  executionTime: number;
}

// ===== EXECUTION =====

/**
 * Executes ONE SQL statement and returns a timed, normalized result.
 *
 * WHAT it does:
 *   Issues `db.raw(sql[, params])`, measures the round-trip with hrtime,
 *   normalizes the dialect-specific result shape, and returns a
 *   { columns, rows, rowCount, executionTime } bundle.
 *
 * HOW it works:
 *   1. Snapshot start time as BigInt nanoseconds (hrtime; immune to NTP skew).
 *   2. Build the raw query (with or without params), optionally pinning it to
 *      a specific pool connection via `.connection(rawConn)`.
 *   3. Await the driver call. Any error propagates to the caller for mapping.
 *   4. Snapshot end time and compute (end - start) / 1e6 for milliseconds.
 *   5. Pass the raw driver result to normalizeResult() for canonicalization.
 *
 * @param db      - The Knex instance to execute through.
 * @param sql     - A SINGLE SQL statement. The caller is responsible for
 *                  splitting multi-statement input; this function does not validate.
 * @param params  - Optional positional array or named-binding object forwarded
 *                  verbatim to knex.raw() for safe value substitution.
 *                  WHY params is only valid for single-statement calls:
 *                    $N placeholders are positional and scoped to one statement.
 *                    Binding an array to a multi-statement batch is ambiguous —
 *                    which statement owns $1? Drivers reject it anyway. The
 *                    route handler passes params only on the single-statement
 *                    fast path.
 *                  WHY we avoid db.raw(sql, undefined):
 *                    Some driver versions throw "bindings must be an array or
 *                    object" when undefined is passed explicitly. We branch to
 *                    avoid passing undefined at all.
 * @param rawConn - Optional pinned connection acquired via acquireConnection().
 *                  When provided, the query runs on EXACTLY this socket rather
 *                  than a pool-assigned one. Required for cancel support: the
 *                  PID recorded in activePid must match the executing connection,
 *                  and both are on rawConn.
 *                  WHY the `as { connection: ... }` cast:
 *                    Knex's public TypeScript types do not expose the runtime
 *                    `.connection()` method on Raw builders. The cast is safe:
 *                    we only invoke it when rawConn came from acquireConnection().
 */
export async function executeStatement(
  db: Knex,
  sql: string,
  params?: Knex.RawBinding[] | Knex.ValueDict,
  rawConn?: unknown
): Promise<NormalizedResult & { executionTime: number }> {
  const start = process.hrtime.bigint();

  // Build the raw query with or without params. We branch rather than passing
  // undefined to avoid the "bindings must be an array or object" driver error.
  const rawQuery =
    params !== undefined ? db.raw(sql, params) : db.raw(sql);

  // Pin to a specific connection when one is provided (cancel support).
  const rawResult =
    rawConn !== undefined
      ? await (
          rawQuery as unknown as {
            connection: (c: unknown) => Promise<unknown>;
          }
        ).connection(rawConn)
      : await rawQuery;

  const end = process.hrtime.bigint();
  // BigInt → number: nanoseconds / 1e6 = milliseconds.
  // Lossless for any duration under ~104 days (trivially covers any real query).
  const executionTime = Number(end - start) / 1_000_000;
  const normalized = normalizeResult(rawResult);
  return { ...normalized, executionTime };
}
