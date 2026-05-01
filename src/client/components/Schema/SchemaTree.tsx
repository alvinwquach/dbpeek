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
 * Right-clicking a table row opens a context menu with a "Pin to top" option.
 * Pinned tables are hoisted into a dedicated "Pinned" section above the main
 * alphabetical list so the developer can quickly revisit the 5-10 tables that
 * matter most in a session without scrolling a 200-table list repeatedly.
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
 *     │    └─ preview button      — fires onPreview('SELECT * FROM <t> LIMIT 100')
 *     └─ ColumnRow (per column when its table is expanded)
 *          ├─ type badge          — short type label (varchar, int, timestamp, ...)
 *          ├─ column name
 *          └─ PK / FK / IX badges
 *          (clicking the row opens a ColumnStats popover for that column)
 *
 *   ContextMenu — a fixed-positioned single-item menu triggered by right-click
 *     on any TableRow. Only one can be open at a time; clicking outside or
 *     pressing Escape closes it. Rendered as a sibling at SchemaTree root so
 *     it escapes the sidebar's overflow-y-auto clip boundary.
 *
 *   The stats popover is also a sibling (same reason — avoids clipping).
 *
 * ===== STATE MODEL =====
 *
 *   searchTerm: string                       — controlled input
 *   expandedTables: Set<string>              — which tables are open
 *   selectedColumn: { table, column, rect }  — currently inspected column
 *   contextMenu: { table, x, y }             — currently open context menu
 *
 *   pinnedTables: Set<string>  →  lives in Zustand (store.pinnedTables)
 *     WHY Zustand for pins but local for the rest:
 *       Pins are the only state that a future "jump to pinned" shortcut or
 *       "pinned" indicator in another panel would need to read. Local state
 *       would force prop-drilling through App.tsx. The others are self-
 *       contained sidebar concerns that nothing outside this component cares
 *       about.
 *
 * ===== SEARCH SEMANTICS =====
 *
 *   A table is shown if EITHER its name matches OR any of its columns matches.
 *   When a table is shown because of a column match, that table is auto-
 *   expanded so the matching column is visible without an extra click. The
 *   search is case-insensitive substring matching — the right default for
 *   "find anything containing this token" without learning regex syntax.
 *
 *   The Pinned section shows pinned tables that pass the current search filter,
 *   keeping the view coherent: if you search for "user" you only see user-
 *   related tables in both sections, not unrelated pinned tables.
 *
 * ===== PROPS =====
 *
 *   onPreview: (sql: string) => void
 *     Wired up to App.tsx's `execute` from useQueryExecution. Owning the
 *     preview action at the App level keeps the sidebar decoupled from the
 *     query-execution machinery — SchemaTree just emits a SQL string.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
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

/**
 * Position + target for the right-click context menu on a table row.
 *
 * WHY store viewport x/y rather than a DOMRect:
 *   The context menu is fixed-positioned at the cursor location — we want it
 *   at the pointer tip, not at the row's bounding box edge. viewport coords
 *   (clientX / clientY) drop the menu exactly where the user right-clicked.
 */
interface ContextMenuState {
  /** Table the user right-clicked on. */
  table: string;
  /** Horizontal viewport position of the right-click cursor. */
  x: number;
  /** Vertical viewport position of the right-click cursor. */
  y: number;
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

/**
 * Filled-star icon used next to pinned tables. The fill signals "pinned" state
 * clearly without relying on color alone — screen-reader users also get the
 * aria-label "Unpin table".
 *
 * WHY a star and not a pin/thumbtack:
 *   "Star to favorite" is the dominant mental model in developer tooling
 *   (GitHub stars, VS Code pinned tabs use filled icons). A thumbtack is
 *   also common, but a 12 px thumbtack is difficult to read; a star reads
 *   clearly at that size.
 */
function StarFilledIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {/*
        A five-pointed star drawn with a single polygon.
        Points calculated for a 12×12 viewport, center at (6,6), outer-
        radius 5, inner-radius 2.
      */}
      <polygon points="6,1 7.545,4.134 11,4.635 8.5,7.072 9.09,10.511 6,8.884 2.91,10.511 3.5,7.072 1,4.635 4.455,4.134" />
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

