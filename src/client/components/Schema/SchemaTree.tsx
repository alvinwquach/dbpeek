/**
 * src/client/components/Schema/SchemaTree.tsx
 *
 * ===== FILE PURPOSE =====
 * Left-sidebar tree that lists every table in the connected database, with
 * expandable column lists, type and key badges, a search input that filters
 * tables AND columns simultaneously, and a per-table preview button that
 * runs `SELECT * FROM table LIMIT 100`.
 *
 * Clicking any column opens a ColumnStats popover anchored to the clicked
 * row (rendered as a sibling component below).
 *
 * Right-clicking a table row opens a context menu with "Pin to top" and,
 * in write/full mode, "Import CSV/JSON". Pinned tables are hoisted into a
 * dedicated "Pinned" section above the main alphabetical list.
 *
 * ===== IMPORT WORKFLOW =====
 *
 * Two entry points trigger the ImportPreview dialog:
 *
 *   1. Drag-and-drop: the user drags a .csv or .json file over any table row.
 *      The row highlights (isDragOver) and on drop SchemaTree validates the
 *      file type then sets importTarget to open the dialog.
 *
 *   2. Context menu: the user right-clicks a table → "Import CSV/JSON".
 *      A hidden <input type="file"> is programmatically clicked. When the
 *      user picks a file, importTarget is set and the dialog opens.
 *
 * Both paths set `importTarget: { table: string; file: File } | null`.
 * When non-null, ImportPreview renders as a sibling at the SchemaTree root.
 *
 * PERMISSION GATE: both entry points are guarded by `canImport` (derived from
 * connectionInfo.mode === "write" || "full"). The context-menu handler is not
 * passed in readonly mode, the file input is never clicked, and the import
 * button on each TableRow is hidden via the `canImport` prop.
 *
 * ===== ARCHITECTURE =====
 *
 *   SchemaTree (this file)
 *     ├─ SearchInput              — controlled input bound to local searchTerm
 *     ├─ PinnedSection            — pinned tables hoisted above the main list
 *     │    └─ TableRow (pinned)   — same row; star icon replaces expand chevron
 *     ├─ TableRow (per table)
 *     │    ├─ collapse arrow      — toggles expandedTables Set
 *     │    ├─ table icon          — visual affordance only
 *     │    ├─ name                — bolds matching substring during search
 *     │    ├─ row-count badge     — pulled from store.schemaRowCounts
 *     │    ├─ preview button      — fires onPreview('SELECT * FROM <t> LIMIT 100')
 *     │    ├─ DDL button          — opens DdlViewer modal
 *     │    └─ import button       — hidden in readonly; triggers file picker
 *     └─ ColumnRow (per column when its table is expanded)
 *          ├─ type badge          — short type label (varchar, int, timestamp, ...)
 *          ├─ column name
 *          └─ PK / FK / IX badges
 *          (clicking the row opens a ColumnStats popover for that column)
 *
 *   ContextMenu — right-click menu (pin/unpin + import in write/full mode)
 *   ImportPreview — CSV/JSON import dialog (rendered as a sibling)
 *   DdlViewer     — CREATE TABLE DDL modal (rendered as a sibling)
 *   ColumnStats   — column statistics popover (rendered as a sibling)
 *
 * ===== STATE MODEL =====
 *
 *   searchTerm: string                       — controlled input
 *   expandedTables: Set<string>              — which tables are open
 *   selectedColumn: { table, column, rect }  — currently inspected column
 *   contextMenu: { table, x, y }             — currently open context menu
 *   dragOverTable: string | null             — table being dragged over
 *   importTarget: { table, file } | null     — file + table for ImportPreview
 *   fileInputTable: string | null            — table targeted by file picker
 *
 *   pinnedTables: Set<string>  →  lives in Zustand (store.pinnedTables)
 *
 * ===== SEARCH SEMANTICS =====
 *
 *   A table is shown if EITHER its name matches OR any of its columns matches.
 *   When a table is shown because of a column match, that table is auto-
 *   expanded so the matching column is visible without an extra click.
 *
 * ===== PROPS =====
 *
 *   onPreview: (sql: string) => void
 *     Wired up to App.tsx's `execute` from useQueryExecution.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { useAppStore } from "../../stores/app";
import type { ColumnInfo } from "../../hooks/useSchema";
import { ColumnStats } from "./ColumnStats";
import { DdlViewer } from "./DdlViewer";
import { SearchInput } from "./tree/SearchInput";
import { TableRow } from "./tree/TableRow";
import { ContextMenu } from "./tree/ContextMenu";
import { ErdIcon } from "./tree/icons";
import { ImportPreview } from "../Import/ImportPreview";

// ===== TYPES =====

/** Anchor data for the currently-open column stats popover. */
interface ColumnAnchor {
  /** Table name the column belongs to. Identifies the stats query. */
  table: string;
  /** Column name. Identifies the stats query. */
  column: string;
  /** Rich column metadata, used by the popover to label numeric vs. string. */
  info: ColumnInfo;
  /**
   * The bounding rectangle of the clicked column row at the moment of click.
   * The popover positions itself relative to this rect (top-aligned, just
   * outside the right edge of the sidebar).
   */
  rect: DOMRect;
}

