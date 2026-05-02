/**
 * src/client/hooks/useCellEdit.ts
 *
 * WHAT:
 *   Coordinates the inline-cell-edit lifecycle for the active tab's results
 *   grid: editability detection, dirty-cell tracking, the per-tab undo stack,
 *   the PUT /api/data/:table round-trip, and the post-save store mutation
 *   plus history logging.
 *
 * WHY a hook (not free functions or a component-scoped useState):
 *   The cell-edit feature needs to subscribe to the active tab and the live
 *   schema, write to multiple Zustand actions, AND keep two pieces of UI
 *   state (dirty cells + undo stack) that survive across renders. A custom
 *   hook is the right scope:
 *     - A single useEffect-free, callback-only API that ResultsTable invokes.
 *     - Encapsulates the editability decision so the consumer only asks
 *       "can I edit this column?" and gets back a yes/no with a reason.
 *     - Owns the undo stack so Cmd+Z keeps working even after the user
 *       navigates away from a cell.
 *
 * KEY DECISIONS:
 *   1. Editability is computed from the LAST executed SQL on the result
 *      (result.executedSql), the connection's permissionMode, and the live
 *      schema's PK list for the parsed table. The editor's current buffer
 *      is intentionally NOT consulted — the user may have typed something
 *      else after pressing Run, and we'd rather honour the rows on screen
 *      than the SQL the editor is showing right now.
 *
 *   2. Dirty cells are tracked in a Map keyed by `${rowIndex}__${colIndex}`,
 *      not by tab id. They reset implicitly whenever the tab's `result`
 *      changes (because ResultsTable resets its own selection state on the
 *      same effect). This avoids the question of "what counts as dirty
 *      after the next query?" — a re-fetch wipes the slate.
 *
 *   3. Undo runs the inverse UPDATE through the SAME pipeline. That keeps
 *      the round-trip honest (concurrent writes by another client get the
 *      same conflict detection) and lets us reuse the confirmation dialog,
 *      history log, and dirty highlight without code duplication.
 *
 * NON-GOALS:
 *   - We do NOT batch edits or implement multi-cell selection. One cell at
 *     a time matches DBeaver/TablePlus and keeps the data-loss surface
 *     small.
 *   - We do NOT validate value types client-side. The driver coerces /
 *     rejects per column type — a friendly server error is better than a
 *     client-side rule that drifts away from the column definition.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { useAppStore, type HistoryEntry } from "../stores/app";
import { parseSelectTable } from "../utils/parseSelectTable";
import { buildUpdateSql } from "../utils/buildUpdateSql";
import type { Dialect } from "../../types/connection";

// ===== TYPES =====

/**
 * The discriminated outcome of "can I edit this column on this row?".
 * Returned by canEditColumn so the consumer can show a tailored message
 * for each refusal reason.
 */
export type EditAvailability =
  | { kind: "editable" }
  | { kind: "readonly-mode" }
  | { kind: "no-pk" }
  | { kind: "multi-table" }
  | { kind: "alias-or-expression" }
  | { kind: "missing-pk-in-projection"; missing: string[] }
  | { kind: "unknown" };

/**
 * Stable key for the dirty-cells map.
 *
 * WHY string-key (not [number, number] tuple):
 *   JS Maps use reference equality for object keys, so [0, 0] !== [0, 0]
 *   between renders. A string composite key gives the standard value-equality
 *   behaviour without any custom equality plumbing.
 */
function cellKey(rowIndex: number, colIndex: number): string {
  return `${rowIndex}__${colIndex}`;
}

/**
 * One frame of the undo stack — captures the inverse of a successful edit.
 *
 * WHY storing the OLD value (not just the new one):
 *   Undo replays the inverse update, sending the OLD value back through the
 *   same PUT pipeline. The current value at the cell IS the new value — we
 *   need the prior value to revert.
 */
