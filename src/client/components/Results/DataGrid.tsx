/**
 * src/client/components/Results/DataGrid.tsx
 *
 * WHAT:
 *   Renders SQL query results as a high-performance, interactive data grid.
 *   Handles four render states: loading, error, empty (no query run), and results.
 *
 * WHY TANSTACK TABLE + TANSTACK VIRTUAL:
 *   The Phase 1 plain HTML <table> can't handle 1000+ row result sets without
 *   freezing the browser — every row is a DOM node, and 10 000 rows = 10 000 nodes.
 *   TanStack Table provides sortable/resizable columns with a headless model (no
 *   bundled CSS). TanStack Virtual renders only the rows currently visible in the
 *   scroll window (typically ~20 rows), keeping DOM size constant regardless of
 *   row count. Together they turn a 100 000-row result from "browser crash" to
 *   "instant scroll".
 *
 * ARCHITECTURE:
 *   DataGrid          — state router: picks loading / error / empty / results view
 *   └─ ResultsTable   — the actual table, extracted so early-return states stay flat
 *      ├─ ResultsHeader — stats bar (row count, execution time)
 *      ├─ <thead>      — sticky header, sortable + resizable via TanStack Table
 *      └─ <tbody>      — virtually scrolled rows via TanStack Virtual
 *
 * DATA CONTRACT:
 *   Rows arrive as unknown[][] (array-of-arrays, not objects). Column 0 of each
 *   row maps to columns[0]. This preserves column order and supports duplicate
 *   column names from JOINs (which objects cannot represent).
 *
 * VIRTUAL SCROLL MECHANICS:
 *   The virtualizer measures the scroll container height and maps it to a slice
 *   of the rows array. It returns `virtualItems` — only ~20 items at a time.
 *   We pad the tbody with a top and bottom spacer <tr> so the scrollbar thumb
 *   accurately reflects the total row count without rendering invisible rows.
 */

import {
  useRef,
  useMemo,
  useState,
  useCallback,
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
import type { QueryResult } from "../../hooks/useQuery";

// ===== CONSTANTS =====

/**
 * Estimated row height in pixels used by the virtualizer for initial layout.
 *
 * WHY 28px: each row has py-1.5 (6px top + 6px bottom) + ~1px border = ~28px for
 * the default text-xs (12px line height). The virtualizer will measure actual
 * heights after first render and correct itself, but a close estimate prevents
 * a flash of misplaced scrollbar thumb.
 */
const ROW_HEIGHT_ESTIMATE = 28;

/**
 * Number of rows to render beyond the visible window on each side.
 *
 * WHY 10: with fast scrolling, the browser may paint faster than React renders.
 * Overscan ensures a buffer of pre-rendered rows is ready, eliminating blank
 * flashes. 10 rows ≈ 280px buffer — enough for typical fast-scroll velocity.
 */
const OVERSCAN = 10;

/** Width in pixels of the row-number column. Narrow, fixed, non-resizable. */
const ROW_NUMBER_COLUMN_WIDTH = 48;

/** Default width for data columns that haven't been resized by the user. */
const DEFAULT_COLUMN_WIDTH = 150;

// ===== TYPES =====

/** Props for the top-level DataGrid component. */
interface DataGridProps {
  /** Normalized result from the last successful query, or null if none has run. */
  result: QueryResult | null;
  /** Human-friendly error from the last failed query, or null. */
  error: string | null;
  /** True while a query is in flight. */
  loading: boolean;
}

/**
 * Internal row shape that TanStack Table operates on.
 *
 * WHY wrap rows in an object with a numeric index:
 *   TanStack Table expects data as an array of records (objects), but our
 *   server returns rows as unknown[][]. We wrap each row in { _row: unknown[] }
 *   so Table gets the object form it expects, while the original array is still
 *   accessible for per-cell rendering via `row.original._row[colIndex]`.
 *
 * WHY include _index:
 *   Row index for the row-number column. We could use row.index from TanStack
 *   (which changes after sorting), but we want to show the *original* row
 *   position so users can relate sorted results back to the raw SQL output.
 *   Using _index (the pre-sort position) is more informative in a DB context.
 */
interface RowData {
  _row: unknown[];
  _index: number;
}

// ===== HELPERS =====

/**
 * formatTime — converts a millisecond duration to a human-readable string.
 *
 * Three tiers:
 *   < 1 ms   → "< 1 ms"    (avoids misleading "0.0 ms")
 *   ≥ 1000ms → "1.20 s"    (seconds with 2 decimals)
 *   default  → "12.3 ms"   (ms with 1 decimal)
 */
function formatTime(ms: number): string {
  if (ms < 1) return "< 1 ms";
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  return `${ms.toFixed(1)} ms`;
}

/**
 * detectNumericColumns — scans the first non-null value in each column to
 * decide if the column contains numeric data.
 *
 * WHY only the first non-null value:
 *   A typed DB column has uniform types across all rows. Scanning every row is
 *   O(rows × cols). First non-null is O(cols) amortized — safe and fast even
 *   for 100 000-row results.
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
        break; // stop scanning rows once we have a non-null value
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
 *   number           → string of the number (alignment is handled by the cell wrapper)
 *   object / array   → compact JSON.stringify (for JSONB / JSON columns)
 *   string           → rendered as-is
 */
function renderCellValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return (
      <span className="italic text-[#4b5563]">NULL</span>
    );
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

// ===== SUB-COMPONENTS =====

/**
 * ResultsHeader — the stats bar pinned above the table.
 *
 * WHY show both row count and time:
 *   Row count confirms "did my WHERE clause filter as expected?".
 *   Execution time reveals slow queries without leaving the tool.
 *
 * The checkmark icon signals success visually before the user reads the numbers.
 */
function ResultsHeader({ rowCount, executionTime }: { rowCount: number; executionTime: number }) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 h-7 border-b border-[#1f2033] bg-[#0d0d17] text-[10px] font-mono text-[#4b5563]">
      {/* Checkmark — green to signal the query succeeded */}
      <svg
        className="w-3 h-3 text-[#34d399] shrink-0"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M2 6l3 3 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      <span className="text-[#6b7280]">
        {rowCount.toLocaleString()}{" "}
        {rowCount === 1 ? "row" : "rows"}
      </span>

      {/* Thin separator dot */}
      <span className="text-[#1f2033]" aria-hidden="true">·</span>

      <span>{formatTime(executionTime)}</span>
    </div>
  );
}