/**
 * Position + target for the right-click context menu on a table row.
 *
 * WHY store viewport x/y rather than a DOMRect:
 *   The context menu is fixed-positioned at the cursor location — we want it
 *   at the pointer tip, not at the row's bounding box edge.
 */
interface ContextMenuState {
  table: string;
  x: number;
  y: number;
}

/**
 * The table + file that ImportPreview is currently operating on.
 * Null when the dialog is closed.
 */
interface ImportTarget {
  table: string;
  file: File;
}

/** Props for the top-level SchemaTree component. */
interface SchemaTreeProps {
  /**
   * Called with a generated SQL string when the user clicks the preview icon
   * on a table row. The current contract is `SELECT * FROM <table> LIMIT 100`.
   */
  onPreview: (sql: string) => void;
}

// ===== HELPERS =====

/**
 * Returns true if the file extension is .csv or .json.
 * Used to decide whether a dropped file should open ImportPreview.
 *
 * WHY check extension (not MIME type):
 *   Browsers report inconsistent MIME types for CSV ("text/csv", "text/plain",
 *   "application/csv"). Extension-based detection is more reliable for the
 *   two formats we support. The actual parse step rejects unsupported formats
 *   with a clear error message anyway.
 */
function isImportableFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "csv" || ext === "json";
}

/**
 * Decides whether `text` contains `needle` (case-insensitive substring).
 *
 * WHY a dedicated helper:
 *   The match logic shows up at three call sites (table name match, column
 *   name match, did-anything-match check). Centralizing it keeps the case-
 *   insensitivity rule in one place.
 */
function matchesSearch(text: string, needle: string): boolean {
  if (needle === "") return true;
  return text.toLowerCase().includes(needle.toLowerCase());
}

// ===== MAIN COMPONENT =====

/**
 * SchemaTree — left-sidebar database explorer.
 *
 * WHY this component is responsible for the popovers and modals too:
 *   The popover anchors to a column row, the import dialog anchors to a table
 *   row, and the context menu appears at a cursor position — all inside this
 *   tree. Lifting them to App.tsx would force state to thread back through
 *   props. Owning them here keeps each feature's data flow local.
 */
