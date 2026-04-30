// ===== FILE PURPOSE =====
// GET /api/status — exposes the current database connection metadata.
//
// This endpoint powers the status bar in the UI, showing which database the user
// is connected to and whether the connection is currently alive. The password is
// NEVER included in the response — it exists only in the Knex pool config in
// server memory, and is gone when the process exits.
//
// ===== REQUEST / RESPONSE CONTRACT =====
//
//   Request:
//     GET /api/status
//
//   Success (200):
//     {
//       "dialect":    "postgres" | "mysql" | "mssql" | "sqlite",
//       "host":       string,       // hostname or IP (empty string for sqlite)
//       "port":       number,       // TCP port (0 for sqlite)
//       "database":   string,       // database name or file path
//       "user":       string,       // login username (empty string for sqlite)
//       "mode":       "readonly" | "write" | "full",
//       "connected":  boolean       // true if SELECT 1 succeeds, false otherwise
//     }
//
// ===== WHY statusRoute RETURNS A ROUTER INSTEAD OF EXPORTING HANDLERS =====
//
//   The route file pattern is consistent with query.ts: a factory that captures
//   the `config` and `db` in a closure. This makes testing trivial — tests pass
//   a mock config and mock Knex without any module-level state to reset.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../db.js";
import type { ConnectionConfig } from "../../types/connection.js";

/**
 * Checks if the database connection is currently alive.
 *
 * STRATEGY:
 *   Issue a lightweight SELECT 1 query. If it succeeds, the pool has a working
 *   connection to the database and credentials are accepted. Any error (timeout,
 *   bad credentials, server down) returns false.
 *
 * WHY we catch all errors silently rather than logging:
 *   The status endpoint is called frequently (on every UI render). Logging every
 *   transient network hiccup would flood the logs. The caller (the UI) already
 *   displays "connected: false" to the user — additional logging is noise.
 *
 * @param db - The Knex instance to test.
 * @returns true if SELECT 1 succeeds, false otherwise.
 */
async function isConnected(db: Knex): Promise<boolean> {
  try {
    await db.raw("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the Express Router that serves GET /api/status.
 *
 * WHY a factory function rather than a module-level Router:
 *   The router needs access to `config` and `db`, which are determined at CLI
 *   startup, not at module-import time. A factory accepts both as parameters
 *   and captures them in a closure — meaning the same module can be loaded
 *   in tests (with a mock ConnectionConfig and mock Knex) and in production
 *   (with the real config and the real Knex).
 *
 * @param config - The resolved ConnectionConfig from the CLI parser. Contains
 *   connection metadata (host, port, database, etc.) but NEVER returned
 *   to the client in full — only non-sensitive fields are exposed.
 * @param db - The Knex instance to test connectivity.
 */
export function createStatusRouter(
  config: ConnectionConfig,
  db: Knex
): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response): Promise<void> => {
    // ── Test connectivity in parallel with building the response ────────────
    const connected = await isConnected(db);

    // ── Return connection metadata (NEVER the password) ────────────────────
    // WHY these specific fields:
    //   The UI's status bar displays: "Connected to postgres://user@host:5432/mydb"
    //   and the permission mode. These fields are the minimum required to
    //   identify which database the user is connected to and what they're
    //   allowed to do. The password is intentionally excluded — it's sensitive
    //   and serves no purpose in the UI.
    res.status(200).json({
      dialect: config.dialect,
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      mode: config.permissionMode,
      connected,
    });
  });

  return router;
}
