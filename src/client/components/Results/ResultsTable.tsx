/**
 * src/client/components/Results/ResultsTable.tsx
 *
 * WHAT:
 *   The full TanStack Table + TanStack Virtual implementation that renders a
 *   QueryResult as a high-performance, sortable, resizable, filterable data grid.
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
 *   5. Filtering is client-side only (getFilteredRowModel). Same reasoning: the
 *      data is already in memory; a WHERE clause round-trip is always slower than
 *      a JS array scan.
 *   6. The virtualizer observes the outer scroll div (not the <tbody>) because
 *      only the div has a scrollTop and a measurable height.
 *
 * FILTER BEHAVIOR:
 *   All filtering is handled by dbFilterFn (defined at module level, reused
 *   across all data columns):
 *     - 'null'   → show only rows where the cell is NULL
 *     - '!null'  → show only rows where the cell is NOT NULL
 *     - Numeric columns: >, <, >=, <= prefix operators for range filtering,
 *       or bare number for exact match (e.g. '>100', '<=50', '42')
 *     - Text columns: case-insensitive substring match
 *   An empty filter string passes all rows through (autoRemove clears the entry
 *   from columnFilters state so TanStack skips the column entirely).
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
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnResizeMode,
  type ColumnFiltersState,
  type FilterFn,
  type Row,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { QueryResult } from "../../types";
import { ResultsHeader } from "./ResultsHeader";
import { ColumnResizeHandle } from "./ColumnResizeHandle";
import { SortIndicator } from "./SortIndicator";
import { CellContextMenu } from "./CellContextMenu";
import { ValueViewer } from "./ValueViewer";
import { EditConfirmDialog } from "./EditConfirmDialog";
import { useCellEdit, explainAvailability } from "../../hooks/useCellEdit";

// ===== TANSTACK MODULE AUGMENTATION =====

/**
 * Registers our custom "dbFilter" filter function with TanStack Table's type
 * system so it can be referenced by string name in ColumnDef.filterFn.
 *
 * WHY module augmentation instead of passing the fn directly in ColumnDef:
 *   Passing an inline fn per-column works but creates a new fn reference on
 *   every render, causing unnecessary filter recalculations. Registering once
 *   in filterFns and referencing by name is the idiomatic TanStack pattern.
 */
declare module "@tanstack/react-table" {
  interface FilterFns {
    dbFilter: FilterFn<unknown>;
  }
}

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

// ===== FILTER FUNCTION =====

/**
 * dbFilterFn — custom TanStack filter function that handles text, numeric,
 * and NULL filtering with a single input string per column.
 *
 * HOW it works:
 *   1. Empty/blank filter → always passes (autoRemove will remove it from state)
 *   2. 'null'  → pass only NULL/undefined cells
 *   3. '!null' → pass only non-NULL cells
 *   4. Numeric cell + operator prefix (>, <, >=, <=) → range comparison
 *   5. Numeric cell + bare number → exact equality
 *   6. Anything else → case-insensitive substring match on the string representation
 *
 * WHY defined at module scope:
 *   Defining inside the component would create a new function reference on every
 *   render, causing TanStack to re-run all filters unnecessarily. Module scope
 *   gives a stable reference.
 */
const dbFilterFn: FilterFn<RowData> = (
  row: Row<RowData>,
  columnId: string,
  filterValue: string
): boolean => {
  const raw = row.getValue<unknown>(columnId);
  const filter = filterValue.trim();

  // Empty filter → pass through
  if (!filter) return true;

  // ── NULL sentinels ────────────────────────────────────────────────────────
  if (filter === "null") return raw === null || raw === undefined;
  if (filter === "!null") return raw !== null && raw !== undefined;

  // Non-null cell: NULL cells don't match any other filter term
  if (raw === null || raw === undefined) return false;

  // ── Numeric operators ─────────────────────────────────────────────────────
  if (typeof raw === "number") {
    // Check for >=, <= before > and < to avoid partial matches
    if (filter.startsWith(">=")) {
      const n = parseFloat(filter.slice(2));
      return !isNaN(n) && raw >= n;
    }
    if (filter.startsWith("<=")) {
      const n = parseFloat(filter.slice(2));
      return !isNaN(n) && raw <= n;
    }
    if (filter.startsWith(">")) {
      const n = parseFloat(filter.slice(1));
      return !isNaN(n) && raw > n;
    }
    if (filter.startsWith("<")) {
      const n = parseFloat(filter.slice(1));
      return !isNaN(n) && raw < n;
    }
    // Exact numeric match — useful for IDs and integer flags
    const n = parseFloat(filter);
    return !isNaN(n) && raw === n;
  }

  // ── Substring match ────────────────────────────────────────────────────────
  // Stringify objects (JSONB columns) so users can filter on JSON content.
  const strVal = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
  return strVal.toLowerCase().includes(filter.toLowerCase());
};

