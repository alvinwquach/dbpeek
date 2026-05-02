/**
 * src/client/components/Schema/TableEditor.tsx
 *
 * ===== FILE PURPOSE =====
 * Two-phase modal dialog for editing a table's structure (columns) and emitting
 * the corresponding ALTER TABLE statements. Opened from the SchemaTree via the
 * "Edit Structure" pencil button or the right-click context menu — both gated
 * to --full mode only because ALTER TABLE is a DDL operation that can break
 * application code, indexes, and constraints in ways that cannot be reversed
 * by a single subsequent statement.
 *
 * ===== TWO-PHASE FLOW =====
 *
 *   Phase 1 — EDITING (default on open)
 *     • All columns are shown in a list with editable name + type fields,
 *       a Delete button per row, and badges that surface the read-only flags
 *       (nullable, default, PK, FK, indexed) so the user can see context they
 *       must NOT alter via this dialog.
 *     • An "Add Column" button at the bottom appends a blank row with isNew=true.
 *     • Clicking "Save Changes" computes the ALTER TABLE SQL by diffing the
 *       working state against the original ColumnInfo[] and switches to Phase 2.
 *
 *   Phase 2 — PREVIEW (after Save Changes)
 *     • The generated SQL is rendered in a read-only block with monospace
 *       formatting so the user can review every statement BEFORE anything runs.
 *     • "Back to Edit" returns to Phase 1 with all working state preserved.
 *     • "Execute" pops a confirmation, then POSTs /api/query to run the SQL.
 *     • On success, the schema is re-fetched into the Zustand store so the
 *       sidebar tree reflects the new structure without a page reload.
 *
 * ===== DIALECT-SPECIFIC ALTER TABLE =====
 *
 * Each engine handles ALTER differently. The dialect dispatch lives in
 * buildAlterTableStatements() at the bottom of this file:
 *
 *   POSTGRES
 *     ADD     ALTER TABLE t ADD COLUMN c type
 *     DROP    ALTER TABLE t DROP COLUMN c
 *     RENAME  ALTER TABLE t RENAME COLUMN old TO new
 *     TYPE    ALTER TABLE t ALTER COLUMN c TYPE newtype
 *
 *   MYSQL
 *     ADD     ALTER TABLE t ADD c type
 *     DROP    ALTER TABLE t DROP COLUMN c
 *     RENAME  ALTER TABLE t RENAME COLUMN old TO new   (5.7+)
 *     TYPE    ALTER TABLE t MODIFY c newtype
 *
 *   SQLITE
 *     ADD     ALTER TABLE t ADD COLUMN c type
 *     DROP    ALTER TABLE t DROP COLUMN c              (3.35+, otherwise unsupported)
 *     RENAME  ALTER TABLE t RENAME COLUMN old TO new   (3.25+, otherwise unsupported)
 *     TYPE    NOT SUPPORTED — emitted as a SQL comment with a -- WARNING note.
 *             Changing a column's type on SQLite requires recreating the table
 *             (CREATE new, INSERT SELECT, DROP old, RENAME). That's well beyond
 *             the scope of a one-click edit, so we surface the limitation
 *             rather than pretending we support it.
 *
 *   MSSQL
 *     ADD     ALTER TABLE t ADD c type
 *     DROP    ALTER TABLE t DROP COLUMN c
 *     RENAME  EXEC sp_rename 't.old', 'new', 'COLUMN'  (no native ALTER … RENAME)
 *     TYPE    ALTER TABLE t ALTER COLUMN c newtype
 *
 * ===== SAFETY CONTRACT =====
 *
 *   1. Permission gate — the entry points in SchemaTree (button + context menu
 *      item) are conditionally rendered only when connectionInfo.mode === "full".
 *      The dialog itself does NOT re-check permissions; the gate is at the entry.
 *      The server (validateQuery in src/server/permissions.ts) is the real
 *      enforcement boundary — DDL is rejected with HTTP 403 in any other mode.
 *   2. Generated SQL is ALWAYS shown before execution. There is no "save and
 *      run" path that skips the preview.
 *   3. A native window.confirm() warns "This will modify the table structure.
 *      This cannot be undone." before the POST fires.
 *   4. The ALTER is logged to the global query history (addHistoryEntry) so
 *      the user can paste it back into the editor to inspect / replay.
 *   5. On success, the schema is refreshed in the Zustand store. The sidebar
 *      re-renders with the new column list automatically.
 *
 * ===== STATE MODEL =====
 *
 *   phase           : 'editing' | 'preview' | 'executing' | 'done' | 'error'
 *   working         : WorkingColumn[]                — the live edited list
 *   originals       : ColumnInfo[]                   — frozen snapshot from props
 *   alterSql        : string                         — generated in Save Changes
 *   resultMessage   : string | null                  — success summary
 *   errorMessage    : string | null                  — error from execution
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore, type HistoryEntry } from "../../stores/app";
import type { ColumnInfo } from "../../hooks/useSchema";
import type { Dialect } from "../../../types/connection";

// ===== TYPES =====

/**
 * Row in the editor's working list.
 *
 * WHY a separate "working" type instead of mutating ColumnInfo:
 *   The editor needs to track:
 *     • Whether a row is brand new (isNew → emit ADD COLUMN).
 *     • What the column was originally called (originalName → emit RENAME if
 *       the user edited the name field).
 *     • What the column's type was originally (originalType → emit ALTER TYPE
 *       if the user edited the type field).
 *   None of those fields belong on ColumnInfo (a server-shape DTO). Keeping
 *   the working state in its own type makes the diff logic in
 *   buildAlterTableStatements() unambiguous: every WorkingColumn knows
 *   exactly how it should serialise relative to its origin.
 */
