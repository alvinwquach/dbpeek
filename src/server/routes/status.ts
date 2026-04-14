/**
 * src/server/routes/status.ts
 *
 * WHAT: GET /api/status endpoint that returns database connection metadata and health status.
 *
 * WHY: dbpeek's React frontend needs to display connection info for debugging and knows
 * whether to show "DB is down" vs "API is down" state. This endpoint is also safe for
 * frontend display because it never leaks passwords.
 *
 * HOW: The query route (POST /api/query), the permissions module, and the CLI startup
 * code all use this to understand the user's current database and permission level.
 */

import { Router } from 'express';
import type { Knex } from '../db.js';
import type { Dialect } from '../db.js';
import type { PermissionMode } from '../index.js';

// Create a mini-app that holds just the status-related routes.
const router = Router();

/**
 * buildStatusResponse
 *
 * Extracts connection metadata from a Knex instance and tests connectivity.
 *
 * PSEUDOCODE:
 *   1. Extract the connection config object from knex.client.config
 *   2. Map the Knex driver name (pg, mysql2, better-sqlite3, mssql) to our dialect
 *   3. Extract host, port, database, user based on dialect (sqlite uses filename, others use standard fields)
 *   4. Run SELECT 1 to test the connection; set connected = true on success, false on error
 *   5. Return { dialect, host, port, database, user, mode, connected }
 *   6. CRITICAL: never include password in the return value
 *
 * @param knex - the Knex instance configured in app.locals
 * @param mode - the permission mode (read-only, write, or full) from app.locals
 * @returns an object containing dialect, host, port, database, user, mode, and connected status
 * @example
 *   const status = await buildStatusResponse(knex, 'read-only');
 *   // { dialect: 'postgres', host: 'localhost', port: 5432, ..., connected: true }
 */
async function buildStatusResponse(
  knex: Knex,
  mode: PermissionMode
): Promise<{
  dialect: Dialect;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  mode: PermissionMode;
  connected: boolean;
}> {
  // Extract the connection config from the Knex instance.
  // Knex stores the connection object in knex.client.config.connection.
  const knexConfig = knex.client.config;
  const connection = knexConfig.connection as Record<string, unknown> | undefined;

  // Map Knex driver names to our dialect names.
  // NOTE: Knex uses 'mysql2' internally even though we expose 'mysql' to users.
  const DRIVER_TO_DIALECT: Record<string, Dialect> = {
    pg: 'postgres',
    mysql2: 'mysql',
    'better-sqlite3': 'sqlite',
    mssql: 'mssql',
  };

  // Determine the dialect from the Knex client name.
  const driverName = knex.client.driverName as string;
  const dialect: Dialect = DRIVER_TO_DIALECT[driverName] || ('unknown' as Dialect);

  // Extract connection fields. The shape differs by dialect:
  //   - sqlite: { filename, ... }
  //   - postgres/mysql/mssql: { host, port, database, user, password, ... }
  // We deliberately do NOT extract the password field, for security.
  let host: string | undefined;
  let port: number | undefined;
  let database: string | undefined;
  let user: string | undefined;

  if (dialect === 'sqlite' && connection && 'filename' in connection) {
    database = connection.filename as string | undefined;
  } else if (connection) {
    host = connection.host as string | undefined;
    port = connection.port as number | undefined;
    database = connection.database as string | undefined;
    user = connection.user as string | undefined;
  }

  // Test connectivity by running SELECT 1, the simplest query all SQL engines support.
  // If the connection fails (wrong credentials, host unreachable, etc.), we catch the
  // error and return connected: false. We return HTTP 200 even on connection failure
  // because the endpoint itself succeeded — it's the database that's unavailable.
  let connected = false;
  try {
    await knex.raw('SELECT 1');
    connected = true;
  } catch (_error) {
    // Connection failed. This is expected when the database is down or credentials
    // are wrong, so we don't log or re-throw. The frontend will show "DB is down".
  }

  return {
    dialect,
    host,
    port,
    database,
    user,
    mode,
    connected,
  };
}

/**
 * GET /api/status
 *
 * Returns database connection metadata and current connection health.
 *
 * Response format:
 *   {
 *     "dialect": "postgres" | "mysql" | "sqlite" | "mssql",
 *     "host": "localhost",              // undefined for sqlite
 *     "port": 5432,                     // undefined for sqlite
 *     "database": "mydb",               // filename for sqlite
 *     "user": "postgres",               // undefined for sqlite
 *     "mode": "read-only" | "write" | "full",
 *     "connected": true | false
 *   }
 *
 * Always returns HTTP 200 — even if the database is unreachable. The frontend
 * distinguishes "API is up but DB is down" (200 with connected: false) from
 * "API itself is broken" (5xx).
 *
 * CRITICAL SECURITY: The password is never included in the response, even if
 * it's stored in Knex's config. Leaking credentials to the frontend violates
 * the principle of least privilege.
 */
router.get('/', async (req, res) => {
  // Retrieve the knex instance and permission mode from app.locals.
  // These were set by createServer() in src/server/index.ts.
  const knex = req.app.locals['knex'] as Knex;
  const mode = req.app.locals['mode'] as PermissionMode;

  // Build the status response: extract config, test connectivity, and format JSON.
  const status = await buildStatusResponse(knex, mode);

  // Return the status. HTTP 200 in all cases (connected or not).
  res.json(status);
});

export default router;