/**
 * autoRemove tells TanStack to drop a column's filter entry from columnFilters
 * state when the value is empty. Without it, empty inputs remain in state and
 * TanStack still calls the filter function (a no-op, but wasteful).
 */
dbFilterFn.autoRemove = (val: unknown): boolean =>
  !val || (typeof val === "string" && val.trim() === "");

// ===== CELL EDITOR =====

/**
 * coerceTypedValue — turns the user-typed string into the JS value sent to
 * the server.
 *
 * Logic mirrors common database-GUI conventions and matches what users
 * already see in the cell renderer (NULL, true/false). Numeric columns
 * get parseFloat treatment when the input is a clean number; everything
 * else stays a string and the database driver does the column-type
 * coercion.
 *
 *   ""      → null   (matches the convention of "blank means NULL")
 *   "NULL"  → null   (case-insensitive — matches the rendered NULL label)
 *   "true"  → true   (boolean column convenience)
 *   "false" → false
 *   numeric input on a numeric column → number
 *   anything else → string verbatim
 */
function coerceTypedValue(input: string, isNumeric: boolean): unknown {
  if (input === "") return null;
  const upper = input.toUpperCase();
  if (upper === "NULL") return null;
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  if (isNumeric) {
    const n = Number(input);
    if (!Number.isNaN(n)) return n;
  }
  return input;
}

/**
 * stringifyForInput — converts the cell's raw value back to the string form
 * shown inside the edit input. Reverse of coerceTypedValue, mostly.
 *
 * NULL → "" so the user can blank-and-Enter to revert to NULL without
 * typing the literal "NULL". Booleans render as their lowercase forms
 * matching the cell renderer.
 */
