/**
 * src/client/components/Results/ResultsTable.tsx
 *
 * WHAT:
 *   The full TanStack Table + TanStack Virtual implementation that renders a
 *   QueryResult as a high-performance, sortable, resizable data grid.
 *
 * WHY a separate file from DataGrid.tsx:
 *   DataGrid is a state-router (loading / error / empty / results). Once it
 *   decides to show a table it delegates entirely to ResultsTable. Keeping the
 *   TanStack wiring here means DataGrid stays readable at a glance, and this
 *   file can be understood in isolation.
 *
 * KEY DECISIONS:
 *   1. Rows arrive as unknown[][] and are wrapped in RowData objects once so
 *      TanStack Table gets the record form it expects (accessorFn reads back
 *      into _row by column index).
 *   2. Column IDs are "col_<index>" to support duplicate column names from JOINs.
 *   3. Column resize mode is "onChange" — live updates feel more responsive.
 *   4. Sorting is client-side only (getSortedRowModel). Re-querying with ORDER BY
 *      would be slower than in-memory sort for an already-loaded result set.
 *   5. The virtualizer observes the outer scroll div (not the <tbody>) because
 *      only the div has a scrollTop and a measurable height.
 *
 * VIRTUAL SCROLL MECHANICS:
 *   The virtualizer maps the scroll container's visible height to a slice of the
 *   rows array (typically ~20 items). Top and bottom spacer <tr> elements pad the
 *   <tbody> so the scrollbar thumb accurately reflects the full row count without
 *   rendering invisible rows.
 */

import {
  useRef,
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnResizeMode,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryResult } from "../../types";
import { ResultsHeader } from "./ResultsHeader";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { SortIndicator } from "./SortIndicator";
import { CellContextMenu } from "./CellContextMenu";

// ===== CONSTANTS =====

/**
 * Estimated row height in pixels used by the virtualizer for initial layout.
 *
 * WHY 28px: each row has py-1.5 (6px top + 6px bottom) + ~1px border = ~28px
 * for the default text-xs (12px line height). The virtualizer self-corrects
 * after measuring real heights, but a close estimate prevents an initial flash
 * of a misplaced scrollbar thumb.
 */
const ROW_HEIGHT_ESTIMATE = 28;

/**
 * Number of rows to render beyond the visible window on each side.
 *
 * WHY 10: with fast scrolling the browser may paint faster than React renders.
 * Pre-rendering 10 rows above/below the viewport (~280px) eliminates blank
 * flashes at typical scroll velocities.
 */
const OVERSCAN = 10;

/** Width in pixels of the row-number column. Narrow, fixed, non-resizable. */
const ROW_NUMBER_COLUMN_WIDTH = 48;

/** Default width for data columns that haven't been resized by the user. */
const DEFAULT_COLUMN_WIDTH = 150;

// ===== TYPES =====

/**
 * Internal row shape that TanStack Table operates on.
 *
 * WHY wrap rows in an object:
 *   TanStack Table expects data as an array of records, but our server returns
 *   rows as unknown[][]. We wrap each row in { _row: unknown[] } so Table gets
 *   the object form it expects; cells access values via `row.original._row[i]`.
 *
 * WHY include _index:
 *   The row-number column shows the *original* row position (pre-sort) so users
 *   can relate sorted results back to the raw SQL output order. row.index from
 *   TanStack changes after sorting; _index does not.
 */
interface RowData {
  _row: unknown[];
  _index: number;
}

// ===== HELPERS =====

/**
 * detectNumericColumns — scans the first non-null value in each column to
 * decide if the column contains numeric data.
 *
 * WHY only the first non-null value:
 *   A typed DB column has uniform types across all rows. Scanning every row is
 *   O(rows × cols). First non-null is O(cols) amortized — safe and fast even
 *   for 100 000-row result sets.
 *
 * Returns a Set<number> of column indices that are numeric.
 */
