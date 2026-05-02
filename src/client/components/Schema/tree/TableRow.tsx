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
 * ===== DEPENDENCIES =====
 *   ../../../hooks/useSchema — ColumnInfo type
 *   ./icons                  — ChevronIcon, TableIcon, PreviewIcon, DdlIcon, StarFilledIcon
 *   ./ColumnRow              — ColumnRow component
 */

import type { ColumnInfo } from "../../../hooks/useSchema";
import {
  ChevronIcon,
  TableIcon,
  PreviewIcon,
  DdlIcon,
  StarFilledIcon,
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
 * row-count badge, and the preview + DDL action buttons. When expanded, renders
 * a ColumnRow for each visible column.
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
 * @param onToggleExpand  Called when the row header is clicked.
 * @param onPreviewClick  Called when the preview (eye) icon is clicked.
 * @param onDdlClick      Called when the DDL (brackets) icon is clicked.
 * @param onColumnClick   Called with the column ColumnInfo when a column row is clicked.
 * @param onContextMenu   Called when the row is right-clicked.
 * @param onUnpinClick    Called when the star icon on a pinned row is clicked.
 */
export function TableRow({
  name,
  columns,
  rowCount,
  isExpanded,
  searchTerm,
  isPinned,
  selectedColumn,
  onToggleExpand,
  onPreviewClick,
  onDdlClick,
  onColumnClick,
  onContextMenu,
  onUnpinClick,
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
      <div
        onClick={onToggleExpand}
        onContextMenu={onContextMenu}
        // role=button + keyboard handler so this is reachable by keyboard users.
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggleExpand();
          }
        }}
        className="group flex items-center gap-1.5 px-2 h-6 cursor-pointer hover:bg-[#0f0f1a] select-none"
        title={`Toggle ${name}`}
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
