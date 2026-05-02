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

import { useMemo, useState, useCallback, useEffect } from "react";
import { useAppStore } from "../../stores/app";
import type { ColumnInfo } from "../../hooks/useSchema";
import { ColumnStats } from "./ColumnStats";
import { DdlViewer } from "./DdlViewer";
import { SearchInput } from "./tree/SearchInput";
import { TableRow } from "./tree/TableRow";
import { ContextMenu } from "./tree/ContextMenu";
import { ErdIcon } from "./tree/icons";

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

  // ── ERD state from store ───────────────────────────────────────────────────
  const toggleErd = useAppStore((s) => s.toggleErd);

  // ── Sidebar focus (ERD node click navigation) ─────────────────────────────
  // When the user clicks a table node in the ERD, ErdView writes the table name
  // to store.sidebarFocusTable then closes itself. The effect below picks that
  // up after the ERD unmounts, expands the target table, and scrolls to it.
  const sidebarFocusTable = useAppStore((s) => s.sidebarFocusTable);
  const setSidebarFocusTable = useAppStore((s) => s.setSidebarFocusTable);

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

  // ── Focus a table from ERD click ──────────────────────────────────────────
  /**
   * When ErdView sets sidebarFocusTable (on table node click), this effect:
   *   1. Expands the target table in the tree.
   *   2. Scrolls the table's <li> element into view.
   *   3. Clears sidebarFocusTable so the effect doesn't re-fire.
   *
   * WHY requestAnimationFrame for the scroll:
   *   setExpandedTables is a React state update — the DOM isn't updated until
   *   the next paint. scrollIntoView needs the row to be expanded (and therefore
   *   rendered) before it can measure the element's position. rAF defers the
   *   scroll until after the DOM commit.
   */
  useEffect(() => {
    if (!sidebarFocusTable) return;

    // Expand the focused table so it's visible in the tree.
    setExpandedTables((prev) => {
      const next = new Set(prev);
      next.add(sidebarFocusTable);
      return next;
    });

    // Scroll after the DOM has updated with the now-expanded row.
    requestAnimationFrame(() => {
      const el = document.getElementById(`schema-table-${CSS.escape(sidebarFocusTable)}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    // Clear the focus intent so this effect doesn't re-run.
    setSidebarFocusTable(null);
  }, [sidebarFocusTable, setSidebarFocusTable]);

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
   * Filtered + sorted list of ALL tables (excluding pinned ones) for the main
   * section. Pinned tables are rendered in their own PinnedSection above this
   * list to avoid showing them twice.
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
      {/* ===== HEADER (label + ERD button + table count) ===== */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1f2033] shrink-0">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4b5563]">
          Schema
        </span>
        <div className="flex items-center gap-2">
          {/*
            ERD button — only shown when there are tables to visualise.
            Opens the full-viewport Entity Relationship Diagram overlay that
            draws FK relationships as directed edges between table nodes.
          */}
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
