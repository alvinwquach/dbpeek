// ===== FILE PURPOSE =====
// Connection PID helpers — queries the server-side process/session ID for a
// pinned pool connection so the cancel endpoint knows which backend to interrupt.
//
// WHY isolated here:
//   PID acquisition is dialect-specific, testable in isolation, and has no
//   dependency on the route shape or the result-normalization pipeline. Keeping
//   it in its own file makes the dialect dispatch visible at a glance and makes
//   it easy to add a new dialect without reading the full route factory.

import type { Knex } from "../../db.js";
import type { Dialect } from "../../../types/connection.js";

// ===== PID ACQUISITION =====

/**
 * Queries the backend PID (or connection ID / SPID) on a pinned connection.
 *
 * WHY this must run on the pinned connection (not a fresh db.raw()):
 *   Each connection in the pool has a distinct backend PID. If we queried the
 *   PID on one connection and then ran the user SQL on a different one (which
 *   the pool is free to do), the stored PID would point at the wrong backend
 *   and the cancel would be a no-op — or worse, interrupt an unrelated query.
 *
 * DIALECT MAP:
 *   Postgres → SELECT pg_backend_pid() AS pid
 *              Cancel via: SELECT pg_cancel_backend(pid)
 *
 *   MySQL    → SELECT CONNECTION_ID() AS pid
 *              Cancel via: KILL QUERY <id>
 *
 *   MSSQL    → SELECT @@SPID AS pid
 *              Cancel via: KILL <spid>
 *
 *   SQLite   → Not supported (synchronous in-process; no inter-process cancel).
 *              Returns null; the cancel endpoint fast-returns for sqlite.
 *
 * @param db      - Knex instance used to construct and run the PID query.
 * @param dialect - Active dialect, selects the correct SQL to run.
 * @param rawConn - The pinned connection that will also execute the user query.
 * @returns       The numeric PID/ID, or null for SQLite.
 */
export async function getConnectionPid(
  db: Knex,
  dialect: Dialect,
  rawConn: unknown
): Promise<number | null> {
  // Helper: run a PID query on the pinned connection.
  // WHY the cast: .connection() exists on Knex Raw builders at runtime but is
  // not in the public TypeScript types. The cast is narrow and safe — we only
  // call it here, and rawConn always came from client.acquireConnection().
  const runOn = (pidSql: string) =>
    (
      db.raw(pidSql) as unknown as {
        connection: (c: unknown) => Promise<unknown>;
      }
    ).connection(rawConn);

  switch (dialect) {
    case "postgres": {
      // pg_backend_pid() returns the PID of the current backend process.
      // pg_cancel_backend(pid) sends SIGINT to that process, interrupting
      // the current query without terminating the connection (unlike
      // pg_terminate_backend, which closes the session entirely).
      const result = (await runOn("SELECT pg_backend_pid() AS pid")) as {
        rows: { pid: number }[];
      };
      return result.rows[0]?.pid ?? null;
    }

    case "mysql": {
      // CONNECTION_ID() returns the server thread ID for this connection.
      // KILL QUERY <id> stops only the running statement on that thread,
      // leaving the connection alive for subsequent queries.
      const result = (await runOn("SELECT CONNECTION_ID() AS pid")) as [
        { pid: number }[],
        unknown[],
      ];
      return result[0]?.[0]?.pid ?? null;
    }

    case "mssql": {
      // @@SPID is the server process ID for the current session.
      // KILL <spid> terminates the entire session — SQL Server has no
      // per-statement cancel primitive without more complex infrastructure
      // (e.g. SET LOCK_TIMEOUT or application-level cancel tokens).
      const result = (await runOn("SELECT @@SPID AS pid")) as {
        pid: number;
      }[];
      return result[0]?.pid ?? null;
    }

    case "sqlite":
      // SQLite is synchronous and in-process. There is no server-side PID
      // and no mechanism to interrupt execution from a separate thread.
      return null;
  }
}
