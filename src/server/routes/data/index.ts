// ===== FILE PURPOSE =====
// PUT /api/data/:table — single-cell UPDATE endpoint backing inline cell
// editing in the results grid.
//
// WHAT it does:
//   Accepts a JSON body identifying ONE column on ONE row of a single table
//   (`{ column, value, pk }`) and runs an `UPDATE table SET col = ? WHERE
//   <pkCol> = ? [AND <pkCol> = ? ...]` statement using parameter bindings.
//   Returns `{ rowsAffected, executionTime, sql }` so the client can:
//     - confirm exactly one row changed,
//     - render a "took 12ms" stat,
//     - log the formatted SQL into the query history side-panel.
//
// PERMISSION: requires --write or --full mode. 403 in --readonly.
//
// WHY a dedicated route (not POST /api/query):
//   The general /api/query handler accepts arbitrary user-typed SQL. The cell-
//   edit flow accepts STRUCTURED inputs (table, column, value, pk) and builds
//   the SQL on the server. That asymmetry is on purpose — it means:
//     1. The UI never has to assemble a parameter-bound UPDATE locally and
//        risk an injection through identifier interpolation.
//     2. The server can whitelist `:table`, `column`, and pk keys against the
//        live schema BEFORE running anything. A request for column "name; DROP
//        TABLE users; --" is rejected long before it can reach the driver.
//     3. Permission semantics are clearer: this endpoint is "edit one cell"
//        and the validator can be a single tight check rather than the
//        statement-classifier the general query route runs.
//
// WHY composite primary keys are a `Record<string, unknown>`:
//   Most tables have a single-column PK, but some (junction tables, multi-
//   tenant designs) use composite keys. Modelling `pk` as an object whose
//   keys are PK column names means the route handles both shapes with the
//   same code path. The client whitelists pk keys against the schema, the
//   server whitelists them again — defence in depth.

import { Router, type Request, type Response } from "express";
import type { Knex } from "../../db.js";
import type { ConnectionConfig, PermissionMode } from "../../../types/connection.js";
import { HANDLERS } from "../schema/handlers/index.js";

// ===== REQUEST / RESPONSE TYPES =====

/**
 * Expected JSON body for PUT /api/data/:table.
 *
 * `value` is `unknown` because the cell type depends on the column — string,
 * number, boolean, null, or a JSON-serialisable object for JSONB columns.
 * The driver coerces the runtime type to match the column-declared type, so
 * we don't pre-cast on this side.
 *
 * `pk` keys map PK column names to their current row values. The client
 * derives this from the row data already on screen — so the same row that's
 * visible in the grid is the one that gets updated. We never compute the
 * key server-side; that'd require a SELECT round-trip the cell-edit flow
 * doesn't otherwise need.
 */
interface UpdateBody {
  /** Column name being edited. Whitelisted against the table's schema. */
  column: string;
  /** New value. Forwarded verbatim to the driver via parameter binding. */
  value: unknown;
  /**
   * Map of primary-key column → current row value. Length must match the
   * table's PK arity (1 for single-column PK, 2+ for composite). Every key
   * is whitelisted against the table's schema before reaching SQL.
   */
  pk: Record<string, unknown>;
}

/** Successful response. */
interface UpdateSuccess {
  /**
   * Number of rows the UPDATE affected. The client treats `> 1` as a fatal
   * error — a PK should match at most one row, so anything else means the
   * client's PK derivation is wrong and we shouldn't blindly succeed.
   */
  rowsAffected: number;
  /** Wall-clock milliseconds for the UPDATE round-trip. */
  executionTime: number;
  /**
   * Human-readable SQL used for the operation, with values inlined for
   * display in the query history. Identifiers are dialect-quoted so the
   * surfaced string matches what the driver actually ran.
   *
   * NOTE: this is the DISPLAY string, not the executed string. Internally
   * the route uses parameter binding via knex (??/?) — this is rebuilt for
   * the client purely so the history panel reads naturally.
   */
  sql: string;
}

// ===== HELPERS =====

/**
 * Returns the per-dialect identifier-quoting characters.
 *
 * Postgres / MSSQL / SQLite use double quotes for identifiers. MySQL uses
 * backticks. Building the display SQL with the right quote style means the
 * history-panel string is paste-runnable in the same dialect's CLI.
 */