interface WorkingColumn {
  /** Stable id used as React key. Originals use their original name; new rows use a uuid. */
  id: string;
  /** True for rows added via "Add Column"; false for rows seeded from originals. */
  isNew: boolean;
  /** The column's name on first render (only set for !isNew rows). Drives RENAME. */
  originalName?: string;
  /** The column's type on first render (only set for !isNew rows). Drives TYPE change. */
  originalType?: string;
  /** Current name field value (editable). */
  name: string;
  /** Current type field value (editable). */
  type: string;
  /** Read-only flag, displayed as a badge. */
  nullable: boolean;
  /** Read-only default value, displayed as a badge if present. */
  defaultValue: string | null;
  /** Read-only PK flag, displayed as a "PK" badge if true. */
  isPrimaryKey: boolean;
  /** Read-only FK target, displayed as a "FK→table.column" badge if set. */
  foreignKey: { table: string; column: string } | null;
  /** Read-only indexed flag, displayed as an "IX" badge if true. */
  isIndexed: boolean;
}

/** Lifecycle phase of the editor. Drives which UI fragment is shown. */
type Phase = "editing" | "preview" | "executing" | "done" | "error";

/** Props accepted by TableEditor. */
export interface TableEditorProps {
  /** Target table name (already whitelisted by SchemaTree). */
  table: string;
  /** The current column metadata for this table (frozen snapshot at open time). */
  columns: ColumnInfo[];
  /** Active database dialect — picks ALTER syntax. */
  dialect: Dialect;
  /** Called when the user dismisses the dialog. Disabled while executing. */
  onClose: () => void;
}

// ===== IDENTIFIER QUOTING =====

/**
 * Wraps a SQL identifier in the dialect's quoting characters so the generated
 * ALTER is paste-runnable in the matching CLI.
 *
 *   Postgres / SQLite  → "double quotes" (ANSI standard)
 *   MySQL              → `backticks`
 *   MSSQL              → [square brackets]
 *
 * Doubles up any embedded quote character defensively. The identifiers reaching
 * this function are either:
 *   • The table name from a SchemaTree row (already on the server's whitelist), or
 *   • A column name typed by the user in the editor input — which CAN contain
 *     a literal quote character if the user pastes one. The doubling preserves
 *     the input verbatim and keeps the quoting parser-correct in every dialect.
 */