interface UndoEntry {
  rowIndex: number;
  colIndex: number;
  table: string;
  column: string;
  oldValue: unknown;
  pk: Record<string, unknown>;
}

// ===== HOOK =====

/** Inputs for useCellEdit. */
interface UseCellEditInput {
  /**
   * The currently displayed result (from the active tab). The hook reads
   * `executedSql`, `columns`, and `rows` to determine the originating table
   * and resolve PK row-values. Pass `null` when no result is on screen.
   */
  result: {
    columns: string[];
    rows: unknown[][];
    executedSql?: string;
  } | null;
}

export function useCellEdit({ result }: UseCellEditInput) {
  // ── Store reads ─────────────────────────────────────────────────────────
  const connectionInfo = useAppStore((s) => s.connectionInfo);
  const schemaColumns = useAppStore((s) => s.schemaColumns);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const updateTabResultCell = useAppStore((s) => s.updateTabResultCell);
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry);

  // ── Derived: dialect (defaults to postgres if status hasn't loaded yet) ─
  // Used purely for SQL display quoting; if dialect is missing we still
  // allow editing — Postgres-style quoting is also valid SQLite/MSSQL and
  // close enough to MySQL for a one-off display string.
  const dialect: Dialect =
    (connectionInfo?.dialect as Dialect | undefined) ?? "postgres";

  const mode = connectionInfo?.mode;
  const writable = mode === "write" || mode === "full";

  // ── Derived: parsed origin table (memoised on the executed SQL) ─────────
  const parsed = useMemo(
    () => (result?.executedSql ? parseSelectTable(result.executedSql) : null),
    [result?.executedSql]
  );

  // ── Derived: PK column names for the originating table ──────────────────
  const tableName = parsed?.kind === "ok" ? parsed.table : null;
  const pkColumns = useMemo<string[] | null>(() => {
    if (!tableName) return null;
    const cols = schemaColumns?.[tableName];
    if (!cols) return null;
    return cols.filter((c) => c.isPrimaryKey).map((c) => c.name);
  }, [schemaColumns, tableName]);

  // ── Derived: which result columns map to real table columns ─────────────
  // result.columns may contain aliases or expressions ("name AS displayName",
  // "COUNT(*)"). We can only edit columns whose header matches a real
  // schema column. Build a Set once per render so the per-cell check is O(1).
  const realColumns = useMemo<Set<string> | null>(() => {
    if (!tableName) return null;
    const cols = schemaColumns?.[tableName];
    if (!cols) return null;
    return new Set(cols.map((c) => c.name));
  }, [schemaColumns, tableName]);

  // ── Local state ─────────────────────────────────────────────────────────

  /**
   * Map of cellKey → { oldValue, newValue } for cells whose successful save
   * we want to highlight. Amber background until the next query overwrites
   * the result. Cleared implicitly when the active tab's `result` ref
   * changes (the consumer's effect on the same dependency wipes selection
   * state and re-mounts edit input).
   */
  const [dirtyCells, setDirtyCells] = useState<
    Map<string, { oldValue: unknown; newValue: unknown }>
  >(new Map());

  /**
   * Stack of undoable operations, newest at the end. Cmd+Z pops the top.
   * Bounded to keep memory predictable on a long editing session.
   *
   * WHY a ref (not state):
   *   Updating the stack does not need to trigger a re-render — the consumer
   *   reads the head value only inside the Cmd+Z handler. A ref also makes
   *   the stack survive React 18 concurrent re-renders without race issues
   *   (we never read it during render, only inside callbacks).
   */
  const undoStackRef = useRef<UndoEntry[]>([]);
  const UNDO_LIMIT = 50;

  /** True while a PUT is in flight. Disables the dialog / blocks new edits. */
  const [saving, setSaving] = useState(false);

  // ── Editability decision ────────────────────────────────────────────────

  /**
   * canEditColumn — returns the EditAvailability for the given column index.
   *
   * Why a function (not a memoised array):
   *   Most columns are never queried — they're checked once on double-click.
   *   Computing every column's editability up front would waste work.
   */
  const canEditColumn = useCallback(
    (colIndex: number): EditAvailability => {
      // ── Mode gate ───────────────────────────────────────────────────────
      if (!writable) return { kind: "readonly-mode" };

      // ── Origin gate ─────────────────────────────────────────────────────
      if (!parsed) return { kind: "unknown" };
      if (parsed.kind === "non-select") return { kind: "unknown" };
      if (parsed.kind === "multi") return { kind: "multi-table" };

      // ── PK gate ─────────────────────────────────────────────────────────
      if (!pkColumns) return { kind: "unknown" };
      if (pkColumns.length === 0) return { kind: "no-pk" };

      // Every PK column must appear in the result projection or we can't
      // build a complete WHERE clause. Surface which one is missing so the
      // UI can show "add `id` to the SELECT" guidance.
      if (!result) return { kind: "unknown" };
      const headers = new Set(result.columns);
      const missing = pkColumns.filter((p) => !headers.has(p));
      if (missing.length > 0) {
        return { kind: "missing-pk-in-projection", missing };
      }

      // ── Column gate ─────────────────────────────────────────────────────
      // The double-clicked column must map to a real table column (no
      // aliases, no computed expressions). renderCellValue won't reach
      // here without a valid column index, so we trust colIndex bounds.
      const colName = result.columns[colIndex];
      if (!colName) return { kind: "alias-or-expression" };
      if (!realColumns?.has(colName)) {
        return { kind: "alias-or-expression" };
      }

      return { kind: "editable" };
    },
    [writable, parsed, pkColumns, result, realColumns]
  );

  // ── Save pipeline ───────────────────────────────────────────────────────

  /**
   * Builds the pk object for a given row index by reading PK column values
   * out of the visible row data.
   *
   * Returns null when the table or PK columns aren't known yet, when the
   * row index is out of bounds, or when one of the PK columns isn't in the
   * projection (caller usually has already filtered these out via
   * canEditColumn — this is a defensive last check).
   */
  const buildPk = useCallback(
    (rowIndex: number): Record<string, unknown> | null => {
      if (!result || !pkColumns || pkColumns.length === 0) return null;
      const row = result.rows[rowIndex];
      if (!row) return null;
      const pk: Record<string, unknown> = {};
      for (const pkCol of pkColumns) {
        const idx = result.columns.indexOf(pkCol);
        if (idx === -1) return null;
        pk[pkCol] = row[idx];
      }
      return pk;
    },
    [result, pkColumns]
  );

  /**
   * Internal: runs the PUT, updates the local result, and logs to history.
   *
   * Used for both fresh edits AND undo replays — `pushUndo` is true for
   * fresh edits (a successful save adds an undo frame) and false for an
   * undo replay (we'd otherwise loop indefinitely).
   */
  const performUpdate = useCallback(
    async (input: {
      rowIndex: number;
      colIndex: number;
      newValue: unknown;
      oldValue: unknown;
      pushUndo: boolean;
    }): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!tableName) return { ok: false, error: "No target table." };
      const colName = result?.columns[input.colIndex];
      if (!colName) return { ok: false, error: "No target column." };
      const pk = buildPk(input.rowIndex);
      if (!pk) return { ok: false, error: "Cannot derive primary key." };

      const sql = buildUpdateSql({
        dialect,
        table: tableName,
        column: colName,
        value: input.newValue,
        pk,
      });

      setSaving(true);
      try {
        const response = await fetch(
          `/api/data/${encodeURIComponent(tableName)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              column: colName,
              value: input.newValue,
              pk,
            }),
          }
        );

        const data = (await response.json()) as
          | { rowsAffected: number; executionTime: number; sql: string }
          | { error: string };

        if (!response.ok || "error" in data) {
          const msg = "error" in data ? data.error : `HTTP ${response.status}`;
          // Failed UPDATE — log the failure to history with the SQL that
          // would have run. Helps the user see what they tried, the same
          // way a failed SELECT logs the SQL with success=false.
          addHistoryEntry({
            id: crypto.randomUUID(),
            sql,
            executedAt: new Date(),
            success: false,
          });
          return { ok: false, error: msg };
        }

        // Mutate the live result so the cell reflects the new value
        // immediately. Targets the active tab; if the user switched tabs
        // mid-flight the wrong tab would update — the dialog blocks that
        // by disabling tab navigation, but a defensive id snapshot below
        // ensures we don't write into a stale tab id.
        const activeId = tabs[activeTabIndex]?.id;
        if (activeId) {
          updateTabResultCell(
            activeId,
            input.rowIndex,
            input.colIndex,
            input.newValue
          );
        }

        // Log to history with the formatted SQL the server returned. Using
        // the server's SQL (not our buildUpdateSql) keeps display fully in
        // sync with what was executed even if the two formatters drift in
        // future. Either way, both render identical strings today.
        addHistoryEntry({
          id: crypto.randomUUID(),
          sql: data.sql,
          executedAt: new Date(),
          success: true,
          rowCount: data.rowsAffected,
          executionTime: data.executionTime,
        } satisfies HistoryEntry);

        // Mark the cell as dirty. Old value is the value FROM BEFORE this
        // edit (passed in by the caller), so a chain of edits keeps a
        // sensible "before/after" pair without leaking earlier states.
        setDirtyCells((prev) => {
          const next = new Map(prev);
          next.set(cellKey(input.rowIndex, input.colIndex), {
            oldValue: input.oldValue,
            newValue: input.newValue,
          });
          return next;
        });

        // Push the inverse onto the undo stack (only for fresh edits;
        // undo replays must NOT push themselves back on).
        if (input.pushUndo) {
          const frame: UndoEntry = {
            rowIndex: input.rowIndex,
            colIndex: input.colIndex,
            table: tableName,
            column: colName,
            oldValue: input.oldValue,
            pk,
          };
          const stack = undoStackRef.current;
          stack.push(frame);
          // Bound the stack size to keep memory predictable.
          if (stack.length > UNDO_LIMIT) stack.shift();
        }

        return { ok: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addHistoryEntry({
          id: crypto.randomUUID(),
          sql,
          executedAt: new Date(),
          success: false,
        });
        return { ok: false, error: msg };
      } finally {
        setSaving(false);
      }
    },
    [
      tableName,
      result,
      buildPk,
      dialect,
      tabs,
      activeTabIndex,
      updateTabResultCell,
      addHistoryEntry,
    ]
  );

  /**
   * saveEdit — public API for committing a single cell edit.
   *
   * @param rowIndex - 0-based row index in the visible result.
   * @param colIndex - 0-based column index in result.columns.
   * @param newValue - The value the user typed (string, null, etc.).
   * @returns A pre-formatted preview SQL string (for the confirmation
   *   dialog) plus a `commit` callback that runs the actual PUT.
   *
   * Splitting into preview + commit lets ResultsTable show the dialog
   * with the SQL inline, then fire the request only after the user clicks
   * "Run UPDATE". The hook handles store mutation and history logging on
   * success.
   */
  const saveEdit = useCallback(
    async (
      rowIndex: number,
      colIndex: number,
      newValue: unknown
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      const oldValue = result?.rows[rowIndex]?.[colIndex];
      return performUpdate({
        rowIndex,
        colIndex,
        newValue,
        oldValue,
        pushUndo: true,
      });
    },
    [performUpdate, result]
  );

  /**
   * undoLast — reverts the most recent successful edit by replaying its
   * inverse UPDATE through the same pipeline.
   *
   * Returns null when the undo stack is empty so the caller can no-op the
   * Cmd+Z shortcut without a popup. Returns a result so the caller can
   * surface server failures the same way it would for a fresh edit.
   */
  const undoLast = useCallback(async (): Promise<
    | null
    | { ok: true; sql: string }
    | { ok: false; error: string }
  > => {
    const frame = undoStackRef.current.pop();
    if (!frame) return null;

    // Replay the inverse: write oldValue at the same position. Pass the
    // current cell value (which IS the post-edit value the user wants
    // reverted) as oldValue so the dirty-cell map records "this was X
    // before the undo, is Y after".
    const currentValue = result?.rows[frame.rowIndex]?.[frame.colIndex];
    const outcome = await performUpdate({
      rowIndex: frame.rowIndex,
      colIndex: frame.colIndex,
      newValue: frame.oldValue,
      oldValue: currentValue,
      pushUndo: false,
    });

    if (outcome.ok) {
      const sql = buildUpdateSql({
        dialect,
        table: frame.table,
        column: frame.column,
        value: frame.oldValue,
        pk: frame.pk,
      });
      return { ok: true, sql };
    }
    // Failed: re-push the frame so the next Cmd+Z still has a target.
    undoStackRef.current.push(frame);
    return outcome;
  }, [performUpdate, result, dialect]);

  /**
   * buildPreview — assembles the SQL preview string for a pending edit
   * without running it. Returns null if any prerequisite is missing.
   *
   * Surfaced separately so the consumer can show the EditConfirmDialog
   * with the SQL in advance and only call saveEdit on user confirmation.
   */
  const buildPreview = useCallback(
    (
      rowIndex: number,
      colIndex: number,
      newValue: unknown
    ): {
      sql: string;
      table: string;
      column: string;
      pk: Record<string, unknown>;
    } | null => {
      if (!tableName) return null;
      const colName = result?.columns[colIndex];
      if (!colName) return null;
      const pk = buildPk(rowIndex);
      if (!pk) return null;
      const sql = buildUpdateSql({
        dialect,
        table: tableName,
        column: colName,
        value: newValue,
        pk,
      });
      return { sql, table: tableName, column: colName, pk };
    },
    [tableName, result, buildPk, dialect]
  );

  /** Wipes the dirty-cell highlights. Called by the consumer on result reset. */
  const clearDirty = useCallback(() => {
    setDirtyCells(new Map());
    undoStackRef.current = [];
  }, []);

  return {
    /** Currently parsed origin table, or null. Surfaced for diagnostics. */
    tableName,
    /** True if any undo frame exists — drives Cmd+Z gating. */
    canUndo: undoStackRef.current.length > 0,
    /** True while a PUT is in flight. */
    saving,
    /** cellKey → { oldValue, newValue } map of recently-saved cells. */
    dirtyCells,
    /** Functional: editability check (per column index). */
    canEditColumn,
    /** Functional: pure preview-string builder (no I/O). */
    buildPreview,
    /** Functional: commits a fresh edit (PUT + store + history). */
    saveEdit,
    /** Functional: replays the inverse of the last successful edit. */
    undoLast,
    /** Functional: clears dirty-cell map + undo stack. */
    clearDirty,
  };
}

/**
 * Returns a human-readable message for an EditAvailability refusal.
 * Centralised here so both the cell double-click handler and any future
 * keyboard-edit flow can render the same copy.
 */
export function explainAvailability(av: EditAvailability): string | null {
  switch (av.kind) {
    case "editable":
      return null;
    case "readonly-mode":
      return "Cannot edit: read-only mode. Restart with --write to enable.";
    case "no-pk":
      return "Cannot edit: table has no primary key";
    case "multi-table":
      return "Cannot edit: query involves multiple tables";
    case "alias-or-expression":
      return "Cannot edit: column is an alias or expression";
    case "missing-pk-in-projection":
      return `Cannot edit: primary key column${
        av.missing.length > 1 ? "s" : ""
      } not in result (${av.missing.join(", ")})`;
    case "unknown":
      return "Cannot edit: query origin unknown";
  }
}