function quoteIdent(name: string, dialect: ConnectionConfig["dialect"]): string {
  // Strip embedded quote chars defensively. The whitelist already guarantees
  // the name is a real identifier, but doubling-up the escape is cheap and
  // belt-and-braces against any future accidental bypass of the whitelist.
  if (dialect === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Renders a literal value for the DISPLAY-only SQL string returned to the
 * client (NOT used for execution — the driver runs a parameter-bound query).
 *
 * Distinct from JSON.stringify because:
 *   - SQL strings use single quotes with '' as the embedded escape.
 *   - SQL booleans are bare TRUE/FALSE keywords, not "true"/"false".
 *   - SQL nulls are bare NULL keywords.
 *   - JSONB / object columns are serialised to a single-quoted JSON string.
 */
function formatLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    // JSON columns: serialise to JSON, then quote as a SQL string literal.
    return "'" + JSON.stringify(value).replace(/'/g, "''") + "'";
  }
  return "'" + String(value).replace(/'/g, "''") + "'";
}

// ===== ROUTER FACTORY =====

/**
 * Builds the Express router for PUT /api/data/:table.
 *
 * @param config - The full connection config. Used for dialect (identifier
 *   quoting) and permissionMode (write/full gating).
 * @param db     - Knex instance to execute the UPDATE through.
 */
export function createDataRouter(config: ConnectionConfig, db: Knex): Router {
  const router = Router();
  const handler = HANDLERS[config.dialect];
  const mode: PermissionMode = config.permissionMode;

  // ── PUT /:table ───────────────────────────────────────────────────────────
  router.put("/:table", async (req: Request, res: Response): Promise<void> => {
    // ── Permission gate ─────────────────────────────────────────────────────
    // UPDATE is DML — strictly forbidden in --readonly. The message mirrors
    // the wording from the general /api/query permission denials so the UI
    // can render a uniform error path.
    if (mode === "readonly") {
      res.status(403).json({
        error:
          "Cell editing not allowed in read-only mode. Start with --write to enable.",
      });
      return;
    }

    // ── URL param ───────────────────────────────────────────────────────────
    // noUncheckedIndexedAccess defensive narrowing pattern (mirrors the
    // schema route — req.params.table is `string | undefined` at the type
    // level even though Express guarantees it at runtime).
    const tableName = req.params.table;
    if (!tableName) {
      res.status(400).json({ error: "Missing table name in URL." });
      return;
    }

    // ── Body validation ─────────────────────────────────────────────────────
    // Strict shape check: column must be a non-empty string, pk must be a
    // non-null object with at least one key. value can legitimately be any
    // JSON-serialisable type (including null) so it gets the lightest check.
    const body = req.body as Partial<UpdateBody> | undefined;
    if (!body || typeof body !== "object") {
      res.status(400).json({ error: "Request body must be a JSON object." });
      return;
    }

    const { column, value, pk } = body;

    if (typeof column !== "string" || column.trim() === "") {
      res.status(400).json({ error: "column must be a non-empty string." });
      return;
    }
    if (pk === null || pk === undefined || typeof pk !== "object" || Array.isArray(pk)) {
      res.status(400).json({
        error: "pk must be an object mapping primary-key columns to values.",
      });
      return;
    }
    const pkEntries = Object.entries(pk);
    if (pkEntries.length === 0) {
      res.status(400).json({
        error: "pk must contain at least one primary-key column.",
      });
      return;
    }

    try {
      // ── Schema whitelist: table must exist ──────────────────────────────
      // Same pattern as the schema route — looking up the canonical name
      // server-side prevents identifier injection via :table.
      const tables = await handler.listTables(db);
      if (!tables.some((t) => t.name === tableName)) {
        res.status(404).json({ error: `Table not found: ${tableName}` });
        return;
      }

      // ── Schema whitelist: column + pk columns must exist on this table ──
      // describeTable() doubles as the column list AND the PK source. We
      // require:
      //   1. `column` is a real column on this table.
      //   2. Every key in `pk` is a real column AND has isPrimaryKey=true.
      //   3. The supplied pk keys cover EVERY primary-key column on the
      //      table — incomplete keys would match more than one row.
      const columns = await handler.describeTable(db, tableName);
      const colInfo = columns.find((c) => c.name === column);
      if (!colInfo) {
        res
          .status(400)
          .json({ error: `Column not found on ${tableName}: ${column}` });
        return;
      }

      const tablePkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
      if (tablePkCols.length === 0) {
        res
          .status(400)
          .json({ error: `Table ${tableName} has no primary key — cannot edit.` });
        return;
      }

      // Reject if any pk key is unknown / not actually a PK column.
      for (const key of Object.keys(pk)) {
        if (!tablePkCols.includes(key)) {
          res.status(400).json({
            error: `pk includes a non-primary-key column: ${key}`,
          });
          return;
        }
      }

      // Reject if any real PK column is missing from the request — that
      // would mean the WHERE clause matches multiple rows.
      for (const pkCol of tablePkCols) {
        if (!Object.prototype.hasOwnProperty.call(pk, pkCol)) {
          res.status(400).json({
            error: `pk is missing primary-key column: ${pkCol}`,
          });
          return;
        }
      }

      // ── Build and run the UPDATE via Knex query builder ─────────────────
      // Knex auto-quotes identifiers per dialect AND parameter-binds values,
      // so neither the column name nor the value can break the SQL grammar
      // even if the whitelist were somehow bypassed.
      const start = process.hrtime.bigint();
      const rowsAffected = await db(tableName)
        .where(pk as Record<string, Knex.Value>)
        .update({ [column]: value as Knex.Value });
      const end = process.hrtime.bigint();
      const executionTime = Number(end - start) / 1_000_000;

      // ── Build the display SQL the client logs to query history ──────────
      // Identifiers get dialect-correct quoting; values are SQL-literal
      // formatted (NULL/TRUE/FALSE/quoted-strings). This string is NOT
      // executed — it is purely for the history panel.
      const qTable = quoteIdent(tableName, config.dialect);
      const qCol = quoteIdent(column, config.dialect);
      const whereClauses = pkEntries
        .map(([k, v]) => `${quoteIdent(k, config.dialect)} = ${formatLiteral(v)}`)
        .join(" AND ");
      const displaySql = `UPDATE ${qTable} SET ${qCol} = ${formatLiteral(value)} WHERE ${whereClauses}`;

      const payload: UpdateSuccess = {
        rowsAffected,
        executionTime,
        sql: displaySql,
      };
      res.status(200).json(payload);
      return;
    } catch (err: unknown) {
      // Any error past the whitelist is a database failure (constraint
      // violation, type mismatch, dropped connection). Surfacing the raw
      // driver message helps the user diagnose without server log access —
      // same convention as the schema and import routes.
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
      return;
    }
  });

  return router;
}