/**
 * ColumnResizeHandle — the draggable right-edge handle for column resizing.
 *
 * WHY absolute positioning at right: 0:
 *   The handle must sit at the exact right edge of the <th> without adding to
 *   the column's content width. absolute + right-0 achieves this while keeping
 *   the column header text unaffected.
 *
 * The cursor changes to col-resize on hover to signal that dragging is possible.
 * The double-line icon gives a visual affordance even without hover.
 */
function ColumnResizeHandle({
  onMouseDown,
  onTouchStart,
  isResizing,
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  onTouchStart: (e: React.TouchEvent) => void;
  isResizing: boolean;
}) {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={[
        "absolute top-0 right-0 h-full w-[5px] cursor-col-resize select-none touch-none",
        "flex items-center justify-center",
        "group/resizer",
        isResizing ? "opacity-100" : "opacity-0 hover:opacity-100",
      ].join(" ")}
      aria-hidden="true"
    >
      {/* Visual indicator line */}
      <div
        className={[
          "w-px h-3/4 rounded-full",
          isResizing ? "bg-[#6366f1]" : "bg-[#3b3d5c] group-hover/resizer:bg-[#6366f1]",
          "transition-colors duration-100",
        ].join(" ")}
      />
    </div>
  );
}

// ===== MAIN COMPONENT =====

/**
 * DataGrid — top-level component that routes to the correct render state.
 *
 * WHY "h-full flex flex-col overflow-hidden" on the root:
 *   The parent panel in App.tsx gives this component flex-1 height. For virtual
 *   scroll to work, DataGrid must fill exactly that space and expose a scrollable
 *   inner container. overflow-hidden on the root prevents a second scrollbar from
 *   appearing on the page body.
 */