function quoteIdent(name: string, dialect: Dialect): string {
  if (dialect === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  if (dialect === "mssql") return "[" + name.replace(/\]/g, "]]") + "]";
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Wraps a string value in single quotes for use as a SQL string literal,
 * doubling any embedded apostrophe per the SQL standard escape rule.
 *
 * Used only for MSSQL's sp_rename — that procedure takes string arguments
 * (NOT identifiers), so the rename target is built as 'table.col', 'newcol',
 * 'COLUMN'. Other dialects use ALTER TABLE ... RENAME COLUMN with bare
 * identifiers and never reach this helper.
 */
function quoteString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

// ===== ALTER TABLE GENERATION =====

/**
 * buildAlterTableStatements — diffs the working column list against the
 * originals and returns the ordered list of ALTER TABLE statements that
 * achieve the equivalent transformation.
 *
 * ORDER MATTERS:
 *   1. DROP existing originals that are no longer in the working list.
 *      (Frees up names for any subsequent RENAME that wants to reuse them
 *      and shrinks the table early so any later TYPE changes operate on
 *      fewer columns.)
 *   2. RENAME existing columns whose name field was edited.
 *      (Done BEFORE TYPE so the subsequent TYPE statement can target the
 *      new identifier, matching how the user reads the working row.)
 *   3. TYPE-change existing columns whose type field was edited.
 *      Each dialect uses a different keyword:
 *        Postgres → ALTER COLUMN c TYPE newtype
 *        MySQL    → MODIFY c newtype
 *        MSSQL    → ALTER COLUMN c newtype
 *        SQLite   → emit a -- WARNING comment (no native syntax exists)
 *   4. ADD any rows flagged isNew.
 *
 * @param table      Target table name.
 * @param dialect    Active database dialect.
 * @param originals  Frozen ColumnInfo[] from the open-time snapshot.
 * @param current    Working column list as edited by the user.
 * @returns          Ordered list of complete SQL statements (each ends in ";").
 */
function buildAlterTableStatements(
  table: string,
  dialect: Dialect,
  originals: ColumnInfo[],
  current: WorkingColumn[]
): string[] {
  const stmts: string[] = [];
  const qTable = quoteIdent(table, dialect);

  // Build a lookup of (originalName → working row) so DROP detection can find
  // the originals not present in the current list with O(1) checks.
  const currentByOriginal = new Map<string, WorkingColumn>();
  for (const col of current) {
    if (!col.isNew && col.originalName) {
      currentByOriginal.set(col.originalName, col);
    }
  }

  // ── Step 1: DROP originals that are no longer present ──────────────────────
  for (const orig of originals) {
    if (!currentByOriginal.has(orig.name)) {
      if (dialect === "sqlite") {
        // SQLite added DROP COLUMN in 3.35.0. Older SQLite installs reject it.
        // We still emit the statement (it's valid syntax) and add a one-line
        // comment so the user knows their server version may matter.
        stmts.push(
          `-- WARNING: SQLite supports DROP COLUMN only on 3.35.0+ — older versions reject the next statement.`
        );
      }
      stmts.push(
        `ALTER TABLE ${qTable} DROP COLUMN ${quoteIdent(orig.name, dialect)};`
      );
    }
  }

  // ── Step 2: RENAME columns whose name field changed ────────────────────────
  for (const col of current) {
    if (col.isNew || !col.originalName) continue;
    if (col.name === col.originalName) continue;

    if (dialect === "mssql") {
      // sp_rename takes ('schema.table.col', 'newcol', 'COLUMN'). Without a
      // schema prefix, MSSQL defaults to dbo.* which matches the introspection
      // route's expectation. We do NOT bracket-quote inside the string literal
      // because sp_rename parses the argument itself.
      stmts.push(
        `EXEC sp_rename ${quoteString(`${table}.${col.originalName}`)}, ${quoteString(col.name)}, ${quoteString("COLUMN")};`
      );
    } else if (dialect === "sqlite") {
      // SQLite RENAME COLUMN landed in 3.25.0. Older versions reject it. We
      // emit it and warn — same trade-off as DROP COLUMN above.
      stmts.push(
        `-- WARNING: SQLite supports RENAME COLUMN only on 3.25.0+ — older versions reject the next statement.`
      );
      stmts.push(
        `ALTER TABLE ${qTable} RENAME COLUMN ${quoteIdent(col.originalName, dialect)} TO ${quoteIdent(col.name, dialect)};`
      );
    } else {
      // Postgres + MySQL share the standard RENAME COLUMN syntax.
      stmts.push(
        `ALTER TABLE ${qTable} RENAME COLUMN ${quoteIdent(col.originalName, dialect)} TO ${quoteIdent(col.name, dialect)};`
      );
    }
  }

  // ── Step 3: TYPE changes for existing (kept) columns ───────────────────────
  for (const col of current) {
    if (col.isNew || !col.originalType) continue;
    if (col.type.trim() === col.originalType.trim()) continue;

    // Use the CURRENT name (post-rename) so the TYPE statement targets the
    // identifier the user sees in the editor row.
    const qCol = quoteIdent(col.name, dialect);

    switch (dialect) {
      case "postgres":
        stmts.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} TYPE ${col.type};`);
        break;
      case "mysql":
        stmts.push(`ALTER TABLE ${qTable} MODIFY ${qCol} ${col.type};`);
        break;
      case "mssql":
        stmts.push(`ALTER TABLE ${qTable} ALTER COLUMN ${qCol} ${col.type};`);
        break;
      case "sqlite":
        // SQLite has no in-place TYPE change. The supported workaround is
        // CREATE new → INSERT SELECT → DROP old → RENAME — which is far
        // beyond a single-statement ALTER. Surface the limitation as a
        // comment so the user understands why nothing executable is emitted.
        stmts.push(
          `-- WARNING: SQLite does not support changing a column's type via ALTER TABLE.`
        );
        stmts.push(
          `-- Column ${col.name} type change skipped — recreate the table to alter its type.`
        );
        break;
    }
  }

  // ── Step 4: ADD new columns ────────────────────────────────────────────────
  for (const col of current) {
    if (!col.isNew) continue;
    const qCol = quoteIdent(col.name, dialect);

    if (dialect === "mysql") {
      // MySQL accepts both `ADD c type` and `ADD COLUMN c type`. We pick the
      // shorter form because that's what `SHOW CREATE TABLE` round-trips to,
      // matching the engine's own canonical rendering.
      stmts.push(`ALTER TABLE ${qTable} ADD ${qCol} ${col.type};`);
    } else {
      stmts.push(`ALTER TABLE ${qTable} ADD COLUMN ${qCol} ${col.type};`);
    }
  }

  return stmts;
}