function stringifyForInput(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * CellEditor — the inline <input> rendered in place of a cell's value while
 * editing.
 *
 * Lifecycle:
 *   - Mounts when the user double-clicks an editable cell.
 *   - Auto-focuses + selects the existing value so a single keystroke
 *     replaces it (DBeaver / spreadsheet convention).
 *   - Enter / Tab fires onCommit(newValue) — parent decides what to do
 *     with it (open the confirmation dialog).
 *   - Escape fires onCancel() — parent unmounts the editor without saving.
 *
 * WHY a controlled input with local state (not parent state):
 *   The parent only cares about the FINAL committed value. Driving the
 *   input from parent state would re-render the table on every keystroke
 *   for nothing. Local state keeps typing snappy.
 */
function CellEditor({
  initialValue,
  isNumeric,
  onCommit,
  onCancel,
}: {
  initialValue: unknown;
  isNumeric: boolean;
  onCommit: (newValue: unknown) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<string>(() => stringifyForInput(initialValue));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus + select all so a single keystroke overwrites the existing
    // text. Matches the DBeaver / Excel / TablePlus convention.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Tab") {
          // Tab usually moves focus; we capture it here so it commits the
          // edit instead. preventDefault stops the default focus traversal
          // from yanking focus out of the cell mid-commit.
          e.preventDefault();
          e.stopPropagation();
          onCommit(coerceTypedValue(value, isNumeric));
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      // Click inside the input must not bubble to the <td>, which would
      // trigger the ValueViewer-open onClick and shift focus.
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      // Losing focus is treated as cancel, matching DBeaver. We'd rather
      // discard a stray click-away than silently fire an UPDATE the user
      // didn't deliberately confirm.
      onBlur={() => onCancel()}
      spellCheck={false}
      className={[
        "w-full bg-[#0a0a0f] border border-[#3b82f6] rounded",
        "px-1.5 py-0.5 text-xs font-mono outline-none",
        "text-[#ededf0]",
        isNumeric ? "text-right tabular-nums" : "text-left",
      ].join(" ")}
    />
  );
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
   * Column filter state: array of { id: columnId, value: string }.
   * Controlled externally so we can reset it when the query result changes.
   */
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  /**
   * Tracks which cell is currently highlighted (click-to-select).
   * Key format: "<rowId>__<colId>" — unique within the current result set.
   */
  const [selectedCellKey, setSelectedCellKey] = useState<string | null>(null);

  /**
   * The value and column name of the currently selected cell, shown in the
   * ValueViewer panel below the grid. Null when no cell is selected or the
   * panel has been explicitly closed via the ✕ button or Escape.
   *
   * WHY separate from selectedCellKey:
   *   selectedCellKey drives the blue-outline highlight on the cell.
   *   selectedCell drives the ValueViewer content. They move together when a
   *   new cell is clicked, but selectedCell can be cleared independently (user
   *   closes the panel) without removing the cell highlight.
   */
  const [selectedCell, setSelectedCell] = useState<{
    value: unknown;
    columnName: string;
  } | null>(null);

  /**
   * Controls the "Copied!" toast visibility. true → toast is showing.
   * Auto-clears after 1.5 s via useEffect below.
   */
  const [showCopied, setShowCopied] = useState(false);

  // ── Cell-edit state ─────────────────────────────────────────────────────
  // useCellEdit owns the dirty/undo bookkeeping AND the editability decision.
  // ResultsTable owns only the EPHEMERAL UI state for the in-progress edit:
  //   editingCell    — which cell the input is rendered for, plus the row's
  //                    original value (so Escape can roll back the input).
  //   pendingEdit    — once the user presses Enter, the new value plus the
  //                    pre-built SQL preview are stashed here and the
  //                    EditConfirmDialog mounts. Confirm flushes through
  //                    cellEdit.saveEdit; Cancel discards.
  //   uneditableMsg  — transient banner shown when a double-click on an
  //                    uneditable cell is denied; auto-clears after 2 s.
  const cellEdit = useCellEdit({ result });

  /**
   * The cell currently being edited (input rendered in place of its value),
   * or null when no edit is in progress.
   */
  const [editingCell, setEditingCell] = useState<
    | { rowIndex: number; colIndex: number }
    | null
  >(null);

  /**
   * After the user presses Enter inside the edit input we capture the new
   * value plus a pre-built SQL preview here, then mount the confirmation
   * dialog. Null when no confirmation is pending.
   */
  const [pendingEdit, setPendingEdit] = useState<
    | {
        rowIndex: number;
        colIndex: number;
        newValue: unknown;
        sql: string;
        table: string;
        column: string;
        pk: Record<string, unknown>;
      }
    | null
  >(null);

  /**
   * Banner-style refusal message. Shown briefly when the user double-clicks
   * a cell that can't be edited (read-only mode, multi-table query, etc.)
   * so they understand why nothing happened.
   */
  const [uneditableMsg, setUneditableMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!uneditableMsg) return;
    const timer = setTimeout(() => setUneditableMsg(null), 2500);
    return () => clearTimeout(timer);
  }, [uneditableMsg]);

  /** Auto-dismiss the "Copied!" toast after 1.5 s. */
  useEffect(() => {
    if (!showCopied) return;
    const timer = setTimeout(() => setShowCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [showCopied]);

  // ── Cmd/Ctrl+Z — undo last cell edit ─────────────────────────────────────
  // Bound at the window level so the shortcut works regardless of which
  // element has focus. Bails out if:
  //   - any text input / textarea is focused (so Cmd+Z keeps doing the
  //     native text-undo inside the SqlEditor or filter inputs),
  //   - a cell is currently being edited (the input owns its own undo),
  //   - the confirmation dialog is open,
  //   - a save is already in flight.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "z") return;
      // Native text undo wins inside editable text fields.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) {
        return;
      }
      if (editingCell !== null || pendingEdit !== null || cellEdit.saving) {
        return;
      }
      e.preventDefault();
      void cellEdit.undoLast().then((outcome) => {
        if (outcome && "error" in outcome && !outcome.ok) {
          setUneditableMsg(`Undo failed: ${outcome.error}`);
        }
      });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cellEdit, editingCell, pendingEdit]);

  /**
   * Reset column filters whenever the query result changes.
   *
   * WHY: filters from a previous query reference old column IDs and would show
   * misleading "N of M rows" counts on the new result's header. Clearing them
   * on result change gives users a clean slate for each new query.
   */
  useEffect(() => {
    setColumnFilters([]);
    setSelectedCellKey(null);
    setSelectedCell(null);
    // Cell-edit state belongs to a specific result set: a brand-new query
    // makes the prior dirty highlights / undo frames meaningless because
    // the row indices may now refer to entirely different rows. Reset
    // alongside the other selection state.
    setEditingCell(null);
    setPendingEdit(null);
    cellEdit.clearDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  /**
   * Scroll back to the top of the table when filters change.
   *
   * WHY: if the user has scrolled to row 5000 and then types a filter that
   * leaves only 20 rows, the virtual items slice will be empty or show row
   * spacers incorrectly until they scroll up. Resetting scroll on filter change
   * ensures row 0 is always visible when the filter set changes.
   */
  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }, [columnFilters]);

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
   * Pre-compute numeric column indices for right-alignment, amber colouring,
   * and filter input placeholder selection.
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
   *   The column is non-sortable, non-resizable, and non-filterable to act as
   *   a stable anchor.
   *
   * WHY accessorFn instead of accessorKey:
   *   Our row data is { _row: unknown[], _index: number } — no property named
   *   after each column. accessorFn lets us index _row by column index, the
   *   only option when the schema is unknown at compile time. Column IDs use
   *   "col_<index>" as a suffix to handle duplicate column names from JOINs.
   *
   * WHY filterFn: 'dbFilter' on data columns:
   *   References the custom filter function registered in filterFns below. The
   *   row-number column explicitly disables filtering since row indices are
   *   derived values, not data the user would want to search.
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
      enableColumnFilter: false,
    };

    const dataCols: ColumnDef<RowData>[] = result.columns.map((colName, colIdx) => ({
      id: `col_${colIdx}`,
      header: colName,
      accessorFn: (rowData: RowData) => rowData._row[colIdx],
      cell: (info) => renderCellValue(info.getValue()),
      size: DEFAULT_COLUMN_WIDTH,
      minSize: 40,
      filterFn: "dbFilter",
    }));

    return [rowNumberCol, ...dataCols];
  }, [result.columns]);

  // ── TanStack Table instance ────────────────────────────────────────────────

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    filterFns: { dbFilter: dbFilterFn },
    columnResizeMode,
    enableColumnResizing: true,
  });

  // ── Virtual row list ───────────────────────────────────────────────────────

  /**
   * Post-filter, post-sort rows. The virtualizer maps its window into this
   * array, so it always reflects the current filter + sort state.
   */
  const filteredRows = table.getRowModel().rows;

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: OVERSCAN,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // ── Derived filter state ───────────────────────────────────────────────────

  /**
   * True when at least one column has an active filter. Used to:
   *   - Show the filtered row count in the header ("42 of 1 000 rows")
   *   - Reveal the "Clear filters" button in the header
   */
  const hasActiveFilters = columnFilters.length > 0;

  /** Stable callback to clear all column filters at once. */
  const handleClearFilters = useCallback(() => {
    setColumnFilters([]);
  }, []);

  /**
   * handleCloseViewer — clears the selected cell, collapsing the ValueViewer.
   * Clears both selectedCell (ValueViewer content) and selectedCellKey (cell
   * highlight) so the UI returns fully to a no-selection state.
   * Stable via useCallback — passed as the onClose prop to ValueViewer.
   */
  const handleCloseViewer = useCallback(() => {
    setSelectedCell(null);
    setSelectedCellKey(null);
  }, []);

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

  /** All filtered+sorted rows as unknown[][] — passed to CellContextMenu for column copy. */
  const allRowArrays = useMemo(
    () => filteredRows.map((row) => row.original._row),
    [filteredRows]
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

      <ResultsHeader
        result={result}
        filteredRowCount={hasActiveFilters ? filteredRows.length : undefined}
        onClearFilters={hasActiveFilters ? handleClearFilters : undefined}
      />

      {/*
        Scroll container — the element the virtualizer observes.
        overflow-auto enables both axes; wide result sets need horizontal scroll too.
      */}
      {/*
        min-h-0 is critical here: without it, a flex-1 child cannot shrink
        below its content's natural minimum height. When the ValueViewer panel
        appears at the bottom, this container must be able to give up 200px of
        height. min-h-0 overrides the browser's default min-height: auto for
        flex items and allows the shrink to happen.
      */}
      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-auto"
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
          {/* ── Sticky header (label row + filter row) ──────────────────────── */}
          <thead className="sticky top-0 z-10">
            {/* ── Column label row ──────────────────────────────────────────── */}
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

            {/*
              ── Filter input row ─────────────────────────────────────────────
              Sits between the column labels and the data rows. Each cell holds
              a controlled text input that writes into TanStack's columnFilters
              state via column.setFilterValue().

              WHY inside <thead>:
                Both label row and filter row must be sticky together. Placing
                the filter row inside the same <thead> means the browser treats
                the whole block as one sticky unit and moves it as a whole.
            */}
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={`filter-${headerGroup.id}`}>
                {headerGroup.headers.map((header) => {
                  // Derive column index from the "col_N" ID pattern used in
                  // column definitions. The row-number column has id "__rownum__"
                  // and gets colIdx = -1, meaning it renders no input.
                  const colIdx = header.column.id.startsWith("col_")
                    ? parseInt(header.column.id.slice(4), 10)
                    : -1;
                  const isDataCol = colIdx >= 0;
                  const isNumeric = isDataCol && numericColumns.has(colIdx);
                  const colName = isDataCol ? (result.columns[colIdx] ?? "") : "";
                  const filterValue = (header.column.getFilterValue() ?? "") as string;

                  return (
                    <th
                      key={`filter-${header.id}`}
                      style={{ width: header.getSize(), position: "relative" } as CSSProperties}
                      className="px-2 py-1 border-b border-[#1f2033] bg-[#0d0d17]"
                    >
                      {isDataCol && (
                        <input
                          type="text"
                          value={filterValue}
                          onChange={(e) => header.column.setFilterValue(e.target.value)}
                          placeholder={isNumeric ? ">100" : "Filter…"}
                          aria-label={`Filter ${colName}`}
                          className={[
                            "w-full bg-[#0a0a0f] rounded",
                            "border",
                            // Active filter gets a dimmed blue border so users can
                            // see at a glance which columns are currently filtered.
                            filterValue
                              ? "border-[#3b5fa0]"
                              : "border-[#1f2033]",
                            "px-2 py-0.5 text-[10px] font-mono",
                            "text-[#ededf0] placeholder-[#2d3047]",
                            "focus:outline-none focus:border-[#3b82f6]",
                            "transition-colors duration-100",
                          ].join(" ")}
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
              const row = filteredRows[virtualRow.index];
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

                    // ── Cell-edit hookup ─────────────────────────────────
                    // We key edit state by the ORIGINAL (pre-sort) row index
                    // because cellEdit.saveEdit operates on result.rows
                    // directly — that array is in original order regardless
                    // of TanStack's current sort. _index is captured at
                    // table-data construction time and survives sort.
                    const originalRowIdx = row.original._index;
                    const isEditing =
                      isDataCol &&
                      editingCell !== null &&
                      editingCell.rowIndex === originalRowIdx &&
                      editingCell.colIndex === colIdx;
                    const dirty = isDataCol
                      ? cellEdit.dirtyCells.get(
                          `${originalRowIdx}__${colIdx}`
                        )
                      : undefined;

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
                          // Amber background for cells whose successful edit
                          // has not been overwritten by a fresh query yet.
                          // This is the "dirty" indicator users learn to
                          // associate with the cells they touched this session.
                          dirty
                            ? "bg-[#3a2c10] outline outline-1 outline-[#f59e0b]/60"
                            : "",
                        ].join(" ")}
                        onClick={() => {
                          if (isDataCol && !isEditing) {
                            setSelectedCellKey(cellKey);
                            // Open the ValueViewer with this cell's raw value and
                            // column name. Replaces any previously selected cell.
                            setSelectedCell({
                              value: row.original._row[colIdx],
                              columnName:
                                result.columns[colIdx] ?? `col_${colIdx}`,
                            });
                          }
                        }}
                        onDoubleClick={() => {
                          // Editing only fires on data columns. The row-number
                          // column is a derived value and has no UPDATE target.
                          if (!isDataCol) return;
                          // Already editing this cell → don't restart (would
                          // wipe the in-progress input).
                          if (isEditing) return;

                          const availability = cellEdit.canEditColumn(colIdx);
                          if (availability.kind !== "editable") {
                            // Surface a friendly reason — this is the user's
                            // only signal that nothing happened. Falls back
                            // to a generic message if explainAvailability
                            // returns null (the editable case, which
                            // shouldn't be reachable here).
                            setUneditableMsg(
                              explainAvailability(availability) ??
                                "Cannot edit this cell"
                            );
                            return;
                          }
                          // Enter edit mode. The CellEditor itself takes
                          // a snapshot of the value via initialValue —
                          // the row data may shift underneath if a parallel
                          // undo runs, but the input's local state is
                          // unaffected.
                          setEditingCell({
                            rowIndex: originalRowIdx,
                            colIndex: colIdx,
                          });
                        }}
                      >
                        {isEditing ? (
                          <CellEditor
                            initialValue={row.original._row[colIdx]}
                            isNumeric={isNumeric}
                            onCommit={(newValue) => {
                              // Build the SQL preview synchronously and stash
                              // it on pendingEdit. The dialog mounts on the
                              // next render and the user gets to confirm.
                              const preview = cellEdit.buildPreview(
                                originalRowIdx,
                                colIdx,
                                newValue
                              );
                              if (!preview) {
                                setUneditableMsg(
                                  "Cannot edit: missing primary key"
                                );
                                setEditingCell(null);
                                return;
                              }
                              setPendingEdit({
                                rowIndex: originalRowIdx,
                                colIndex: colIdx,
                                newValue,
                                ...preview,
                              });
                              // Leave editingCell set — it is cleared after
                              // the dialog resolves so the input doesn't
                              // disappear behind the modal mid-confirmation.
                            }}
                            onCancel={() => setEditingCell(null)}
                          />
                        ) : (
                          flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )
                        )}
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

        {/* Zero-rows message — covers both "query returned 0 rows" and "no filter matches" */}
        {filteredRows.length === 0 && (
          <div className="flex items-center justify-center h-12 text-[#2d3047] text-xs italic font-mono">
            {hasActiveFilters
              ? "No rows match the current filters"
              : "Query returned 0 rows"}
          </div>
        )}
      </div>

      {/*
        ValueViewer panel — conditionally rendered when a data cell is selected.
        Sits at the bottom of this flex column. The scroll container above it
        absorbs the height change via flex-1 min-h-0.
      */}
      {selectedCell !== null && (
        <ValueViewer
          value={selectedCell.value}
          columnName={selectedCell.columnName}
          onClose={handleCloseViewer}
        />
      )}

      {/*
        Uneditable refusal banner — appears in the same top-right slot as
        the "Copied!" toast but with an amber tone to distinguish a denial
        from a positive confirmation. Auto-clears after 2.5 s via the
        useEffect on uneditableMsg above. pointer-events-none lets clicks
        through to the grid behind it.
      */}
      {uneditableMsg && (
        <div
          className={[
            "absolute top-2 right-3 z-50 px-3 py-1.5 rounded",
            "bg-[#1a1407] border border-[#3d2c10] text-[#f59e0b]",
            "text-xs font-mono pointer-events-none max-w-[60%]",
            "animate-in fade-in-0 slide-in-from-top-1",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          {uneditableMsg}
        </div>
      )}

      {/*
        Cell-edit confirmation dialog — mounts whenever pendingEdit is set.
        Shows the formatted SQL plus the table/row identity. Confirm fires
        the PUT through cellEdit.saveEdit; on success the editing cell
        clears and the dirty highlight appears via the dirtyCells map.
        Cancel discards the pending edit and re-opens the inline editor so
        the user can amend the value (better than discarding their typing).
      */}
      {pendingEdit !== null && (
        <EditConfirmDialog
          sql={pendingEdit.sql}
          table={pendingEdit.table}
          column={pendingEdit.column}
          newValue={pendingEdit.newValue}
          pk={pendingEdit.pk}
          saving={cellEdit.saving}
          onCancel={() => {
            // Cancel returns the user to the inline editor pre-populated
            // with their last value, so they don't lose typing on a
            // double-take. clearing pendingEdit alone preserves
            // editingCell.
            setPendingEdit(null);
          }}
          onConfirm={() => {
            void cellEdit
              .saveEdit(
                pendingEdit.rowIndex,
                pendingEdit.colIndex,
                pendingEdit.newValue
              )
              .then((outcome) => {
                if (outcome.ok) {
                  // Successful save → tear down both the dialog and the
                  // inline editor; the dirty-cell map drives the amber
                  // highlight on the next render.
                  setPendingEdit(null);
                  setEditingCell(null);
                } else {
                  // Failure → keep the dialog mounted so the user sees
                  // the error and can retry without re-typing the value.
                  setUneditableMsg(`Update failed: ${outcome.error}`);
                  setPendingEdit(null);
                }
              });
          }}
        />
      )}
    </div>
  );
}