export function DataGrid({ result, error, loading }: DataGridProps) {
  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[#4b5563] text-xs animate-pulse font-mono">
          Running…
        </span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  // Delegate to ErrorDisplay for a richer error presentation (see ErrorDisplay.tsx).
  // DataGrid itself used to render error inline; now it just decides to show it.
  if (error) {
    return (
      <div className="h-full flex items-start p-3">
        <div className="flex items-start gap-2 px-3 py-2 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-xs font-mono max-w-full">
          <span className="shrink-0 mt-px">✕</span>
          <span className="break-all">{error}</span>
        </div>
      </div>
    );
  }

  // ── No query run yet ───────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">Run a query to see results</p>
      </div>
    );
  }

  // ── Non-SELECT statement (INSERT / UPDATE / DELETE / CREATE / …) ───────────
  // The server returns columns=[] when the statement produced no tabular output.
  if (result.columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#34d399] text-sm font-mono">Query executed successfully</p>
          <p className="text-[#4b5563] text-xs mt-1 font-mono">
            {result.rowCount} {result.rowCount === 1 ? "row" : "rows"} affected
            {" · "}
            {formatTime(result.executionTime)}
          </p>
        </div>
      </div>
    );
  }

  return <ResultsTable result={result} />;
}

// ===== RESULTS TABLE =====

/**
 * ResultsTable — the full TanStack Table + Virtual implementation.
 *
 * Extracted into its own component so DataGrid can use early returns for all
 * non-table states without deeply nesting conditional JSX.
 *
 * KEY DECISIONS:
 *   1. Rows are converted from unknown[][] to RowData[] once, memoized on result.
 *      This keeps the TanStack Table model clean while preserving the array format.
 *   2. Columns include a fixed "#" row-number column followed by data columns.
 *      The row-number column is non-sortable and non-resizable.
 *   3. Column resize mode is "onChange" — the column width updates live as the
 *      user drags, not just on mouse-up. This feels more responsive for a dev tool.
 *   4. Sorting is client-side only (getSortedRowModel). For a DB GUI this is
 *      correct: the full result set is already in memory, and re-querying with
 *      ORDER BY would be slower than sorting in JS.
 *   5. Virtual scroll uses a ref on the scroll container div (not the table body)
 *      because the virtualizer needs a DOM element that has a measurable height
 *      and a scrollTop property.
 */