// ===== SCHEMA REFRESH UTILITY =====

/**
 * Re-fetches /api/schema and every /api/schema/:table endpoint, then writes
 * the result back into the Zustand store via the existing setSchema action.
 *
 * WHY this lives here instead of being exported from useSchema.ts:
 *   useSchema is a hook; calling it from inside an event handler is illegal
 *   in React. We could lift its fetcher into a free function in that file,
 *   but TableEditor is the only other caller and the duplication is small.
 *   Keeping it local also makes the ALTER → refresh loop self-contained:
 *   anyone reading TableEditor sees the full success path without bouncing
 *   to a different module.
 *
 * Errors are swallowed: if the schema refresh fails the dialog still shows
 * its success message (the ALTER itself succeeded). The user can refresh
 * the page to recover. Surfacing a second error after the success would be
 * more confusing than helpful.
 */
async function refreshSchemaIntoStore(): Promise<void> {
  const store = useAppStore.getState();
  try {
    // Mirror useSchema's fetch sequence exactly so the resulting store shape
    // is byte-identical to a fresh page load.
    const listRes = await fetch("/api/schema");
    if (!listRes.ok) return;
    const listData = (await listRes.json()) as {
      tables: Array<{ name: string; rowCount: number }>;
    };
    const tableNames = listData.tables.map((t) => t.name);

    const columnResponses = await Promise.all(
      tableNames.map(async (table) => {
        const res = await fetch(`/api/schema/${encodeURIComponent(table)}`);
        if (!res.ok) return { table, columns: [] as ColumnInfo[] };
        const data = (await res.json()) as { columns: ColumnInfo[] };
        return { table, columns: data.columns };
      })
    );

    const schemaMap: Record<string, string[]> = {};
    const schemaColumns: Record<string, ColumnInfo[]> = {};
    const schemaRowCounts: Record<string, number> = {};

    for (const { table, columns } of columnResponses) {
      schemaMap[table] = columns.map((c) => c.name);
      schemaColumns[table] = columns;
    }
    for (const t of listData.tables) {
      schemaRowCounts[t.name] = t.rowCount;
    }

    store.setSchema(schemaMap, schemaColumns, schemaRowCounts);
  } catch {
    // Intentionally silent — see function header.
  }
}

// ===== ICONS =====

/**
 * Pencil icon shown in the dialog header. Visually distinct from the
 * Document icon used in DdlViewer (a read-only viewer) so the user can tell
 * the two modals apart at a glance.
 */
function PencilIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-[#fbbf24]"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 2.5L11.5 5L4.5 12H2V9.5L9 2.5Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M8 3.5L10.5 6" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

/** Trash glyph used for the per-column Delete button. */
function TrashIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 3.5h7M5 2h2M3.5 3.5L4 10.5h4l.5-7"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Plus glyph used by the "Add Column" button. */
function PlusIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 2v8M2 6h8"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ===== MAIN COMPONENT =====

/**
 * TableEditor — two-phase modal for editing a table's column structure.
 *
 * Mounted by SchemaTree as a sibling at root scope so it can use fixed
 * positioning and is NOT clipped by the sidebar's overflow-y-auto. The
 * `key` SchemaTree passes is the table name so opening a different table
 * in succession remounts with a fresh working state.
 */
export function TableEditor({
  table,
  columns,
  dialect,
  onClose,
}: TableEditorProps) {
  // Frozen snapshot of the original column list. We never mutate this — it's
  // the diff baseline used by buildAlterTableStatements().
  // useState(() => …) defers the array clone until first render, avoiding a
  // pointless allocation on subsequent renders.
  const [originals] = useState<ColumnInfo[]>(() => columns.slice());

  // Live working list. Seed each row with the matching original's metadata
  // so the read-only badges (PK, FK, …) render immediately.
  const [working, setWorking] = useState<WorkingColumn[]>(() =>
    columns.map((c) => ({
      id: c.name,
      isNew: false,
      originalName: c.name,
      originalType: c.type,
      name: c.name,
      type: c.type,
      nullable: c.nullable,
      defaultValue: c.defaultValue,
      isPrimaryKey: c.isPrimaryKey,
      foreignKey: c.foreignKey,
      isIndexed: c.isIndexed,
    }))
  );

  const [phase, setPhase] = useState<Phase>("editing");
  const [alterSql, setAlterSql] = useState<string>("");
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry);

  // ── Escape key + body-scroll lock ─────────────────────────────────────────
  // Block Escape while executing so the user can't close mid-statement and
  // wonder why their schema is half-changed. Same pattern as ImportPreview.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "executing") onClose();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, phase]);

  // ── Editing handlers ──────────────────────────────────────────────────────

  /**
   * Updates one field on the working row identified by `id`. The setter takes
   * the prior value so the update is queue-safe under React 18's concurrent
   * rendering — critical because adjacent inputs may dispatch back-to-back.
   */
  const updateColumn = useCallback(
    (id: string, patch: Partial<Pick<WorkingColumn, "name" | "type">>) => {
      setWorking((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch } : c))
      );
    },
    []
  );

  /**
   * Removes a column from the working list.
   *
   * For existing originals, this means "DROP COLUMN" will be emitted at Save.
   * For new (isNew) rows, it just removes the unsaved addition — no SQL
   * footprint. Either way the user is asked to confirm because losing the
   * row is annoying to undo (they'd retype the name + type from scratch).
   */
  const deleteColumn = useCallback((id: string, name: string) => {
    const ok = window.confirm(
      `Delete column "${name}"? This will be included in the ALTER TABLE preview.`
    );
    if (!ok) return;
    setWorking((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /**
   * Appends a blank "new column" row at the bottom of the working list.
   * crypto.randomUUID gives a stable React key that won't collide with the
   * original-name keys used for existing rows.
   */
  const addColumn = useCallback(() => {
    setWorking((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        isNew: true,
        name: "",
        type: "",
        nullable: true,
        defaultValue: null,
        isPrimaryKey: false,
        foreignKey: null,
        isIndexed: false,
      },
    ]);
  }, []);

  // ── Save / Preview ────────────────────────────────────────────────────────

  /**
   * Validates the working list, generates the ALTER TABLE SQL, and switches
   * the dialog to the preview phase.
   *
   * Validation is intentionally minimal:
   *   1. Every row must have a non-empty name and type. The database itself
   *      gives a far better error for type mismatches than we could.
   *   2. No two rows may share a final name (would make the diff ambiguous
   *      and the database would refuse the resulting batch anyway).
   *   3. There must be SOMETHING to do — pure no-op edits are rejected with
   *      a clear message rather than emitting an empty SQL string.
   */
  const handleSaveChanges = useCallback(() => {
    setErrorMessage(null);

    // Validate — empty names / types
    for (const col of working) {
      if (!col.name.trim() || !col.type.trim()) {
        setErrorMessage(
          "Every column needs a non-empty name and type. Fix the highlighted rows or delete them before saving."
        );
        return;
      }
    }

    // Validate — duplicate final names
    const names = new Set<string>();
    for (const col of working) {
      const key = col.name.trim().toLowerCase();
      if (names.has(key)) {
        setErrorMessage(`Duplicate column name in the working list: "${col.name}".`);
        return;
      }
      names.add(key);
    }

    const stmts = buildAlterTableStatements(table, dialect, originals, working);

    // Filter out comment-only outputs when deciding "no-op". A SQLite type
    // change emits two -- WARNING comments and no real statement; if that's
    // the only thing in the list, we treat the diff as empty.
    const hasExecutable = stmts.some((s) => !s.trim().startsWith("--"));
    if (!hasExecutable) {
      setErrorMessage(
        "No changes to apply. Edit a column name/type, add a column, or delete a column."
      );
      return;
    }

    setAlterSql(stmts.join("\n"));
    setPhase("preview");
  }, [working, originals, table, dialect]);

  // ── Execute ───────────────────────────────────────────────────────────────

  /**
   * Confirms with the user and POSTs the generated SQL to /api/query.
   *
   * WHY a fresh fetch instead of reusing useQueryExecution:
   *   useQueryExecution writes its result into the active editor tab's
   *   loading/result/error slots. Running an ALTER from this dialog would
   *   silently clobber whatever the user is editing in their current tab.
   *   By calling /api/query directly we keep the side-effects local to the
   *   dialog (status display + history entry + schema refresh) and leave
   *   the editor untouched.
   *
   * WHY we still write to history:
   *   The user just performed a meaningful, irreversible operation. Even
   *   though we bypass the tab's result panel, the history sidebar should
   *   record the ALTER so the user can revisit it with the rest of their
   *   session activity.
   */
  const handleExecute = useCallback(async () => {
    if (!alterSql) return;

    const ok = window.confirm(
      "This will modify the table structure. This cannot be undone.\n\n" +
        "Make sure you have reviewed the SQL above before continuing."
    );
    if (!ok) return;

    setPhase("executing");
    setErrorMessage(null);
    setResultMessage(null);

    const startedAt = Date.now();
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: alterSql }),
      });
      const body = (await res.json()) as {
        error?: string;
        rowCount?: number;
        executionTime?: number;
        statementCount?: number;
        totalExecutionTime?: number;
      };
      const elapsed = Date.now() - startedAt;

      if (!res.ok || body.error) {
        const msg = body.error ?? `HTTP ${res.status}`;
        setErrorMessage(msg);
        setPhase("error");

        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          sql: alterSql,
          executedAt: new Date(),
          success: false,
        };
        addHistoryEntry(entry);
        return;
      }

      // Refresh the schema in the store so the sidebar tree (and any open
      // ColumnStats popover, etc.) reflects the new column list. We await
      // the refresh before flipping to "done" so the user, on close, sees
      // the new structure immediately.
      await refreshSchemaIntoStore();

      const stmtCount = body.statementCount ?? 1;
      const totalMs =
        body.totalExecutionTime ?? body.executionTime ?? elapsed;
      setResultMessage(
        `Applied ${stmtCount} statement${stmtCount === 1 ? "" : "s"} in ${Math.max(1, Math.round(totalMs))}ms.`
      );
      setPhase("done");

      // exactOptionalPropertyTypes forbids assigning `undefined` to optional
      // fields — splice rowCount/executionTime in only when actually present
      // so the resulting object matches HistoryEntry's strict shape.
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        sql: alterSql,
        executedAt: new Date(),
        success: true,
        ...(typeof body.rowCount === "number" ? { rowCount: body.rowCount } : {}),
        executionTime: totalMs,
      };
      addHistoryEntry(entry);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Network error — ALTER failed.";
      setErrorMessage(msg);
      setPhase("error");

      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        sql: alterSql,
        executedAt: new Date(),
        success: false,
      };
      addHistoryEntry(entry);
    }
  }, [alterSql, addHistoryEntry]);

  // ── Backdrop click ────────────────────────────────────────────────────────
  // Block the backdrop close while executing for the same reason Escape is
  // blocked above — half-applied state should never be a fast accident.
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget && phase !== "executing") onClose();
    },
    [phase, onClose]
  );

  // ── Derived: SQLite warning banner ────────────────────────────────────────
  // When the dialog is open against a SQLite database, surface the limitations
  // up front (rather than only showing them as comments in the generated SQL).
  // The banner gives the user a chance to back out before they invest time
  // editing fields they can't actually persist.
  const showSqliteWarning = useMemo(() => dialect === "sqlite", [dialect]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit structure of ${table}`}
        className="flex flex-col w-[min(820px,94vw)] h-[min(680px,88vh)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden"
      >
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#1f2033] shrink-0">
          <PencilIcon />
          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#fbbf24]">
            Edit Structure
          </span>
          <span className="text-[#374151]">·</span>
          <span className="text-[12px] font-mono text-[#ededf0] truncate max-w-[220px]">
            {table}
          </span>
          <span className="text-[#374151] text-[10px] font-mono">
            {dialect}
          </span>

          <div className="flex-1" />

          {/* Phase indicator dot — orient the user inside the two-step flow. */}
          <span
            className={[
              "text-[9px] font-semibold uppercase tracking-widest px-2 h-5 flex items-center rounded border",
              phase === "preview"
                ? "text-blue-400 border-blue-700/40 bg-blue-900/20"
                : phase === "done"
                ? "text-emerald-400 border-emerald-700/40 bg-emerald-900/20"
                : phase === "error"
                ? "text-red-400 border-red-700/40 bg-red-900/20"
                : "text-[#9ca3af] border-[#1f2033] bg-[#0f0f1a]",
            ].join(" ")}
          >
            {phase === "editing" && "Editing"}
            {phase === "preview" && "Preview"}
            {phase === "executing" && "Executing"}
            {phase === "done" && "Done"}
            {phase === "error" && "Error"}
          </span>

          {/* Close button — explicit ✕ for users who don't know about Escape. */}
          <button
            onClick={onClose}
            disabled={phase === "executing"}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-100"
            aria-label="Close table editor"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== BODY ===== */}
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* SQLite limitations banner — shown only on SQLite, in any phase. */}
          {showSqliteWarning && (
            <div className="shrink-0 px-3 py-2 border-b border-[#3a2d10] bg-[#1a1500] text-[10.5px] font-mono text-[#fbbf24]">
              SQLite limitation: only ADD COLUMN is universally supported. RENAME
              requires 3.25+, DROP requires 3.35+, and column TYPE changes need
              a full table recreation (not generated here).
            </div>
          )}

          {/* ── PHASE 1: EDITING ────────────────────────────────────────── */}
          {phase === "editing" && (
            <>
              {/* Section header — column counts and a quick orientation line. */}
              <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-[#4b5563]">
                  Columns
                </span>
                <span className="text-[9px] font-mono text-[#374151]">
                  {working.length} {working.length === 1 ? "column" : "columns"}
                </span>
              </div>

              {/* Column-grid header row — labels for the editor inputs below. */}
              <div className="flex items-center gap-2 px-4 pb-1 border-b border-[#1f2033]/50 shrink-0 text-[9px] uppercase tracking-wider text-[#374151]">
                <span className="w-[180px] shrink-0">Name</span>
                <span className="w-[160px] shrink-0">Type</span>
                <span className="flex-1 min-w-0">Flags</span>
                <span className="w-6 shrink-0" />
              </div>

              {/* Scrollable list of editable column rows. */}
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2">
                {working.map((col) => (
                  <ColumnEditorRow
                    key={col.id}
                    column={col}
                    onChange={(patch) => updateColumn(col.id, patch)}
                    onDelete={() => deleteColumn(col.id, col.name || "(unnamed)")}
                  />
                ))}

                {/* Add Column button — a full-width dashed-border target so
                    the affordance reads as "drop a new column here". */}
                <button
                  onClick={addColumn}
                  className="mt-2 flex items-center justify-center gap-1.5 w-full h-8 rounded border border-dashed border-[#2d2d3d] text-[10px] font-semibold uppercase tracking-wider text-[#4b5563] hover:text-[#34d399] hover:border-emerald-700/40 hover:bg-emerald-900/10 transition-colors duration-100 select-none"
                >
                  <PlusIcon />
                  <span>Add Column</span>
                </button>
              </div>
            </>
          )}

          {/* ── PHASE 2: PREVIEW ────────────────────────────────────────── */}
          {(phase === "preview" || phase === "executing" || phase === "done" || phase === "error") && (
            <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0">
                <span className="text-[9px] font-semibold uppercase tracking-widest text-[#4b5563]">
                  Generated SQL
                </span>
                <span className="text-[9px] font-mono text-[#374151]">
                  Review every statement before executing.
                </span>
              </div>

              {/* SQL preview — read-only <pre> so the user can select and
                  copy without any chance of edits leaking into execution.
                  whitespace-pre-wrap preserves line breaks but allows long
                  lines to soft-wrap inside the box. */}
              <div className="flex-1 min-h-0 px-4 pb-3 overflow-auto">
                <pre className="text-[12px] font-mono text-[#ededf0] bg-[#0d0d17] border border-[#1f2033] rounded p-3 whitespace-pre-wrap break-words leading-relaxed">
                  {alterSql}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* ===== FOOTER ===== */}
        <div className="flex items-center justify-between gap-3 px-4 h-11 border-t border-[#1f2033] shrink-0">
          {/* ── Status text — slot mirrors ImportPreview for visual consistency. ── */}
          <div className="flex-1 min-w-0 text-[11px] font-mono truncate">
            {phase === "editing" && errorMessage && (
              <span className="text-[#f87171]" title={errorMessage}>
                {errorMessage}
              </span>
            )}
            {phase === "editing" && !errorMessage && (
              <span className="text-[#4b5563]">
                Edit names and types, add or remove columns, then preview the SQL.
              </span>
            )}
            {phase === "preview" && (
              <span className="text-[#9ca3af]">
                Review the SQL. Click Execute to run it against {table}.
              </span>
            )}
            {phase === "executing" && (
              <span className="text-[#9ca3af]">Executing ALTER TABLE…</span>
            )}
            {phase === "done" && resultMessage && (
              <span className="text-[#34d399]">{resultMessage}</span>
            )}
            {phase === "error" && errorMessage && (
              <span className="text-[#f87171]" title={errorMessage}>
                {errorMessage}
              </span>
            )}
          </div>

          {/* ── Action buttons — change between phases. ───────────────────── */}
          <div className="flex items-center gap-2 shrink-0">
            {phase === "editing" && (
              <>
                <button
                  onClick={onClose}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] text-[#9ca3af] border border-[#2d2d3d] transition-colors duration-100 select-none"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveChanges}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-900/40 hover:bg-blue-800/50 text-blue-400 border border-blue-700/40 transition-colors duration-100 select-none"
                  title="Generate ALTER TABLE SQL"
                >
                  Save Changes
                </button>
              </>
            )}

            {phase === "preview" && (
              <>
                <button
                  onClick={() => {
                    setPhase("editing");
                    setAlterSql("");
                    setErrorMessage(null);
                  }}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] text-[#9ca3af] border border-[#2d2d3d] transition-colors duration-100 select-none"
                >
                  Back to Edit
                </button>
                <button
                  onClick={() => void handleExecute()}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-amber-900/40 hover:bg-amber-800/50 text-amber-400 border border-amber-700/40 transition-colors duration-100 select-none"
                  title="Run the ALTER TABLE statements"
                >
                  Execute
                </button>
              </>
            )}

            {phase === "executing" && (
              <button
                disabled
                className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-amber-900/30 text-amber-400/60 border border-amber-700/30 opacity-60 cursor-not-allowed select-none"
              >
                Executing…
              </button>
            )}

            {phase === "done" && (
              <button
                onClick={onClose}
                className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-emerald-900/40 hover:bg-emerald-800/50 text-emerald-400 border border-emerald-700/40 transition-colors duration-100 select-none"
              >
                Close
              </button>
            )}

            {phase === "error" && (
              <>
                <button
                  onClick={() => {
                    setPhase("editing");
                    setErrorMessage(null);
                  }}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-[#14142b] hover:bg-[#1c1c38] text-[#9ca3af] border border-[#2d2d3d] transition-colors duration-100 select-none"
                >
                  Back to Edit
                </button>
                <button
                  onClick={() => void handleExecute()}
                  className="flex items-center gap-1.5 px-3 h-6 text-[10px] font-semibold uppercase tracking-wider rounded bg-amber-900/40 hover:bg-amber-800/50 text-amber-400 border border-amber-700/40 transition-colors duration-100 select-none"
                  title="Retry executing the ALTER TABLE"
                >
                  Retry
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== SUB-COMPONENT: COLUMN EDITOR ROW =====

/**
 * One editable row in the editor's column list.
 *
 * Pulled into its own component to keep the parent's render readable and to
 * give React a clear memoization boundary if profiling ever shows the
 * working list re-rendering becomes a hot path.
 *
 * Layout matches the column-grid header in the parent:
 *   • Name input (180 px) — editable text input
 *   • Type input (160 px) — editable text input
 *   • Flags strip (flex-1) — read-only badges showing PK / FK / null / default / IX
 *   • Delete button (24 px)
 */
function ColumnEditorRow({
  column,
  onChange,
  onDelete,
}: {
  column: WorkingColumn;
  onChange: (patch: Partial<Pick<WorkingColumn, "name" | "type">>) => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={[
        "flex items-center gap-2 py-1.5 border-b border-[#1f2033]/40 last:border-b-0",
        column.isNew ? "bg-emerald-900/5" : "",
      ].join(" ")}
    >
      {/* ── Name input ────────────────────────────────────────────────────── */}
      <input
        value={column.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder={column.isNew ? "new_column" : "column name"}
        className="w-[180px] shrink-0 h-7 px-2 rounded border border-[#1f2033] bg-[#0d0d17] text-[11px] font-mono text-[#ededf0] placeholder:text-[#374151] focus:outline-none focus:border-blue-700/60"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      {/* ── Type input ────────────────────────────────────────────────────── */}
      <input
        value={column.type}
        onChange={(e) => onChange({ type: e.target.value })}
        placeholder="VARCHAR(255), INTEGER, …"
        className="w-[160px] shrink-0 h-7 px-2 rounded border border-[#1f2033] bg-[#0d0d17] text-[11px] font-mono text-[#9ca3af] placeholder:text-[#374151] focus:outline-none focus:border-blue-700/60"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />

      {/* ── Read-only flags strip ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1 flex-1 min-w-0 overflow-hidden">
        {column.isNew && (
          <span className="text-[9px] font-semibold uppercase tracking-wider px-1.5 h-4 flex items-center rounded bg-emerald-900/40 text-emerald-400 border border-emerald-700/40">
            New
          </span>
        )}
        {column.isPrimaryKey && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 h-4 flex items-center rounded bg-amber-900/30 text-amber-400 border border-amber-700/30"
            title="Primary key"
          >
            PK
          </span>
        )}
        {column.foreignKey && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 h-4 flex items-center rounded bg-blue-900/30 text-blue-400 border border-blue-700/30 truncate max-w-[160px]"
            title={`Foreign key → ${column.foreignKey.table}.${column.foreignKey.column}`}
          >
            FK→{column.foreignKey.table}.{column.foreignKey.column}
          </span>
        )}
        {column.isIndexed && (
          <span
            className="text-[9px] font-semibold uppercase tracking-wider px-1.5 h-4 flex items-center rounded bg-[#1a1a2e] text-[#9ca3af] border border-[#2d2d3d]"
            title="Indexed"
          >
            IX
          </span>
        )}
        <span
          className={[
            "text-[9px] font-semibold uppercase tracking-wider px-1.5 h-4 flex items-center rounded border",
            column.nullable
              ? "bg-[#0f0f1a] text-[#6b7280] border-[#2d2d3d]"
              : "bg-rose-900/20 text-rose-400 border-rose-700/30",
          ].join(" ")}
          title={column.nullable ? "NULLs allowed" : "NOT NULL"}
        >
          {column.nullable ? "NULL" : "NOT NULL"}
        </span>
        {column.defaultValue !== null && column.defaultValue !== undefined && (
          <span
            className="text-[9px] font-mono px-1.5 h-4 flex items-center rounded bg-[#0f0f1a] text-[#6b7280] border border-[#2d2d3d] truncate max-w-[120px]"
            title={`Default: ${column.defaultValue}`}
          >
            ={column.defaultValue}
          </span>
        )}
      </div>

      {/* ── Delete button ─────────────────────────────────────────────────── */}
      <button
        onClick={onDelete}
        className="shrink-0 flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#f87171] hover:bg-rose-900/20 transition-colors duration-100"
        aria-label={`Delete column ${column.name || "(unnamed)"}`}
        title="Delete column"
      >
        <TrashIcon />
      </button>
    </div>
  );
}