function detectNumericColumns(columns: string[], rows: unknown[][]): Set<number> {
  const numeric = new Set<number>();
  for (let colIdx = 0; colIdx < columns.length; colIdx++) {
    for (const row of rows) {
      const val = row[colIdx];
      if (val !== null && val !== undefined) {
        if (typeof val === "number") numeric.add(colIdx);
        break;
      }
    }
  }
  return numeric;
}

/**
 * renderCellValue — converts a raw DB cell value into a styled React node.
 *
 * Rendering rules (matches common DB GUI conventions):
 *   null / undefined → italic "NULL" in muted gray — visually distinct from ""
 *   boolean true     → "true" in green — scannable in boolean flag columns
 *   boolean false    → "false" in red
 *   number           → string of the number (alignment handled by cell wrapper)
 *   object / array   → compact JSON.stringify (for JSONB / JSON columns)
 *   string           → rendered as-is
 */
function renderCellValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-[#4b5563]">NULL</span>;
  }
  if (typeof value === "boolean") {
    return (
      <span className={value ? "text-[#34d399]" : "text-[#f87171]"}>
        {String(value)}
      </span>
    );
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

// ===== COMPONENT =====

/** Props for ResultsTable. */
interface ResultsTableProps {
  /** The query result to display. Must have at least one column. */
  result: QueryResult;
}

/**
 * ResultsTable — TanStack Table + Virtual grid for a successful SELECT result.
 *
 * Receives a QueryResult that is guaranteed to have columns (the DataGrid
 * state-router guards against the empty-columns case before rendering this).
 */
export function ResultsTable({ result }: ResultsTableProps) {
  // ── State ──────────────────────────────────────────────────────────────────

  /** TanStack Table sorting state: array of { id: columnId, desc: boolean }. */
  const [sorting, setSorting] = useState<SortingState>([]);

  /**
   * Tracks which cell is currently highlighted (click-to-select).
   * Key format: "<rowId>__<colId>" — unique within the current result set.
   */
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  /**
   * Controls the "Copied!" toast visibility. true → toast is showing.
   * Auto-clears after 1.5 s via useEffect below.
   */
  const [showCopied, setShowCopied] = useState(false);

  /** Auto-dismiss the "Copied!" toast after 1.5 s. */
  useEffect(() => {
    if (!showCopied) return;
    const timer = setTimeout(() => setShowCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [showCopied]);

  /**
   * "onChange" mode: column width updates live as the user drags.
   * The alternative "onEnd" only updates on mouse-up — feels laggy for a dev tool.
   */
  const columnResizeMode: ColumnResizeMode = "onChange";

  // ── Ref for the scroll container ───────────────────────────────────────────

  /**
   * The virtualizer attaches to this element's scroll events.
   *
   * WHY a ref to the wrapper div (not the <tbody>):
   *   The <tbody> is not the element that scrolls — the outer div with
   *   overflow-auto is. Attaching to the wrong element causes the virtualizer
   *   to think all rows are always visible (no virtualization occurs).
   */
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Data transformation ────────────────────────────────────────────────────

  /**
   * Wrap each unknown[] row into a RowData object. Memoized to avoid
   * re-allocating on every render. _index captures the original row position
   * before sorting so the row-number column is stable across sort changes.
   */
  const tableData = useMemo<RowData[]>(
    () => result.rows.map((row, i) => ({ _row: row, _index: i })),
    [result.rows]
  );

  /**
   * Pre-compute numeric column indices for right-alignment and amber colouring.
   * Memoized on result — only recalculated when the query changes.
   */
  const numericColumns = useMemo(
    () => detectNumericColumns(result.columns, result.rows),
    [result.columns, result.rows]
  );

  // ── Column definitions ─────────────────────────────────────────────────────

  /**
   * Build TanStack ColumnDef objects from the query result columns.
   *
   * WHY a row-number column first:
   *   Database GUIs universally show row numbers. It helps users navigate large
   *   result sets and correlate sorted rows back to the raw SQL output order.
   *   The column is non-sortable and non-resizable to act as a stable anchor.
   *
   * WHY accessorFn instead of accessorKey:
   *   Our row data is { _row: unknown[], _index: number } — no property named
   *   after each column. accessorFn lets us index _row by column index, the
   *   only option when the schema is unknown at compile time. Column IDs use
   *   "col_<index>" as a suffix to handle duplicate column names from JOINs.
   */
  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    const rowNumberCol: ColumnDef<RowData> = {
      id: "__rownum__",
      header: "#",
      cell: (info) => (
        <span className="text-[#374151] select-none">
          {info.row.original._index + 1}
        </span>
      ),
      size: ROW_NUMBER_COLUMN_WIDTH,
      minSize: ROW_NUMBER_COLUMN_WIDTH,
      maxSize: ROW_NUMBER_COLUMN_WIDTH,
      enableSorting: false,
      enableResizing: false,
    };

    const dataCols: ColumnDef<RowData>[] = result.columns.map((colName, colIdx) => ({
      id: `col_${colIdx}`,
      header: colName,
      accessorFn: (rowData: RowData) => rowData._row[colIdx],
      cell: (info) => renderCellValue(info.getValue()),
      size: DEFAULT_COLUMN_WIDTH,
      minSize: 40,
    }));

    return [rowNumberCol, ...dataCols];
  }, [result.columns]);

  // ── TanStack Table instance ────────────────────────────────────────────────

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    columnResizeMode,
    enableColumnResizing: true,
  });

  // ── Virtual row list ───────────────────────────────────────────────────────

  /**
   * Use post-sort rows so the virtualizer window maps to the correct slice
   * of the sorted (not original) row order.
   */
  const sortedRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // ── Header sort-click handler ──────────────────────────────────────────────

  /**
   * handleHeaderClick — toggles sort when the user clicks a header cell.
   *
   * Wraps TanStack's getToggleSortingHandler so a resize drag doesn't
   * accidentally also trigger a sort (pointer moves horizontally during drag).
   * useCallback keeps the reference stable across renders.
   */
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent, column: ReturnType<typeof table.getAllColumns>[number]) => {
      if (!column.getCanSort()) return;
      column.getToggleSortingHandler()?.(e);
    },
    [table]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  /** All sorted rows as unknown[][] — passed to CellContextMenu for column copy. */
  const allRowArrays = useMemo(
    () => sortedRows.map((row) => row.original._row),
    [sortedRows]
  );

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/*
        "Copied!" toast — appears briefly after any clipboard write.
        Positioned absolute top-right so it floats over the table without
        shifting layout. pointer-events-none prevents it intercepting mouse events.
      */}
      {showCopied && (
        <div
          className={[
            "absolute top-2 right-3 z-50 px-3 py-1.5 rounded",
            "bg-[#1a1a2e] border border-[#2d2d4f] text-[#ededf0]",
            "text-xs font-mono pointer-events-none",
            "animate-in fade-in-0 slide-in-from-top-1",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          Copied!
        </div>
      )}

      <ResultsHeader result={result} />

      {/*
        Scroll container — the element the virtualizer observes.
        overflow-auto enables both axes; wide result sets need horizontal scroll too.
      */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        style={{ contain: "strict" }}
      >
        {/*
          WHY inline style for table width:
            getCenterTotalSize() returns the sum of all column sizes in pixels,
            updated live as columns are resized. Tailwind's w-full would ignore
            this and break resize. Inline style is the correct tool here.
        */}
        <table
          style={{ width: table.getCenterTotalSize(), tableLayout: "fixed" }}
          className="border-collapse text-xs font-mono"
        >
          {/* ── Sticky header ──────────────────────────────────────────────── */}
          <thead className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  const canResize = header.column.getCanResize();

                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      /**
                       * WHY inline style for width:
                       *   Column widths come from TanStack's resize state — a
                       *   dynamic pixel value that changes on every drag event.
                       *   Tailwind arbitrary values are static; inline style is required.
                       *
                       * position: relative anchors the absolute-positioned resize handle.
                       */
                      style={{ width: header.getSize(), position: "relative" } as CSSProperties}
                      className={[
                        "px-3 py-1.5 text-left text-[10px] uppercase tracking-wider",
                        "border-b border-[#1f2033] bg-[#0a0a0f]",
                        "whitespace-nowrap select-none overflow-hidden",
                        "text-[#4b5563]",
                        canSort
                          ? "cursor-pointer hover:text-[#6b7280] transition-colors duration-100"
                          : "",
                      ].join(" ")}
                      onClick={(e) => handleHeaderClick(e, header.column)}
                      aria-sort={
                        isSorted === "asc"
                          ? "ascending"
                          : isSorted === "desc"
                          ? "descending"
                          : undefined
                      }
                    >
                      <div className="flex items-center gap-1">
                        <span className="truncate">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {canSort && <SortIndicator direction={isSorted} />}
                      </div>

                      {canResize && (
                        <ColumnResizeHandle
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          isResizing={header.column.getIsResizing()}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {/* ── Virtually scrolled body ─────────────────────────────────────── */}
          <tbody>
            {/*
              Top spacer — pads the tbody so the first virtual item appears at
              the correct scroll offset. Without it, row 0 always renders at the
              top of tbody regardless of scroll position.

              WHY a <tr> with height instead of margin/padding:
                <tbody> doesn't support margin. A spacer <tr> is the standard
                pattern for virtual scroll inside a <table>.
            */}
            {virtualItems.length > 0 && virtualItems[0] != null && (
              <tr style={{ height: virtualItems[0].start }} aria-hidden="true">
                <td colSpan={columns.length} />
              </tr>
            )}

            {virtualItems.map((virtualRow) => {
              const row = sortedRows[virtualRow.index];
              if (row == null) return null;
              return (
                <tr
                  key={row.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="border-b border-[#0f0f1f] hover:bg-[#0d0d17] transition-colors duration-75"
                >
                  {row.getVisibleCells().map((cell) => {
                    const colId = cell.column.id;
                    const colIdx = colId.startsWith("col_")
                      ? parseInt(colId.slice(4), 10)
                      : -1;
                    const isNumeric = colIdx >= 0 && numericColumns.has(colIdx);
                    const isDataCol = colIdx >= 0;

                    // Unique key for click-to-highlight. Stable within a result set.
                    const cellKey = `${row.id}__${colId}`;
                    const isSelected = selectedCellKey === cellKey;

                    const tdElement = (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() } as CSSProperties}
                        className={[
                          "px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis",
                          "cursor-default",
                          isNumeric
                            ? "text-right text-[#f59e0b] tabular-nums"
                            : "text-left text-[#ededf0]",
                          colId === "__rownum__" ? "text-[#374151] pr-2" : "",
                          // Blue highlight on selected cell.
                          isSelected
                            ? "bg-[#1a2744] outline outline-1 outline-[#3b82f6]"
                            : "",
                        ].join(" ")}
                        onClick={() => {
                          if (isDataCol) setSelectedCellKey(cellKey);
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );

                    // Only data columns get the context menu; the # column does not.
                    if (!isDataCol) return tdElement;

                    return (
                      <CellContextMenu
                        key={cell.id}
                        cellValue={row.original._row[colIdx]}
                        colIndex={colIdx}
                        columns={result.columns}
                        allRows={allRowArrays}
                        rowValues={row.original._row}
                        onCopied={() => setShowCopied(true)}
                      >
                        {tdElement}
                      </CellContextMenu>
                    );
                  })}
                </tr>
              );
            })}

            {/*
              Bottom spacer — accounts for all rows below the visible window.
              Without it the scrollbar thumb would only cover rendered rows,
              making the scroll range appear far smaller than the actual row count.
            */}
            {virtualItems.length > 0 && (
              <tr
                style={{
                  height:
                    totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0),
                }}
                aria-hidden="true"
              >
                <td colSpan={columns.length} />
              </tr>
            )}
          </tbody>
        </table>

        {/* Zero-rows message — a SELECT can succeed but return no rows */}
        {result.rows.length === 0 && (
          <div className="flex items-center justify-center h-12 text-[#2d3047] text-xs italic font-mono">
            Query returned 0 rows
          </div>
        )}
      </div>
    </div>
  );
}
