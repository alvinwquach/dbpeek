/**
 * src/client/components/Schema/tree/TableRow.tsx
 *
 * ===== FILE PURPOSE =====
 * One table entry in the SchemaTree, with its (conditionally rendered) columns.
 *
 * WHY this is a sub-component instead of inline JSX in SchemaTree:
 *   Separating it lets the parent map() stay flat and keeps the per-row
 *   keyboard / click logic local. It also makes the React.memo optimization
 *   trivial to add later if needed (a table row only needs to re-render when
 *   its own props change — not when a sibling table is expanded).
 *
 * ===== DRAG-AND-DROP (CSV / JSON IMPORT) =====
 *
 *   When the user drags a .csv or .json file over a table row, SchemaTree sets
 *   `isDragOver={true}` for that specific row, giving it a blue-tinted
 *   highlight so the user knows which table will receive the file. On drop,
 *   SchemaTree validates the file type and opens ImportPreview.
 *
 *   WHY drag state lives in SchemaTree (not here):
 *     Only one table can be "hovered" at a time. If each TableRow tracked its
 *     own isDragOver state, switching from table A to table B would leave A
 *     highlighted until its onDragLeave fires — causing a brief double-highlight.
 *     SchemaTree owns a single `dragOverTable: string | null` and passes it
 *     down as `isDragOver={dragOverTable === name}`, so exactly one row is
 *     highlighted at any instant.
 *
 * ===== DEPENDENCIES =====
 *   ../../../hooks/useSchema — ColumnInfo type
 *   ./icons                  — ChevronIcon, TableIcon, PreviewIcon, DdlIcon,
 *                              StarFilledIcon, ImportIcon
 *   ./ColumnRow              — ColumnRow component
 */

import type { ColumnInfo } from "../../../hooks/useSchema";
import {
  ChevronIcon,
  TableIcon,
  PreviewIcon,
  DdlIcon,
  StarFilledIcon,
  ImportIcon,
  EditIcon,
} from "./icons";
import { ColumnRow } from "./ColumnRow";

// ===== HELPER: row count formatter =====

/**
 * Formats a row count for the tight badge slot.
 *
 *   < 1_000         → "42"
 *   < 1_000_000     → "12.3k"
 *   < 1_000_000_000 → "4.5M"
 *   else            → "1.2B"
 *
 * WHY abbreviate at all:
 *   The badge sits next to the table name in a 244 px sidebar. A row count
 *   like "1,234,567,890" would crowd out the name. Abbreviation gives the
 *   user a magnitude at a glance; the title attribute provides the exact
 *   value on hover for the rare case it matters.
 */
export function formatRowCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

// ===== TABLE ROW =====

/**
 * TableRow — one table in the tree, with its (conditionally rendered) columns.
 *
 * Renders the collapse chevron (or star for pinned rows), table icon, table name,
 * row-count badge, and the preview + DDL + import action buttons. When expanded,
 * renders a ColumnRow for each visible column.
 *
 * The `id` attribute on the <li> element is used by SchemaTree's sidebarFocusTable
 * scroll effect: when the user clicks a node in the ERD, SchemaTree calls
 * scrollIntoView on `document.getElementById("schema-table-{name}")` to bring
 * the table into view after the ERD closes.
 *
 * @param name            Table name as it appears in the database.
 * @param columns         Full column metadata for this table.
 * @param rowCount        Estimated row count (undefined if not reported by server).
 * @param isExpanded      Whether the column list is currently shown.
 * @param searchTerm      Active search string; used to filter visible columns.
 * @param isPinned        True when rendering inside the Pinned section.
 * @param selectedColumn  Name of the column whose stats popover is open, or null.
 * @param isDragOver      True when a file is being dragged over this row.
 *                        Triggers a blue-tinted drop-target highlight.
 * @param canImport       True when the server is in write or full mode.
 *                        When false, the import hover-button is hidden.
 * @param canEditStructure True when the server is in --full mode.
 *                        When false, the Edit Structure pencil button is hidden.
 *                        Stricter than canImport because ALTER TABLE is a DDL
 *                        operation that can break things in irreversible ways.
 * @param onToggleExpand  Called when the row header is clicked.
 * @param onPreviewClick  Called when the preview (eye) icon is clicked.
 * @param onDdlClick      Called when the DDL (brackets) icon is clicked.
 * @param onColumnClick   Called with the column ColumnInfo when a column row is clicked.
 * @param onContextMenu   Called when the row is right-clicked.
 * @param onUnpinClick    Called when the star icon on a pinned row is clicked.
 * @param onDragOver      Called when a drag enters or moves over this row header.
 *                        Must call e.preventDefault() to signal drop acceptance.
 * @param onDragLeave     Called when the drag cursor leaves this row header.
 * @param onDrop          Called when a file is dropped on this row header.
 * @param onImportClick   Called when the import (upload) icon button is clicked.
 *                        Triggers the file-picker in SchemaTree. Only present when
 *                        canImport is true.
 * @param onEditStructureClick Called when the Edit Structure (pencil) icon
 *                        button is clicked. Opens the TableEditor dialog in
 *                        SchemaTree. Only present when canEditStructure is true.
 */