function ResultsTable({ result }: { result: QueryResult }) {
  // ── State ──────────────────────────────────────────────────────────────────

  /** TanStack Table sorting state: array of { id: columnId, desc: boolean }. */
  const [sorting, setSorting] = useState<SortingState>([]);

  /**
   * "onChange" mode: column width updates live as the user drags.
   * The alternative "onEnd" only updates on mouse-up — feels laggy for a DB tool.
   */
  const columnResizeMode: ColumnResizeMode = "onChange";

  // ── Ref for the scroll container ───────────────────────────────────────────

  /**
   * The virtualizer attaches to this element's scroll events.
   *
   * WHY a ref to the wrapper div (not the <tbody>):
   *   The <tbody> is not the element that scrolls — the outer div with
   *   overflow-auto is. The virtualizer must observe the scrolling element
   *   to know which rows are visible. Attaching to the wrong element results
   *   in "all rows always visible" (no virtualization).
   */
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Data transformation ────────────────────────────────────────────────────

  /**
   * Wrap each unknown[] row into a RowData object so TanStack Table can operate
   * on it. Memoized to avoid re-allocating the array on every render.
   *
   * The `_index` field captures the original row position (before sorting) so
   * the row-number column always shows the source row number, not the sorted position.
   */
  const tableData = useMemo<RowData[]>(
    () => result.rows.map((row, i) => ({ _row: row, _index: i })),
    [result.rows]
  );

  /**
   * Pre-compute which column indices hold numeric data.
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
   *   result sets and correlate rows between "before sort" and "after sort" views.
   *   The column is non-sortable (enableSorting: false) and non-resizable
   *   (enableResizing: false) to keep it stable as a visual anchor.
   *
   * WHY use accessorFn instead of accessorKey:
   *   Our row data is { _row: unknown[], _index: number }. There is no property
   *   named after each column. accessorFn lets us index into _row by column index,
   *   which is the only way to access values when the schema isn't known at compile time.
   *   The `id` must be unique per column; we use the column index as a suffix to
   *   handle duplicate column names (e.g. two columns named "id" from a JOIN).
   */
  const columns = useMemo<ColumnDef<RowData>[]>(() => {
    const rowNumberCol: ColumnDef<RowData> = {
      id: "__rownum__",
      header: "#",
      // Render the original row index (1-based) to match how psql numbers rows.
      cell: (info) => (
        <span className="text-[#374151] select-none">{info.row.original._index + 1}</span>
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
      // accessorFn extracts the raw value from _row at the correct index.
      accessorFn: (rowData: RowData) => rowData._row[colIdx],
      cell: (info) => renderCellValue(info.getValue()),
      size: DEFAULT_COLUMN_WIDTH,
      minSize: 40,
    }));

    return [rowNumberCol, ...dataCols];
  }, [result.columns]);

  // ── TanStack Table instance ────────────────────────────────────────────────

  /**
   * useReactTable wires together the data, columns, and feature models.
   *
   * getCoreRowModel: required base model — builds the internal row representation.
   * getSortedRowModel: adds multi-column sort. Without it, clicking headers does nothing.
   * columnResizeMode: "onChange" — live resize updates (see comment above).
   * state.sorting: controlled sort state so we can read/display sort indicators.
   * onSortingChange: updates our sorting state when the user clicks a header.
   * enableColumnResizing: enables the resize handle on all columns (overridable per-column).
   */
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
   * Get the sorted rows from TanStack Table to pass to the virtualizer.
   *
   * WHY table.getRowModel().rows (not tableData directly):
   *   After sorting, the row order changes. table.getRowModel().rows reflects the
   *   post-sort order. Passing raw tableData to the virtualizer would virtualize
   *   in original order while the table renders sorted — rows would be misaligned.
   */
  const sortedRows = table.getRowModel().rows;

  /**
   * useVirtualizer — the core of virtual scroll.
   *
   * count: total number of rows (the virtualizer knows the full extent of the list).
   * getScrollElement: returns the DOM element whose scroll position to observe.
   * estimateSize: initial row height estimate. A close estimate minimizes layout
   *   jitter on first render. The virtualizer will measure actual heights and
   *   self-correct if rows vary in height.
   * overscan: render this many extra rows above/below the visible window as a
   *   scroll buffer (see OVERSCAN constant for rationale).
   */
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
   * handleHeaderClick — toggles sort on a column when the user clicks its header.
   *
   * TanStack Table's column.getToggleSortingHandler() returns a native event
   * handler. We wrap it so the resize handle drag doesn't accidentally trigger a sort:
   * if the user's mouse moved horizontally during the click (resize drag), we skip
   * the sort toggle.
   *
   * WHY useCallback: this is created once per `table` instance, not recreated per header.
   */
  const handleHeaderClick = useCallback(
    (e: React.MouseEvent, column: ReturnType<typeof table.getAllColumns>[number]) => {
      if (!column.getCanSort()) return;
      column.getToggleSortingHandler()?.(e);
    },
    [table]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Stats bar — pinned above the scroll area */}
      <ResultsHeader rowCount={result.rowCount} executionTime={result.executionTime} />

      {/*
        Scroll container — the element the virtualizer observes.
        overflow-auto enables both axes. The table inside may be wider than the
        panel when there are many columns, so horizontal scroll is also needed.
      */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
        style={{ contain: "strict" }}
      >
        {/*
          The table width is controlled by TanStack's getCenterTotalSize().
          WHY inline style (not Tailwind w-full):
            getCenterTotalSize() returns the sum of all column sizes in pixels,
            updated as columns are resized. Tailwind's w-full would ignore this
            and the resize handles would have no effect on table layout.
            Inline style is the right tool here — it's a dynamic, computed value.
        */}
        <table
          style={{ width: table.getCenterTotalSize(), tableLayout: "fixed" }}
          className="border-collapse text-xs font-mono"
        >
          {/* ── Sticky header ────────────────────────────────────────────── */}
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
                       *   Column widths are managed by TanStack Table's resize state,
                       *   which is a dynamic number. Tailwind can't express dynamic
                       *   pixel values without arbitrary values that change at runtime.
                       *   Inline style is the correct approach here.
                       *
                       * position: relative enables the absolute-positioned resize handle
                       * to be anchored to the right edge of this <th>.
                       */
                      style={{ width: header.getSize(), position: "relative" } as CSSProperties}
                      className={[
                        "px-3 py-1.5 text-left text-[10px] uppercase tracking-wider",
                        "border-b border-[#1f2033] bg-[#0a0a0f]",
                        "whitespace-nowrap select-none overflow-hidden",
                        "text-[#4b5563]",
                        canSort ? "cursor-pointer hover:text-[#6b7280] transition-colors duration-100" : "",
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
                        {/* Column name */}
                        <span className="truncate">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                        </span>

                        {/* Sort direction indicator — only shown when column is sorted */}
                        {canSort && (
                          <SortIndicator direction={isSorted} />
                        )}
                      </div>

                      {/* Resize handle — only shown for resizable columns */}
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

          {/* ── Virtually scrolled body ───────────────────────────────────── */}
          <tbody>
            {/*
              Top spacer — pads the tbody so the first virtual item appears at the
              correct scroll offset. Without this, row 0 always renders at the top
              of the tbody regardless of scroll position.

              WHY a <tr> with height instead of margin/padding:
                <tbody> doesn't support margin. A spacer <tr> with explicit height
                is the standard pattern for virtual scroll inside a <table>.
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
                  /**
                   * data-index: required by the virtualizer's measureElement callback
                   * to identify which row is being measured after it renders.
                   */
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className="border-b border-[#0f0f1f] hover:bg-[#0d0d17] transition-colors duration-75"
                >
                  {row.getVisibleCells().map((cell) => {
                    const colId = cell.column.id;

                    // Determine whether this data column holds numeric values.
                    // The row-number column is identified by its fixed id.
                    const colIdx = colId.startsWith("col_")
                      ? parseInt(colId.slice(4), 10)
                      : -1;
                    const isNumeric = colIdx >= 0 && numericColumns.has(colIdx);

                    return (
                      <td
                        key={cell.id}
                        /**
                         * WHY inline style for width:
                         *   Same reason as <th> — column widths are dynamic numbers
                         *   from TanStack's resize state. Inline style is required.
                         */
                        style={{ width: cell.column.getSize() } as CSSProperties}
                        className={[
                          "px-3 py-1.5 whitespace-nowrap overflow-hidden text-ellipsis",
                          // Numeric: right-aligned, amber color, tabular figures
                          // Tabular-nums makes number columns scan better in grids:
                          // each digit occupies the same width so columns line up.
                          isNumeric
                            ? "text-right text-[#f59e0b] tabular-nums"
                            : "text-left text-[#ededf0]",
                          // Row-number column: muted, narrower padding
                          colId === "__rownum__" ? "text-[#374151] pr-2" : "",
                        ].join(" ")}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}

            {/*
              Bottom spacer — accounts for all rows below the visible window.
              Without this, the scrollbar thumb would only cover the rendered rows,
              making the scroll range appear much smaller than the actual row count.
            */}
            {virtualItems.length > 0 && (
              <tr
                style={{
                  height:
                    totalSize -
                    (virtualItems[virtualItems.length - 1]?.end ?? 0),
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

// ===== SORT INDICATOR =====

/**
 * SortIndicator — a small arrow icon that shows the sort direction for a column.
 *
 * WHY a custom SVG instead of a Unicode arrow:
 *   Unicode arrows (↑ ↓ ⇅) vary in size and baseline across fonts and OSes.
 *   An SVG is pixel-precise and inherits the parent's text color via currentColor.
 *
 * When `direction` is false (unsorted), renders a dim double-arrow to hint that
 * clicking will sort — better discoverability than showing nothing.
 */
function SortIndicator({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return (
      <svg className="w-2.5 h-2.5 text-[#6366f1] shrink-0" viewBox="0 0 10 10" fill="none" aria-label="sorted ascending">
        <path d="M5 2L8.5 7H1.5L5 2Z" fill="currentColor" />
      </svg>
    );
  }
  if (direction === "desc") {
    return (
      <svg className="w-2.5 h-2.5 text-[#6366f1] shrink-0" viewBox="0 0 10 10" fill="none" aria-label="sorted descending">
        <path d="M5 8L1.5 3H8.5L5 8Z" fill="currentColor" />
      </svg>
    );
  }
  // Unsorted: dim double-chevron hint
  return (
    <svg className="w-2.5 h-2.5 text-[#2d3047] shrink-0 opacity-0 group-hover:opacity-100" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M5 1.5L7.5 4H2.5L5 1.5Z" fill="currentColor" />
      <path d="M5 8.5L2.5 6H7.5L5 8.5Z" fill="currentColor" />
    </svg>
  );
}