  // ── Pin state from store ───────────────────────────────────────────────────
  // Selectors are stable references — Zustand only re-renders this component
  // when pinnedTables itself changes (i.e. on pin/unpin), not on every
  // unrelated store mutation.
  const pinnedTables = useAppStore((s) => s.pinnedTables);
  const pinTable = useAppStore((s) => s.pinTable);
  const unpinTable = useAppStore((s) => s.unpinTable);

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

  /**
   * Context menu state — the table being targeted and the cursor position.
   * Null when no context menu is open.
   *
   * WHY local and not in Zustand:
   *   The context menu is an ephemeral, per-sidebar interaction. No other
   *   component ever needs to know whether a context menu is open. Local state
   *   keeps this isolated to where it's used.
   */
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  /**
   * Helper: given a table name, determines whether it should appear in the
   * current search results and what its autoExpand state should be.
   *
   * Factored out of the two useMemo blocks below (filteredTables and
   * filteredPinnedTables) so the filter logic lives in exactly one place.
   * Returns null when the table should be hidden.
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

  /**
   * Filtered + sorted list of ALL tables (including pinned ones) for the main
   * section. Pinned tables are excluded here — they're rendered in their own
   * PinnedSection above this list to avoid showing them twice.
   *
   * WHY useMemo on (schemaMap, schemaColumns, searchTerm, pinnedTables):
   *   Filtering walks every table and every column in the database. With a
   *   500-table schema this is non-trivial work; recomputing on every render
   *   (including cursor-position changes elsewhere via store updates) would
   *   noticeably slow down the sidebar. Memoizing pins the work to actual
   *   schema or search-term changes.
   */
  const filteredTables = useMemo(() => {
    if (schemaMap == null || schemaColumns == null) return [];

    const tableNames = Object.keys(schemaMap).sort((a, b) =>
      a.localeCompare(b)
    );
    const trimmed = searchTerm.trim();

    return tableNames
      .filter((name) => !pinnedTables.has(name)) // pinned tables rendered separately
      .map((name) => buildTableEntry(name, schemaColumns[name] ?? [], trimmed))
      .filter((t): t is { name: string; columns: ColumnInfo[]; autoExpand: boolean } => t != null);
  }, [schemaMap, schemaColumns, searchTerm, pinnedTables, buildTableEntry]);