export function TableRow({
  name,
  columns,
  rowCount,
  isExpanded,
  searchTerm,
  isPinned,
  selectedColumn,
  isDragOver,
  canImport,
  canEditStructure,
  onToggleExpand,
  onPreviewClick,
  onDdlClick,
  onColumnClick,
  onContextMenu,
  onUnpinClick,
  onDragOver,
  onDragLeave,
  onDrop,
  onImportClick,
  onEditStructureClick,
}: {
  name: string;
  columns: ColumnInfo[];
  rowCount: number | undefined;
  isExpanded: boolean;
  searchTerm: string;
  /**
   * True when this row is rendering inside the Pinned section.
   * Controls whether the leading icon is a chevron (normal) or a filled
   * star (pinned). The star doubles as the unpin button.
   */
  isPinned: boolean;
  /** Name of the column whose stats popover is open, or null. */
  selectedColumn: string | null;
  /**
   * True while a .csv or .json file is being dragged directly over this row.
   * Renders a blue-tinted background and border ring to communicate "drop here".
   * Managed by SchemaTree to ensure only one row is highlighted at a time.
   */
  isDragOver: boolean;
  /**
   * True when the server was started in --write or --full mode.
   * The import button (and context-menu option) are hidden in --readonly mode
   * so the user isn't offered an action that will result in a 403.
   */
  canImport: boolean;
  /**
   * True ONLY when the server was started in --full mode.
   * The Edit Structure pencil button is hidden in --readonly and --write
   * because ALTER TABLE is DDL and the validateQuery permission gate
   * rejects it in any mode below full. Surfacing the affordance only when
   * it can actually succeed avoids an action that always 403s.
   */
  canEditStructure: boolean;
  onToggleExpand: () => void;
  onPreviewClick: (e: React.MouseEvent) => void;
  /** Opens the DDL viewer modal for this table. */
  onDdlClick: (e: React.MouseEvent) => void;
  onColumnClick: (e: React.MouseEvent<HTMLButtonElement>, info: ColumnInfo) => void;
  /** Opens the right-click context menu at the cursor position. */
  onContextMenu: (e: React.MouseEvent) => void;
  /**
   * Called when the user clicks the star icon on a pinned row to remove it
   * from the pinned set. Only invoked when isPinned is true.
   */
  onUnpinClick: (e: React.MouseEvent) => void;
  /**
   * Called when a file drag enters or moves over the row header element.
   * SchemaTree passes `e.preventDefault()` here to signal this is a valid
   * drop target — without it the browser shows a "no-drop" cursor and
   * onDrop never fires.
   */
  onDragOver: (e: React.DragEvent) => void;
  /**
   * Called when the drag cursor leaves the row header.
   * SchemaTree uses this to clear the `dragOverTable` state and remove the
   * highlight from this row.
   */
  onDragLeave: (e: React.DragEvent) => void;
  /**
   * Called when a file is dropped on the row header.
   * SchemaTree validates the file type (.csv / .json) and, if valid, opens
   * ImportPreview with the dropped file pre-loaded.
   */
  onDrop: (e: React.DragEvent) => void;
  /**
   * Optional. When provided, clicking the import icon button calls this
   * handler so SchemaTree can trigger a hidden <input type="file"> picker.
   * Only rendered when canImport is true.
   */
  onImportClick?: (e: React.MouseEvent) => void;
  /**
   * Optional. When provided, clicking the Edit Structure pencil button calls
   * this handler so SchemaTree can open the TableEditor dialog. Only rendered
   * when canEditStructure is true (i.e. server is in --full mode).
   */
  onEditStructureClick?: (e: React.MouseEvent) => void;
}) {
  // Filter columns when searching. We only narrow if the table name DIDN'T
  // match — otherwise show all columns (the user opened the table to browse,
  // not to find a needle).
  const tableNameMatched =
    searchTerm === "" ||
    name.toLowerCase().includes(searchTerm.toLowerCase());
  const visibleColumns =
    tableNameMatched
      ? columns
      : columns.filter((c) =>
          c.name.toLowerCase().includes(searchTerm.toLowerCase())
        );

  return (
    /*
     * id="schema-table-{name}" is used by the ERD → sidebar navigation: when
     * a user clicks a node in ErdView, SchemaTree's sidebarFocusTable effect
     * calls scrollIntoView on this element to bring it into view.
     */
    <li id={`schema-table-${name}`} role="treeitem" aria-expanded={isExpanded}>
      {/* ===== TABLE HEADER ROW ===== */}
      {/*
        The header row is also the drag-and-drop zone. When a file is dragged
        over it, `isDragOver` is true and the row receives a blue-tinted
        background + an inset ring so it reads as "drop zone" without
        being visually aggressive.

        WHY drag handlers are on the header div (not the <li>):
          The <li> also contains the column list when expanded. Attaching drag
          events to the <li> would fire dragLeave when the cursor moves into
          the column list, causing the highlight to flicker off. Targeting only
          the 24 px header row prevents that: the drop zone is exactly the
          element the user sees as "the table".
      */}
      <div
        onClick={onToggleExpand}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        // role=button + keyboard handler so this is reachable by keyboard users.
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className={[
          "group flex items-center gap-1.5 px-2 h-6 cursor-pointer select-none transition-colors duration-75",
          isDragOver
            ? // Visual drop-target: blue-tinted background + subtle inset ring.
              // ring-inset keeps the ring inside the element so it doesn't
              // overlap adjacent rows and cause layout shift.
              "bg-[#0d1829] ring-1 ring-inset ring-blue-500/40"
            : "hover:bg-[#0f0f1a]",
        ].join(" ")}
        title={isDragOver ? `Drop to import into ${name}` : `Toggle ${name}`}
      >
        {/*
          Leading icon:
          - Pinned rows show a filled amber star that doubles as the unpin
            button. The star is always visible (not hover-gated) because it's
            the primary affordance for "this is pinned — click to remove".
          - Normal rows show the collapse chevron as before.
        */}
        {isPinned ? (
          <button
            onClick={onUnpinClick}
            className="shrink-0 flex items-center justify-center w-4 h-4 rounded text-[#f59e0b] hover:text-[#fbbf24] hover:bg-[#1a1400] transition-colors duration-100"
            aria-label={`Unpin ${name}`}
            title={`Unpin ${name}`}
          >
            <StarFilledIcon />
          </button>
        ) : (
          <ChevronIcon open={isExpanded} />
        )}
        <TableIcon />

        {/* Table name. truncate clips long names; min-w-0 lets flex shrink it. */}
        <span className="flex-1 min-w-0 truncate text-[11px] text-[#ededf0] font-mono">
          {name}
        </span>

        {/* Row-count badge. Hidden when undefined (server didn't report it). */}
        {rowCount !== undefined && (
          <span
            className="shrink-0 text-[9px] font-mono text-[#4b5563] tabular-nums"
            title={`${rowCount.toLocaleString()} ${rowCount === 1 ? "row" : "rows"} (estimated)`}
          >
            {formatRowCount(rowCount)}
          </span>
        )}

        {/* Preview button. opacity-0 + group-hover:opacity-100 fades it in
            on row hover so the row isn't visually noisy when idle. */}
        <button
          onClick={onPreviewClick}
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-[#4b5563] hover:text-[#7c85d6] hover:bg-[#14142b] opacity-0 group-hover:opacity-100 transition-opacity duration-100"
          aria-label={`Preview ${name}`}
          title={`Preview: SELECT * FROM ${name} LIMIT 100`}
        >
          <PreviewIcon />
        </button>

        {/* Show DDL button. Same hover-reveal treatment as the preview button
            to keep the row tidy when idle. The two action buttons sit next to
            each other on the right edge, after the row-count badge. */}
        <button
          onClick={onDdlClick}
          className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-[#4b5563] hover:text-[#7c85d6] hover:bg-[#14142b] opacity-0 group-hover:opacity-100 transition-opacity duration-100"
          aria-label={`Show DDL for ${name}`}
          title={`Show DDL for ${name}`}
        >
          <DdlIcon />
        </button>

        {/* ── Import button (write/full mode only) ──────────────────────────
            Hidden in readonly mode (canImport = false) because the operation
            will result in a 403 anyway — no point offering it.

            Hover-reveal like preview and DDL. Slightly greener tint on hover
            to distinguish the "add data" semantic from the "view" buttons.

            WHY stopPropagation on onClick:
              The button sits inside the row container whose onClick toggles
              the expand state. Without stopPropagation, clicking the import
              button would ALSO toggle the row — unexpected side-effect.
        */}
        {canImport && onImportClick && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onImportClick(e);
            }}
            className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-[#4b5563] hover:text-[#34d399] hover:bg-[#0a1f14] opacity-0 group-hover:opacity-100 transition-opacity duration-100"
            aria-label={`Import CSV/JSON into ${name}`}
            title={`Import CSV or JSON into ${name}`}
          >
            <ImportIcon />
          </button>
        )}

        {/* ── Edit Structure button (--full mode only) ──────────────────────
            ALTER TABLE is a DDL operation, so this affordance is gated to
            --full mode at the entry point — the server's validateQuery
            rejects DDL in any other mode anyway. The amber hover tint warns
            that the action is destructive: editing structure can drop
            columns and rewrite types in irreversible ways.

            stopPropagation prevents the row's onClick (toggle expand) from
            also firing — same reasoning as the import / DDL buttons.
        */}
        {canEditStructure && onEditStructureClick && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditStructureClick(e);
            }}
            className="shrink-0 flex items-center justify-center w-5 h-5 rounded text-[#4b5563] hover:text-[#fbbf24] hover:bg-[#1f1500] opacity-0 group-hover:opacity-100 transition-opacity duration-100"
            aria-label={`Edit structure of ${name}`}
            title={`Edit structure of ${name}`}
          >
            <EditIcon />
          </button>
        )}
      </div>

      {/* ===== COLUMN LIST (rendered when expanded) ===== */}
      {isExpanded && (
        <ul role="group" className="border-l border-[#1f2033] ml-3.5">
          {visibleColumns.map((col) => (
            <ColumnRow
              key={col.name}
              info={col}
              isSelected={selectedColumn === col.name}
              onClick={(e) => onColumnClick(e, col)}
            />
          ))}
          {visibleColumns.length === 0 && (
            <li className="pl-4 py-1 text-[10px] italic text-[#2d3047] font-mono">
              (no matching columns)
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
