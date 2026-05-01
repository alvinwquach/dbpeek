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
 * ===== ARCHITECTURE =====
 *
 *   SchemaTree (this file)
 *     ├─ SearchInput          — controlled input bound to local searchTerm
 *     ├─ TableRow (per table)
 *     │    ├─ collapse arrow   — toggles expandedTables Set
 *     │    ├─ table icon       — visual affordance only
 *     │    ├─ name             — bolds matching substring during search
 *     │    ├─ row-count badge  — pulled from store.schemaRowCounts
 *     │    └─ preview button   — fires onPreview('SELECT * FROM <t> LIMIT 100')
 *     └─ ColumnRow (per column when its table is expanded)
 *          ├─ type badge       — short type label (varchar, int, timestamp, ...)
 *          ├─ column name
 *          └─ PK / FK / IX badges
 *          (clicking the row opens a ColumnStats popover for that column)
 *
 *   The popover itself is owned by SchemaTree (a single instance, repositioned
 *   when the user picks a different column) so we never have stale popovers
 *   stacked on top of each other.
 *
 * ===== STATE MODEL =====
 *
 *   searchTerm: string                       — controlled input
 *   expandedTables: Set<string>              — which tables are open
 *   selectedColumn: { table, column, rect }  — currently inspected column
 *
 *   All three are LOCAL state. Persisting them to Zustand would couple the
 *   sidebar to a feature that no other component reads — local state is the
 *   right scope for a self-contained widget.
 *
 * ===== SEARCH SEMANTICS =====
 *
 *   A table is shown if EITHER its name matches OR any of its columns matches.
 *   When a table is shown because of a column match, that table is auto-
 *   expanded so the matching column is visible without an extra click. The
 *   search is case-insensitive substring matching — the right default for
 *   "find anything containing this token" without learning regex syntax.
 *
 * ===== PROPS =====
 *
 *   onPreview: (sql: string) => void
 *     Wired up to App.tsx's `execute` from useQueryExecution. Owning the
 *     preview action at the App level keeps the sidebar decoupled from the
 *     query-execution machinery — SchemaTree just emits a SQL string.
 */

import { useMemo, useState, useCallback } from "react";
import { useAppStore } from "../../stores/app";
import type { ColumnInfo } from "../../hooks/useSchema";
import { ColumnStats } from "./ColumnStats";
import { DdlViewer } from "./DdlViewer";

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
   *
   * WHY snapshot the rect at click time instead of querying lazily:
   *   The user might scroll the sidebar after clicking. We want the popover
   *   to stay anchored to where the click happened, not to chase the row
   *   around. Snapshotting freezes the anchor.
   */
  rect: DOMRect;
}

/** Props for the top-level SchemaTree component. */
interface SchemaTreeProps {
  /**
   * Called with a generated SQL string when the user clicks the preview icon
   * on a table row. The current contract is `SELECT * FROM <table> LIMIT 100`.
   */
  onPreview: (sql: string) => void;
}

// ===== TYPE-LABEL SHORTENER =====

/**
 * Maps a dialect-native type label to a short, scannable badge text.
 *
 * WHY a dedicated helper rather than rendering the raw type:
 *   The raw types are verbose and dialect-specific:
 *     "character varying(255)"     (Postgres)
 *     "int(11) unsigned"           (MySQL)
 *     "TIMESTAMP WITHOUT TIME ZONE" (Postgres)
 *     "nvarchar"                   (MSSQL)
 *   For a 244 px sidebar that's too much chrome. The user wants a glance:
 *   "is this an int? a string? a timestamp?". Short tokens deliver that.
 *
 * STRATEGY:
 *   1. Lowercase + take the head token (prefix up to whitespace or `(`).
 *   2. Map a known set of heads to canonical short labels.
 *   3. Fallback: return the head as-is so unknown types still appear.
 */