export function SchemaTree({ onPreview }: SchemaTreeProps) {
  // ── Store reads ────────────────────────────────────────────────────────────
  const schemaMap = useAppStore((s) => s.schemaMap);
  const schemaColumns = useAppStore((s) => s.schemaColumns);
  const schemaRowCounts = useAppStore((s) => s.schemaRowCounts);
  const schemaLoading = useAppStore((s) => s.schemaLoading);
  const schemaError = useAppStore((s) => s.schemaError);
  const connectionInfo = useAppStore((s) => s.connectionInfo);

  // ── Pin state from store ───────────────────────────────────────────────────
  const pinnedTables = useAppStore((s) => s.pinnedTables);
  const pinTable = useAppStore((s) => s.pinTable);
  const unpinTable = useAppStore((s) => s.unpinTable);

  // ── ERD state ─────────────────────────────────────────────────────────────
  const toggleErd = useAppStore((s) => s.toggleErd);

  // ── ERD → sidebar focus ───────────────────────────────────────────────────
  const sidebarFocusTable = useAppStore((s) => s.sidebarFocusTable);
  const setSidebarFocusTable = useAppStore((s) => s.setSidebarFocusTable);

  // ── Permission check ───────────────────────────────────────────────────────
  //
  // canImport is true when the server was started in --write or --full mode.
  // All import entry points (drag-drop, context menu, import button) check
  // this flag before proceeding — the client provides a fast-fail hint rather
  // than forcing the user to attempt an action that results in a 403.
  const canImport =
    connectionInfo?.mode === "write" || connectionInfo?.mode === "full";

  // ── Local state ────────────────────────────────────────────────────────────

  const [searchTerm, setSearchTerm] = useState("");

  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  const [selectedColumn, setSelectedColumn] = useState<ColumnAnchor | null>(null);

  const [ddlTable, setDdlTable] = useState<string | null>(null);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /**
   * The table name currently being dragged over, or null.
   *
   * WHY a single string in SchemaTree (not per-row boolean):
   *   Only one table row can be the drag target at any instant. Tracking it
   *   here ensures exactly one row has the "drop target" highlight. If each
   *   TableRow tracked its own state, moving from row A to B could briefly
   *   leave both highlighted (A's dragLeave fires after B's dragEnter).
   */
  const [dragOverTable, setDragOverTable] = useState<string | null>(null);

  /**
   * File + table that ImportPreview is operating on.
   * Null → dialog is closed. Non-null → dialog is open.
   */
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);

  /**
   * Table targeted by the hidden file-input picker (context menu / button path).
   * Set before programmatically clicking the input; read in the onChange handler
   * to know which table the picked file belongs to.
   */
  const [fileInputTable, setFileInputTable] = useState<string | null>(null);

  /**
   * Ref for the hidden <input type="file"> element.
   *
   * WHY a hidden input rather than a Radix dialog with a file input:
   *   The OS file-picker must be triggered by a user gesture (click). Attaching
   *   a real hidden input and calling .click() on it in a mouse-event handler
   *   satisfies that requirement across all browsers. A synthetic approach
   *   (e.g. dispatching a click event programmatically without user interaction)
   *   would be blocked by modern browsers.
   */
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── ERD → sidebar focus effect ────────────────────────────────────────────
  useEffect(() => {
    if (!sidebarFocusTable) return;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.add(sidebarFocusTable);
      return next;
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(`schema-table-${CSS.escape(sidebarFocusTable)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    setSidebarFocusTable(null);
  }, [sidebarFocusTable, setSidebarFocusTable]);

  // ── Derived: table filter helper ──────────────────────────────────────────

  /**
   * Given a table name and its columns, returns a filtered entry or null.
   * Factored out so both filteredTables and filteredPinnedTables use identical
   * logic — a single point of change if the search strategy changes.
   */
  const buildTableEntry = useCallback(
    (name: string, cols: ColumnInfo[], trimmed: string) => {
      const tableMatch = matchesSearch(name, trimmed);
      const columnMatch =
        trimmed !== "" && cols.some((c) => matchesSearch(c.name, trimmed));
      if (trimmed !== "" && !tableMatch && !columnMatch) return null;
      return {
        name,
        columns: cols,
        autoExpand: trimmed !== "" && columnMatch && !tableMatch,
      };
    },
    []
  );

  /** All non-pinned tables, filtered and sorted alphabetically. */
  const filteredTables = useMemo(() => {
    if (schemaMap == null || schemaColumns == null) return [];
    const tableNames = Object.keys(schemaMap).sort((a, b) => a.localeCompare(b));
    const trimmed = searchTerm.trim();
    return tableNames
      .filter((name) => !pinnedTables.has(name))
      .map((name) => buildTableEntry(name, schemaColumns[name] ?? [], trimmed))
      .filter((t): t is { name: string; columns: ColumnInfo[]; autoExpand: boolean } => t != null);
  }, [schemaMap, schemaColumns, searchTerm, pinnedTables, buildTableEntry]);

  /** Pinned tables only, filtered and sorted alphabetically. */
  const filteredPinnedTables = useMemo(() => {
    if (schemaMap == null || schemaColumns == null) return [];
    const trimmed = searchTerm.trim();
    return Array.from(pinnedTables)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        if (!(name in schemaMap)) return null;
        return buildTableEntry(name, schemaColumns[name] ?? [], trimmed);
      })
      .filter((t): t is { name: string; columns: ColumnInfo[]; autoExpand: boolean } => t != null);
  }, [schemaMap, schemaColumns, searchTerm, pinnedTables, buildTableEntry]);

  // ── Standard handlers ─────────────────────────────────────────────────────

  const toggleExpand = useCallback((tableName: string) => {
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(tableName)) {
        next.delete(tableName);
      } else {
        next.add(tableName);
      }
      return next;
    });
  }, []);

  const handlePreviewClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.stopPropagation();
      onPreview(`SELECT * FROM ${tableName} LIMIT 100`);
    },
    [onPreview]
  );

  const handleDdlClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.stopPropagation();
      setDdlTable(tableName);
    },
    []
  );

  const closeDdlViewer = useCallback(() => setDdlTable(null), []);

  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, table: string, info: ColumnInfo) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setSelectedColumn((prev) => {
        if (prev && prev.table === table && prev.column === info.name) return null;
        return { table, column: info.name, info, rect };
      });
    },
    []
  );

  const closePopover = useCallback(() => setSelectedColumn(null), []);

  // ── Context menu handlers ──────────────────────────────────────────────────

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ table: tableName, x: e.clientX, y: e.clientY });
    },
    []
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const handlePinToggle = useCallback(
    (tableName: string) => {
      if (pinnedTables.has(tableName)) {
        unpinTable(tableName);
      } else {
        pinTable(tableName);
      }
      closeContextMenu();
    },
    [pinnedTables, pinTable, unpinTable, closeContextMenu]
  );

  const handleUnpinClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.stopPropagation();
      unpinTable(tableName);
    },
    [unpinTable]
  );

  // ── Import: drag-and-drop handlers ────────────────────────────────────────

  /**
   * Fires while a drag item is over this specific table's row header.
   * Must call preventDefault() to tell the browser this is a valid drop target.
   * Without it, the browser shows a "no-drop" cursor and onDrop never fires.
   */
  const handleDragOver = useCallback((e: React.DragEvent, tableName: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTable(tableName);
  }, []);

  /**
   * Fires when the drag cursor leaves the row header element.
   * Clears the drop-target highlight for this row.
   *
   * WHY no relatedTarget check:
   *   We attach drag handlers only to the 24 px header div, not to the column
   *   list below. Moving within the header doesn't trigger dragLeave; leaving
   *   the header div clears the highlight. No flickering in practice.
   */
  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    setDragOverTable(null);
  }, []);

  /**
   * Fires when a file is dropped on a table row header.
   * Validates the file type and, if valid and in write/full mode, opens
   * ImportPreview with the dropped file and target table name.
   */
  const handleDrop = useCallback(
    (e: React.DragEvent, tableName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverTable(null);

      if (!canImport) return;

      const files = Array.from(e.dataTransfer.files);
      const importable = files.find(isImportableFile);
      if (!importable) return;

      setImportTarget({ table: tableName, file: importable });
    },
    [canImport]
  );

  // ── Import: file-picker path (context menu / import button) ───────────────

  /**
   * Triggered by the "Import CSV/JSON" context menu item or the import icon
   * button on a table row. Records the target table, then programmatically
   * clicks the hidden file input to open the OS file picker.
   *
   * WHY not open ImportPreview directly here:
   *   ImportPreview needs a File object, which we only have after the user
   *   selects one. We store the table name now, then attach it to the file in
   *   handleFileInputChange once the user confirms their selection.
   */
  const handleImportClick = useCallback((tableName: string) => {
    setFileInputTable(tableName);
    fileInputRef.current?.click();
  }, []);

  /**
   * Fires when the user selects a file via the OS picker.
   * Opens ImportPreview with the selected file and the previously-recorded table.
   */
  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && fileInputTable) {
        setImportTarget({ table: fileInputTable, file });
      }
      // Reset so the same file can be picked again next time (onChange only
      // fires when the value actually changes; clearing it ensures a re-pick).
      e.target.value = "";
      setFileInputTable(null);
    },
    [fileInputTable]
  );

  /** Closes the ImportPreview dialog. */
  const closeImport = useCallback(() => setImportTarget(null), []);

  // ── Shared TableRow props factory ─────────────────────────────────────────
  //
  // Most TableRow props are the same between the pinned and non-pinned lists.
  // Factoring them into a function avoids repeating the prop spread twice.
  // The result is passed as a spread onto each <TableRow />.

  /**
   * Builds the complete prop set for one TableRow, shared between the pinned
   * section and the main table list.
   */
  function makeTableRowProps(
    name: string,
    columns: ColumnInfo[],
    rowCount: number | undefined,
    isExpanded: boolean
  ) {
    return {
      name,
      columns,
      rowCount,
      isExpanded,
      searchTerm: searchTerm.trim(),
      isPinned: pinnedTables.has(name),
      selectedColumn:
        selectedColumn && selectedColumn.table === name
          ? selectedColumn.column
          : null,
      isDragOver: dragOverTable === name,
      canImport,
      onToggleExpand: () => toggleExpand(name),
      onPreviewClick: (e: React.MouseEvent) => handlePreviewClick(e, name),
      onDdlClick: (e: React.MouseEvent) => handleDdlClick(e, name),
      onColumnClick: (e: React.MouseEvent<HTMLButtonElement>, info: ColumnInfo) =>
        handleColumnClick(e, name, info),
      onContextMenu: (e: React.MouseEvent) => handleContextMenu(e, name),
      onUnpinClick: (e: React.MouseEvent) => handleUnpinClick(e, name),
      onDragOver: (e: React.DragEvent) => handleDragOver(e, name),
      onDragLeave: handleDragLeave,
      onDrop: (e: React.DragEvent) => handleDrop(e, name),
      ...(canImport
        ? { onImportClick: (_e: React.MouseEvent) => handleImportClick(name) }
        : {}),
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ===== HEADER (label + ERD button + table count) ===== */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2033] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4b5563]">
          Schema
        </span>
        <div className="flex items-center gap-2">
          {schemaMap != null && Object.keys(schemaMap).length > 0 && (
            <button
              onClick={toggleErd}
              className="flex items-center gap-1 px-1.5 h-4 rounded border border-[#1f2033] text-[8.5px] font-mono uppercase tracking-wider text-[#4b5563] hover:text-[#ededf0] hover:border-[#3b4070] hover:bg-[#14142b] transition-colors duration-100 select-none"
              title="Open Entity Relationship Diagram"
              aria-label="Open ERD"
            >
              <ErdIcon />
              <span>ERD</span>
            </button>
          )}
          {schemaMap != null && (
            <span className="text-[9px] font-mono text-[#374151]">
              {Object.keys(schemaMap).length}{" "}
              {Object.keys(schemaMap).length === 1 ? "table" : "tables"}
            </span>
          )}
        </div>
      </div>

      {/* ===== SEARCH INPUT ===== */}
      <SearchInput value={searchTerm} onChange={setSearchTerm} />

      {/* ===== BODY ===== */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {schemaLoading && (
          <div className="px-3 py-4 text-[11px] italic text-[#374151] font-mono">
            Loading schema…
          </div>
        )}

        {!schemaLoading && schemaError && (
          <div className="m-2 p-2 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-[10px] font-mono break-words">
            {schemaError}
          </div>
        )}

        {!schemaLoading && !schemaError && schemaMap != null &&
          Object.keys(schemaMap).length === 0 && (
            <div className="px-3 py-4 text-[11px] italic text-[#2d3047]">
              No tables in this database.
            </div>
          )}

        {!schemaLoading && !schemaError && schemaMap != null &&
          Object.keys(schemaMap).length > 0 &&
          filteredTables.length === 0 && filteredPinnedTables.length === 0 && (
            <div className="px-3 py-4 text-[11px] italic text-[#2d3047]">
              No matches for &quot;{searchTerm}&quot;.
            </div>
          )}

        {/* ===== PINNED SECTION ===== */}
        {filteredPinnedTables.length > 0 && (
          <>
            <div className="flex items-center px-3 pt-2 pb-1 border-b border-[#1f2033]">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-[#f59e0b] opacity-70">
                Pinned
              </span>
            </div>
            <ul className="py-1" role="tree" aria-label="Pinned tables">
              {filteredPinnedTables.map(({ name, columns, autoExpand }) => {
                const isExpanded = autoExpand || expandedTables.has(name);
                const rowCount = schemaRowCounts?.[name];
                return (
                  <TableRow
                    key={`pinned-${name}`}
                    {...makeTableRowProps(name, columns, rowCount, isExpanded)}
                    isPinned
                  />
                );
              })}
            </ul>
            <div className="border-b border-[#1f2033] mx-2 mb-1" />
          </>
        )}

        {/* ===== MAIN TABLE LIST ===== */}
        {filteredTables.length > 0 && (
          <ul className="py-1" role="tree" aria-label="Database tables">
            {filteredTables.map(({ name, columns, autoExpand }) => {
              const isExpanded = autoExpand || expandedTables.has(name);
              const rowCount = schemaRowCounts?.[name];
              return (
                <TableRow
                  key={name}
                  {...makeTableRowProps(name, columns, rowCount, isExpanded)}
                  isPinned={false}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* ===== COLUMN STATS POPOVER ===== */}
      {/*
        Rendered as a sibling so it can use fixed positioning without being
        clipped by the sidebar's overflow-y-auto.
      */}
      {selectedColumn && (
        <ColumnStats
          table={selectedColumn.table}
          column={selectedColumn.column}
          info={selectedColumn.info}
          anchor={selectedColumn.rect}
          onClose={closePopover}
        />
      )}

      {/* ===== DDL VIEWER MODAL ===== */}
      {ddlTable && (
        <DdlViewer table={ddlTable} onClose={closeDdlViewer} />
      )}

      {/* ===== CONTEXT MENU ===== */}
      {/*
        onImport is passed only when canImport is true — in readonly mode the
        "Import CSV/JSON" item is absent from the menu entirely.
      */}
      {contextMenu && (
        <ContextMenu
          table={contextMenu.table}
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={pinnedTables.has(contextMenu.table)}
          onPinToggle={() => handlePinToggle(contextMenu.table)}
          onClose={closeContextMenu}
          {...(canImport
            ? { onImport: () => handleImportClick(contextMenu.table) }
            : {})}
        />
      )}

      {/* ===== IMPORT PREVIEW MODAL ===== */}
      {/*
        Conditionally rendered — mount only when a file + table are chosen so
        ImportPreview's parse effect fires exactly once per import session.
        tableColumns falls back to [] if the schema hasn't loaded yet (should
        never happen in practice since the user had to click a table row).
      */}
      {importTarget && (
        <ImportPreview
          table={importTarget.table}
          file={importTarget.file}
          tableColumns={schemaColumns?.[importTarget.table] ?? []}
          onClose={closeImport}
        />
      )}

      {/* ===== HIDDEN FILE INPUT ===== */}
      {/*
        Used by the context menu "Import CSV/JSON" item and the per-row import
        icon button. SchemaTree calls fileInputRef.current.click() when those
        UI elements are activated, which opens the OS file picker. The input
        itself is invisible — zero size, no tab stop, positioned off-screen.

        WHY accept=".csv,.json":
          Restricts the OS picker to show only CSV and JSON files by default.
          The user can still override to "All Files" if needed; this is just
          a hint to make the picker less cluttered.
      */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.json"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={handleFileInputChange}
      />
    </div>
  );
}
