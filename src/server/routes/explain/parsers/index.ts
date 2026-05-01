// ===== FILE PURPOSE =====
// Central dispatch table that maps each Dialect to its ExplainParser.
//
// Importing PARSERS from this file is the single way the route factory
// reaches a per-dialect parser — adding a new parser is therefore a
// one-place change (add the import + map entry). Mirrors the
// HANDLERS dispatch in routes/schema/handlers/index.ts.

import type { Dialect } from "../../../../types/connection.js";
import type { ExplainParser } from "../types.js";
import { postgresParser } from "./postgres.js";
import { mysqlParser } from "./mysql.js";
import { sqliteParser } from "./sqlite.js";
import { mssqlParser } from "./mssql.js";

/**
 * Per-dialect EXPLAIN parsers.
 *
 * `Record<Dialect, ExplainParser>` is the same exhaustiveness pattern used by
 * DIALECT_TO_KNEX_CLIENT in src/server/db.ts and HANDLERS in
 * routes/schema/handlers/index.ts: adding a new dialect to the union without
 * supplying a parser here is a compile error rather than a runtime "unknown
 * dialect" surprise.
 */
export const PARSERS: Record<Dialect, ExplainParser> = {
  postgres: postgresParser,
  mysql: mysqlParser,
  sqlite: sqliteParser,
  mssql: mssqlParser,
};