function shortTypeBadge(type: string): string {
  const head = type.toLowerCase().trim().split(/[\s(]/)[0] ?? "";

  if (head === "uuid") return "uuid";
  if (head === "json" || head === "jsonb") return "json";
  if (head.startsWith("timestamp")) return "timestamp";
  if (head === "datetime" || head === "datetime2") return "datetime";
  if (head === "date") return "date";
  if (head === "time") return "time";
  if (head === "bool" || head === "boolean" || head === "bit") return "bool";
  if (
    head === "int" ||
    head === "integer" ||
    head === "bigint" ||
    head === "smallint" ||
    head === "tinyint" ||
    head === "mediumint" ||
    head === "int2" ||
    head === "int4" ||
    head === "int8"
  ) {
    return "int";
  }
  if (head === "serial" || head === "bigserial" || head === "smallserial") {
    return "serial";
  }
  if (head === "numeric" || head === "decimal" || head === "dec") {
    return "numeric";
  }
  if (
    head === "real" ||
    head === "double" ||
    head === "float" ||
    head === "float4" ||
    head === "float8"
  ) {
    return "float";
  }
  if (head === "money" || head === "smallmoney") return "money";
  if (head === "text" || head === "longtext" || head === "mediumtext" || head === "tinytext") {
    return "text";
  }
  if (head === "varchar" || head === "nvarchar" || head === "character") {
    return "varchar";
  }
  if (head === "char" || head === "nchar") return "char";
  if (head === "blob" || head === "bytea" || head === "varbinary") return "blob";
  if (head === "enum") return "enum";
  if (head === "interval") return "interval";

  // Fallback: keep the head token. Unknown types are still informative even
  // if they don't match a curated label.
  return head || type;
}

// ===== SEARCH HELPERS =====

/**
 * Decides whether `text` contains `needle` (case-insensitive substring).
 *
 * WHY a dedicated helper:
 *   The match logic shows up at three call sites (table name match, column
 *   name match, did-anything-match check). Centralizing it keeps the case-
 *   insensitivity rule in one place and makes the matching strategy easy
 *   to swap (e.g. fuzzy match) later without hunting all three sites.
 */
function matchesSearch(text: string, needle: string): boolean {
  if (needle === "") return true;
  return text.toLowerCase().includes(needle.toLowerCase());
}

// ===== ICONS =====
//
// Inline SVGs (rather than importing an icon library) keep the bundle small
// and let us style with Tailwind's text-color classes via fill="currentColor".

/**
 * Right-pointing chevron used as the table-row collapse indicator.
 * Rotates 90° via Tailwind utility when expanded — no second SVG needed.
 */
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={[
        "w-2.5 h-2.5 shrink-0 text-[#4b5563] transition-transform duration-100",
        open ? "rotate-90" : "",
      ].join(" ")}
      viewBox="0 0 8 8"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5L5.5 4L3 6.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Small table icon for table rows. Three horizontal bars suggest "rows of data"
 * without being a literal grid (which would compete with the chevron visually).
 */
function TableIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-[#6b7280]"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="2.5"
        width="9"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1"
      />
      <line x1="1.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="0.75" />
      <line x1="1.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

/**
 * Eye icon used for the preview action ("show me this table's first rows").
 * Universally recognized as "view" in dev tools and design apps.
 */
function PreviewIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 6S2.5 2.5 6 2.5 11 6 11 6 9.5 9.5 6 9.5 1 6 1 6Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

/**
 * Code-brackets icon used for the "Show DDL" action on a table row. The
 * angle-brackets read as "structured definition" in dev tooling — the same
 * convention used in IDEs to mean "view source / definition".
 */
function DdlIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 3L1.5 6L4.5 9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 3L10.5 6L7.5 9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Magnifying-glass icon for the search input.
 */
function SearchIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-[#4b5563]"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1" />
      <line
        x1="7.5"
        y1="7.5"
        x2="10"
        y2="10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ===== MAIN COMPONENT =====

/**
 * SchemaTree — left-sidebar database explorer.
 *
 * WHY this component is responsible for the popover too:
 *   The popover anchors to a column row inside this tree. Letting App.tsx own
 *   the popover would force the popover to thread `selectedColumn` state back
 *   through props to detect anchor changes. Owning it here keeps the data
 *   flow inside one component: column row click → setSelectedColumn → popover
 *   re-renders. App.tsx remains unaware of the column-stats feature entirely.
 */
export function SchemaTree({ onPreview }: SchemaTreeProps) {
  // ── Store reads ────────────────────────────────────────────────────────────
  // Each selector pulls a single slice. Zustand re-renders only when the
  // selected slice changes, so unrelated store updates (e.g. new history
  // entry) do not cost us a sidebar re-render.
  const schemaMap = useAppStore((s) => s.schemaMap);
  const schemaColumns = useAppStore((s) => s.schemaColumns);
  const schemaRowCounts = useAppStore((s) => s.schemaRowCounts);
  const schemaLoading = useAppStore((s) => s.schemaLoading);
  const schemaError = useAppStore((s) => s.schemaError);

  // ── Local state ────────────────────────────────────────────────────────────

  /** Current text in the search input. Empty string = "show everything". */
  const [searchTerm, setSearchTerm] = useState("");

  /**
   * Set of table names currently expanded.
   *
   * WHY a Set rather than a Record<string, boolean>:
   *   "Table is expanded" is a yes/no condition with no metadata — Set is the
   *   right shape for "membership". Set<string> also avoids the awkward
   *   `expandedTables[name] ?? false` lookup that records would force.
   */
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());

  /**
   * Currently-open column stats anchor, or null if no popover is showing.
   *
   * Re-clicking the same column closes the popover (consistent toggle UX);
   * clicking a different column moves it.
   */
  const [selectedColumn, setSelectedColumn] = useState<ColumnAnchor | null>(
    null
  );

  /**
   * Name of the table whose DDL viewer is open, or null if none.
   *
   * WHY a single string and not a Set: only one DDL modal can be open at a
   * time (it's a centered overlay). Storing the table name directly lets the
   * render branch be a simple `ddlTable && <DdlViewer table={ddlTable} ... />`.
   */
  const [ddlTable, setDdlTable] = useState<string | null>(null);

  // ── Derived: filtered table list ──────────────────────────────────────────
  //
  // WHY useMemo on (schemaMap, schemaColumns, searchTerm):
  //   Filtering walks every table and every column in the database. With a
  //   500-table schema this is non-trivial work; recomputing on every render
  //   (including cursor-position changes elsewhere via store updates) would
  //   noticeably slow down the sidebar. Memoizing pins the work to actual
  //   schema or search-term changes.
  //
  // WHAT is returned:
  //   An array of { name, columns, autoExpand } where:
  //     - tables matched by name keep their normal expand state.
  //     - tables matched only by COLUMN are flagged autoExpand=true so the
  //       matching column is visible without an extra click.

  const filteredTables = useMemo(() => {
    if (schemaMap == null || schemaColumns == null) return [];

    const tableNames = Object.keys(schemaMap).sort((a, b) =>
      a.localeCompare(b)
    );
    const trimmed = searchTerm.trim();

    return tableNames
      .map((name) => {
        const cols = schemaColumns[name] ?? [];
        const tableMatch = matchesSearch(name, trimmed);
        // For column matching we OR-reduce. Empty needle → matches everything,
        // which is the correct behavior when there's no search at all.
        const columnMatch =
          trimmed !== "" &&
          cols.some((c) => matchesSearch(c.name, trimmed));

        // Hide tables with neither name nor column match (only when searching).
        if (trimmed !== "" && !tableMatch && !columnMatch) {
          return null;
        }

        return {
          name,
          columns: cols,
          // When a column matched but the table name didn't, force-expand so
          // the matching column shows without an extra click.
          autoExpand: trimmed !== "" && columnMatch && !tableMatch,
        };
      })
      .filter((t): t is { name: string; columns: ColumnInfo[]; autoExpand: boolean } => t != null);
  }, [schemaMap, schemaColumns, searchTerm]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  /**
   * Toggles a table's expanded state.
   *
   * WHY new Set rather than mutate:
   *   Zustand-style "immutable update" makes React's reference comparison
   *   correctly detect the change. Mutating the existing Set would NOT
   *   trigger a re-render because setState's identity check would see the
   *   same Set instance.
   */
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

  /**
   * Fires the preview SQL for a table.
   *
   * WHY LIMIT 100 hard-coded:
   *   The user's spec is "SELECT * FROM table LIMIT 100". 100 rows is enough
   *   to eyeball the data without bringing back gigabytes from a large table.
   *   No configurability yet — this can become a setting later if requested.
   *
   * WHY no quoting on the table name:
   *   Server-side, the query route forwards the SQL verbatim to the driver.
   *   A column named "select" or with a hyphen would syntax-error. For now
   *   we accept that limitation: the preview button is best-effort UX, and
   *   users with quirky names can write the SQL by hand. (Future enhancement:
   *   dialect-aware identifier quoting client-side.)
   */
  const handlePreviewClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      // Stop the click from also toggling the row's expand state.
      e.stopPropagation();
      onPreview(`SELECT * FROM ${tableName} LIMIT 100`);
    },
    [onPreview]
  );

  /**
   * Opens the DDL viewer modal for a table.
   *
   * WHY stopPropagation: the DDL button lives inside the table-row container
   * which itself toggles the row's expand state on click. Without stopping
   * propagation, opening the modal would also collapse/expand the row — a
   * surprising side-effect for the user.
   */
  const handleDdlClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.stopPropagation();
      setDdlTable(tableName);
    },
    []
  );

  /** Closes the DDL viewer. Passed to DdlViewer so its dismiss paths work. */
  const closeDdlViewer = useCallback(() => setDdlTable(null), []);

  /**
   * Opens (or toggles) the ColumnStats popover for a given column.
   *
   * The clicked element is the row container — we capture its rect so the
   * popover can pin to the right edge of the sidebar at the row's vertical
   * position. If the same column is re-clicked, we close instead of moving.
   */
  const handleColumnClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, table: string, info: ColumnInfo) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      setSelectedColumn((prev) => {
        if (prev && prev.table === table && prev.column === info.name) {
          return null; // toggle-off on second click of the same column
        }
        return { table, column: info.name, info, rect };
      });
    },
    []
  );

  /** Closes the popover. Passed to ColumnStats so its dismiss button works. */
  const closePopover = useCallback(() => setSelectedColumn(null), []);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ===== HEADER (label + table count) ===== */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2033] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4b5563]">
          Schema
        </span>
        {schemaMap != null && (
          <span className="text-[9px] font-mono text-[#374151]">
            {Object.keys(schemaMap).length}{" "}
            {Object.keys(schemaMap).length === 1 ? "table" : "tables"}
          </span>
        )}
      </div>

      {/* ===== SEARCH INPUT ===== */}
      <SearchInput value={searchTerm} onChange={setSearchTerm} />

      {/* ===== BODY ===== */}
      {/*
        flex-1 + min-h-0 + overflow-y-auto: the body fills the remaining
        sidebar height and scrolls when the table list overflows.
      */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Loading state — schema fetch in flight. */}
        {schemaLoading && (
          <div className="px-3 py-4 text-[11px] italic text-[#374151] font-mono">
            Loading schema…
          </div>
        )}

        {/* Error state — fetch failed; shows the message from useSchema. */}
        {!schemaLoading && schemaError && (
          <div className="m-2 p-2 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-[10px] font-mono break-words">
            {schemaError}
          </div>
        )}

        {/* Loaded but no tables — happens for an empty database. */}
        {!schemaLoading && !schemaError && schemaMap != null &&
          Object.keys(schemaMap).length === 0 && (
            <div className="px-3 py-4 text-[11px] italic text-[#2d3047]">
              No tables in this database.
            </div>
          )}

        {/* Loaded with tables but search filtered them all out. */}
        {!schemaLoading && !schemaError && schemaMap != null &&
          Object.keys(schemaMap).length > 0 &&
          filteredTables.length === 0 && (
            <div className="px-3 py-4 text-[11px] italic text-[#2d3047]">
              No matches for &quot;{searchTerm}&quot;.
            </div>
          )}

        {/* The actual table list. */}
        {filteredTables.length > 0 && (
          <ul className="py-1" role="tree" aria-label="Database tables">
            {filteredTables.map(({ name, columns, autoExpand }) => {
              const isExpanded = autoExpand || expandedTables.has(name);
              const rowCount = schemaRowCounts?.[name];
              return (
                <TableRow
                  key={name}
                  name={name}
                  columns={columns}
                  rowCount={rowCount}
                  isExpanded={isExpanded}
                  searchTerm={searchTerm.trim()}
                  selectedColumn={
                    selectedColumn && selectedColumn.table === name
                      ? selectedColumn.column
                      : null
                  }
                  onToggleExpand={() => toggleExpand(name)}
                  onPreviewClick={(e) => handlePreviewClick(e, name)}
                  onDdlClick={(e) => handleDdlClick(e, name)}
                  onColumnClick={(e, info) => handleColumnClick(e, name, info)}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* ===== STATS POPOVER ===== */}
      {/*
        Rendered as a sibling so it can use fixed positioning relative to the
        viewport without being clipped by the sidebar's overflow-y-auto.
        Anchored to the clicked row's rect (snapshotted at click time).
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
      {/*
        Rendered as a sibling at the SchemaTree root so it overlays the entire
        viewport (the modal itself uses position:fixed). Mounting it
        conditionally — instead of rendering it always with an "open" prop —
        means TanStack Query only fires the fetch the first time the user
        actually opens the modal, and the CodeMirror EditorView is built only
        when needed.
      */}
      {ddlTable && (
        <DdlViewer table={ddlTable} onClose={closeDdlViewer} />
      )}
    </div>
  );
}

// ===== SUB-COMPONENT: SearchInput =====

/**
 * SearchInput — the controlled search input pinned below the header.
 *
 * WHY a sub-component:
 *   It bundles the icon + input + clear button into one renderable unit so
 *   the parent's JSX stays focused on the table-list rendering. Also makes
 *   the input testable in isolation if we want to add a unit test later.
 */
function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="px-2 py-2 border-b border-[#1f2033] shrink-0">
      <div className="flex items-center gap-1.5 px-2 h-6 rounded bg-[#0f0f1a] border border-[#1f2033] focus-within:border-[#3b4070] transition-colors duration-100">
        <SearchIcon />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search tables and columns…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-[#ededf0] placeholder:text-[#374151] font-mono"
          aria-label="Search schema"
        />
        {/* Clear button — only visible when there's text to clear. */}
        {value !== "" && (
          <button
            onClick={() => onChange("")}
            className="text-[#4b5563] hover:text-[#9ca3af] transition-colors duration-100 text-[10px]"
            aria-label="Clear search"
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// ===== SUB-COMPONENT: TableRow =====

/**
 * TableRow — one table in the tree, with its (conditionally rendered) columns.
 *
 * WHY this is a sub-component instead of inline JSX:
 *   Separating it lets the parent map() stay flat and keeps the per-row
 *   keyboard / click logic local. It also makes the React.memo optimization
 *   trivial to add later if needed (a table row only needs to re-render when
 *   its own props change — not when a sibling table is expanded).
 */
function TableRow({
  name,
  columns,
  rowCount,
  isExpanded,
  searchTerm,
  selectedColumn,
  onToggleExpand,
  onPreviewClick,
  onDdlClick,
  onColumnClick,
}: {
  name: string;
  columns: ColumnInfo[];
  rowCount: number | undefined;
  isExpanded: boolean;
  searchTerm: string;
  /** Name of the column whose stats popover is open, or null. */
  selectedColumn: string | null;
  onToggleExpand: () => void;
  onPreviewClick: (e: React.MouseEvent) => void;
  /** Opens the DDL viewer modal for this table. */
  onDdlClick: (e: React.MouseEvent) => void;
  onColumnClick: (e: React.MouseEvent<HTMLButtonElement>, info: ColumnInfo) => void;
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
    <li role="treeitem" aria-expanded={isExpanded}>
      {/* ===== TABLE HEADER ROW ===== */}
      <div
        onClick={onToggleExpand}
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
        <ChevronIcon open={isExpanded} />
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

/**
 * Formats a row count for the tight badge slot.
 *
 *   < 1_000        → "42"
 *   < 1_000_000    → "12.3k"
 *   < 1_000_000_000 → "4.5M"
 *   else            → "1.2B"
 *
 * WHY abbreviate at all:
 *   The badge sits next to the table name in a 244 px sidebar. A row count
 *   like "1,234,567,890" would crowd out the name. Abbreviation gives the
 *   user a magnitude at a glance; the title attribute provides the exact
 *   value on hover for the rare case it matters.
 */
function formatRowCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}k`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

// ===== SUB-COMPONENT: ColumnRow =====

/**
 * ColumnRow — a single column entry under an expanded table.
 *
 * WHY a button (not a div) for the row container:
 *   The whole row is a click target that opens the stats popover. <button>
 *   gives us correct keyboard semantics (Enter / Space activate, focus
 *   indicator) without manual ARIA wiring.
 *
 * KEY-INDICATOR BADGES:
 *   PK (amber)  — primary key
 *   FK (blue)   — foreign key reference
 *   IX (purple) — has at least one index (other than PK/FK)
 *
 *   Multiple flags can apply to one column (a PK is usually also IX). We render
 *   each badge independently so readers can identify each role at a glance —
 *   collapsing them into a single "key" badge would lose information.
 */
function ColumnRow({
  info,
  isSelected,
  onClick,
}: {
  info: ColumnInfo;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const typeLabel = shortTypeBadge(info.type);

  return (
    <li>
      <button
        onClick={onClick}
        className={[
          "w-full flex items-center gap-1.5 pl-3 pr-2 h-5 text-left",
          "hover:bg-[#0f0f1a] transition-colors duration-75",
          isSelected ? "bg-[#14142b]" : "",
        ].join(" ")}
        title={`${info.name} : ${info.type}${info.nullable ? "" : " NOT NULL"}${
          info.foreignKey
            ? ` → ${info.foreignKey.table}.${info.foreignKey.column}`
            : ""
        }`}
      >
        {/* Type badge — short label in muted slate. */}
        <span className="shrink-0 px-1 h-3.5 inline-flex items-center rounded text-[8.5px] font-mono uppercase tracking-wider text-[#6b7280] bg-[#0d0d17] border border-[#1f2033]">
          {typeLabel}
        </span>

        {/* Column name — truncates if it overflows. */}
        <span className="flex-1 min-w-0 truncate text-[10.5px] font-mono text-[#9ca3af]">
          {info.name}
          {/* A "?" suffix flags a nullable column at a glance. */}
          {info.nullable && (
            <span className="text-[#374151]" aria-hidden="true">?</span>
          )}
        </span>

        {/* Key badges — order matters: PK | FK | IX. */}
        {info.isPrimaryKey && (
          <KeyBadge label="PK" colorClass="text-[#f59e0b] border-[#3d2c14]" title="Primary key" />
        )}
        {info.foreignKey && (
          <KeyBadge
            label="FK"
            colorClass="text-[#60a5fa] border-[#1e2f4d]"
            title={`Foreign key → ${info.foreignKey.table}.${info.foreignKey.column}`}
          />
        )}
        {/* Show IX only if it's NOT already implied by PK/FK to keep the
            row uncluttered. The autocomplete-first definition of "indexed"
            still includes PK/FK indexes; the badge is for "explicit secondary
            index" which is the more interesting signal in a UI. */}
        {info.isIndexed && !info.isPrimaryKey && !info.foreignKey && (
          <KeyBadge label="IX" colorClass="text-[#a78bfa] border-[#2b1f4d]" title="Indexed" />
        )}
      </button>
    </li>
  );
}

/**
 * KeyBadge — a small uppercase pill used for PK / FK / IX flags.
 *
 * WHY a shared component:
 *   The three badges share identical layout and only differ in label, color,
 *   and tooltip. Sharing the wrapper guarantees the visual pill (size,
 *   spacing, border) stays consistent across all three.
 */
function KeyBadge({
  label,
  colorClass,
  title,
}: {
  label: string;
  /** Tailwind classes that set text + border colors. */
  colorClass: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className={[
        "shrink-0 inline-flex items-center justify-center w-5 h-3.5 rounded",
        "text-[8.5px] font-mono font-semibold tracking-wider uppercase",
        "bg-[#0d0d17] border",
        colorClass,
      ].join(" ")}
      aria-label={title}
    >
      {label}
    </span>
  );
}