  /**
   * Filtered + sorted list of ONLY pinned tables for the Pinned section.
   * Sorted alphabetically (same as the main list) for visual consistency.
   * Respects the current search filter — if you search for "user" and a
   * pinned table doesn't match, it hides from the pinned section too.
   */
  const filteredPinnedTables = useMemo(() => {
    if (schemaMap == null || schemaColumns == null) return [];

    const trimmed = searchTerm.trim();

    return Array.from(pinnedTables)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => {
        // Table might have been dropped from the DB since it was pinned;
        // skip it gracefully rather than crashing.
        if (!(name in schemaMap)) return null;
        return buildTableEntry(name, schemaColumns[name] ?? [], trimmed);
      })
      .filter((t): t is { name: string; columns: ColumnInfo[]; autoExpand: boolean } => t != null);
  }, [schemaMap, schemaColumns, searchTerm, pinnedTables, buildTableEntry]);

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

  // ── Context menu handlers ──────────────────────────────────────────────────

  /**
   * Opens the context menu at the cursor position.
   *
   * WHY preventDefault: suppresses the browser's native context menu so ours
   *   appears instead. Without it both menus would stack.
   *
   * WHY stopPropagation: the table row div has an onClick that toggles expand;
   *   a right-click should NOT also toggle the row.
   */
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({ table: tableName, x: e.clientX, y: e.clientY });
    },
    []
  );

  /** Closes the context menu without taking any action. */
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /**
   * Handles the "Pin to top" / "Unpin" menu item click.
   *
   * Toggles the pin state for the targeted table, then immediately closes
   * the menu so the user sees the sidebar update in one motion.
   */
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

  /**
   * Closes the context menu when the user clicks the filled-star (unpin)
   * button directly on a pinned table row.
   *
   * WHY a separate handler instead of reusing handlePinToggle:
   *   The star button emits a mouse event; we need stopPropagation so the
   *   click doesn't also toggle the row's expand state. The toggle itself is
   *   the same one action — `unpinTable(tableName)` — just triggered via a
   *   different UI surface.
   */
  const handleUnpinClick = useCallback(
    (e: React.MouseEvent, tableName: string) => {
      e.stopPropagation();
      unpinTable(tableName);
    },
    [unpinTable]
  );

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

        {/* ===== PINNED SECTION ===== */}
        {/*
          Rendered above the main list whenever at least one table is pinned
          AND passes the current search filter. The section header ("Pinned")
          uses the same visual language as the outer "Schema" header — small
          caps, wide tracking, muted color — so the two sections feel like
          siblings inside a single coherent sidebar.
        */}
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
                    name={name}
                    columns={columns}
                    rowCount={rowCount}
                    isExpanded={isExpanded}
                    searchTerm={searchTerm.trim()}
                    isPinned
                    selectedColumn={
                      selectedColumn && selectedColumn.table === name
                        ? selectedColumn.column
                        : null
                    }
                    onToggleExpand={() => toggleExpand(name)}
                    onPreviewClick={(e) => handlePreviewClick(e, name)}
                    onDdlClick={(e) => handleDdlClick(e, name)}
                    onColumnClick={(e, info) => handleColumnClick(e, name, info)}
                    onContextMenu={(e) => handleContextMenu(e, name)}
                    onUnpinClick={(e) => handleUnpinClick(e, name)}
                  />
                );
              })}
            </ul>
            {/* Divider between pinned and main sections. */}
            <div className="border-b border-[#1f2033] mx-2 mb-1" />
          </>
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
                  isPinned={false}
                  selectedColumn={
                    selectedColumn && selectedColumn.table === name
                      ? selectedColumn.column
                      : null
                  }
                  onToggleExpand={() => toggleExpand(name)}
                  onPreviewClick={(e) => handlePreviewClick(e, name)}
                  onDdlClick={(e) => handleDdlClick(e, name)}
                  onColumnClick={(e, info) => handleColumnClick(e, name, info)}
                  onContextMenu={(e) => handleContextMenu(e, name)}
                  onUnpinClick={(e) => handleUnpinClick(e, name)}
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

      {/* ===== CONTEXT MENU ===== */}
      {/*
        Rendered as a sibling at the SchemaTree root so it uses fixed viewport
        positioning and is NOT clipped by the sidebar's overflow-y-auto.
        Only one context menu can be open at a time — opening a new one via
        right-click on a different row replaces the previous one.
      */}
      {contextMenu && (
        <ContextMenu
          table={contextMenu.table}
          x={contextMenu.x}
          y={contextMenu.y}
          isPinned={pinnedTables.has(contextMenu.table)}
          onPinToggle={() => handlePinToggle(contextMenu.table)}
          onClose={closeContextMenu}
        />
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
    <li role="treeitem" aria-expanded={isExpanded}>
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

// ===== SUB-COMPONENT: ContextMenu =====

/**
 * ContextMenu — the single-item right-click menu that appears over a table row.
 *
 * ===== DESIGN DECISIONS =====
 *
 * WHY a single-item menu instead of a plain button:
 *   The right-click pattern is the user's learned gesture for "what can I do
 *   with this thing". A context menu meets that expectation and leaves room to
 *   add future actions (e.g. "Copy table name", "Count rows") without adding
 *   icon-button chrome to every row in the sidebar.
 *
 * WHY fixed positioning at (x, y):
 *   The menu should appear exactly where the user right-clicked — not pinned
 *   to the sidebar edge or to the row's bounding box. fixed + clientX/clientY
 *   gives that behavior and also escapes the sidebar's overflow-y-auto clip.
 *
 * DISMISSAL:
 *   - Click outside (mousedown on the backdrop overlay)
 *   - Escape key (useEffect that listens on document)
 *   Both paths call onClose.
 *
 * VIEWPORT CLAMPING:
 *   If the cursor is near the right or bottom edge the menu would overflow.
 *   We clamp by applying max-w-[180px] and letting the browser clip naturally —
 *   acceptable for a 1-item menu that's very narrow. A full right-click library
 *   would measure the menu and flip it; that's overkill for one item.
 */
function ContextMenu({
  table,
  x,
  y,
  isPinned,
  onPinToggle,
  onClose,
}: {
  /** Table the menu targets. */
  table: string;
  /** Horizontal viewport position in px. */
  x: number;
  /** Vertical viewport position in px. */
  y: number;
  /** Whether the table is currently pinned — controls the menu item label. */
  isPinned: boolean;
  /** Called when the user clicks the pin/unpin item. */
  onPinToggle: () => void;
  /** Called when the menu should close (click-outside or Escape). */
  onClose: () => void;
}) {
  // Ref for the menu panel — used to detect "click outside" (any mousedown
  // that is NOT inside the panel) so we can close the menu.
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Dismiss on Escape ──────────────────────────────────────────────────────
  useEffect(() => {
    /**
     * Close the menu when the user presses Escape.
     *
     * WHY attach to document (not the menu div):
     *   The menu div may not have focus — the user right-clicked, not tabbed
     *   to the menu. Listening on document ensures we catch the key regardless
     *   of which element has focus.
     */
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Dismiss on click-outside ───────────────────────────────────────────────
  useEffect(() => {
    /**
     * Close the menu when the user mousedowns outside the panel.
     *
     * WHY mousedown (not click):
     *   `click` fires AFTER mouseup. If the user mousedowns outside and then
     *   mouseups on the menu, `click` would fire on the menu — confusing. Using
     *   `mousedown` catches the intent before release.
     */
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  return (
    /*
     * Invisible full-viewport backdrop. Intercepts right-clicks elsewhere so
     * the browser's native context menu doesn't appear while our menu is open.
     * The div itself does NOT close the menu on click — the mousedown handler
     * above handles dismissal so we don't need a click handler here.
     */
    <div
      className="fixed inset-0 z-50"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Menu panel — anchored at the cursor position. */}
      <div
        ref={menuRef}
        style={{ top: y, left: x }}
        className={[
          "absolute z-50 min-w-[160px] max-w-[220px]",
          "rounded border border-[#1f2033] bg-[#0d0d1a] shadow-xl",
          "py-1",
        ].join(" ")}
        role="menu"
        aria-label={`Actions for ${table}`}
      >
        {/* ── Menu item: Pin / Unpin ── */}
        <button
          onClick={onPinToggle}
          className={[
            "w-full flex items-center gap-2 px-3 h-7 text-left",
            "text-[11px] font-mono text-[#ededf0]",
            "hover:bg-[#14142b] transition-colors duration-75",
          ].join(" ")}
          role="menuitem"
        >
          {/* Star icon signals the pin/favorite action. */}
          <span
            className={isPinned ? "text-[#f59e0b]" : "text-[#4b5563]"}
            aria-hidden="true"
          >
            <StarFilledIcon />
          </span>
          {isPinned ? "Unpin table" : "Pin to top"}
        </button>
      </div>
    </div>
  );
}

