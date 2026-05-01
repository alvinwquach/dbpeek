// ===== FILE PURPOSE =====
// Central dispatch table that maps each supported Dialect to its
// SchemaHandler implementation. Importing HANDLERS from this file is the
// single way the route layer reaches a per-dialect handler — adding a new
// handler is therefore a one-place change (add the import + map entry).

import type { Dialect } from "../../../../types/connection.js";
import type { SchemaHandler } from "../types.js";
import { postgresHandler } from "./postgres.js";
import { mysqlHandler } from "./mysql.js";
import { sqliteHandler } from "./sqlite.js";
import { mssqlHandler } from "./mssql.js";

// ===== DISPATCH TABLE =====

/**
 * Per-dialect schema introspection handlers.
 *
 * `Record<Dialect, SchemaHandler>` is the same exhaustiveness pattern used
 * by DIALECT_TO_KNEX_CLIENT in src/server/db.ts — adding a new dialect to
 * the union without supplying a handler here is a compile error rather than
 * a runtime "unknown dialect" surprise.
 */
export const HANDLERS: Record<Dialect, SchemaHandler> = {
  postgres: postgresHandler,
  mysql: mysqlHandler,
  sqlite: sqliteHandler,
  mssql: mssqlHandler,
};
