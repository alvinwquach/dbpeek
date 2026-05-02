/**
 * src/client/components/Diff/SchemaDiff.tsx
 *
 * ===== FILE PURPOSE =====
 * Full-screen modal that compares the structure of two database tables
 * side-by-side. The user picks Table A on the left and Table B on the right;
 * the body lists every column from either table with color-coding:
 *   - red    → column exists only in A (would be "removed" if A→B is the migration)
 *   - green  → column exists only in B (would be "added")
 *   - amber  → column exists in both but differs (type/nullable/default/PK/FK)
 *   - dim    → column exists in both and is identical
 *
 * The summary row at the top reads "X added, Y removed, Z changed" so the
 * user can grasp the shape of the diff at a glance before scanning details.
 *
 * ===== WHY A SCHEMA DIFF =====
 * The classic use case is "does staging match production?" — drift between
 * environments is the leading cause of "works on my machine" migration bugs.
 * A side-by-side view makes drift visible without copy-pasting two `\d table`
 * outputs into a third-party diff tool. It's also useful inside one database
 * for comparing pairs like `users` / `users_v2` during a refactor.
 *
 * ===== INPUT DATA =====
 * The schema comparison reads from `store.schemaColumns` — the rich
 * `ColumnInfo[]` map already populated by `useSchema()` on app mount. No
 * extra round-trips are needed: the client already has type, nullable,
 * default, isPrimaryKey, foreignKey, and isIndexed for every column of
 * every table in the connected database.
 *
 * Two table dropdowns let the user pick A and B from the same connection.
 * The defaults are seeded from the active editor tab and the next tab over
 * (when each tab's SQL is a simple `SELECT … FROM <table>` we can parse
 * the table name out via `parseSelectTable`). This satisfies the spec line
 * "Works across tabs: compare the table open in Tab 1 vs Tab 2" while still
 * allowing free-form comparison of any two tables in the schema.
 *
 * ===== MODE TOGGLE =====
 * The header carries a "Schema | Data" segmented control. Clicking "Data"
 * fires `onSwitchMode("data")`, which the parent App.tsx handles by
 * unmounting this component and mounting `<DataDiff/>` in its place.
 * The two modals are siblings, not nested, so each owns its own escape /
 * focus / scroll-lock lifecycle without any parent coordination.
 *
 * ===== RENDER ARCHITECTURE =====
 *   SchemaDiff (this file)
 *     ├─ ModeToggle      — Schema | Data segmented control (in header)
 *     ├─ TablePicker x2  — dropdowns sourced from store.schemaColumns
 *     ├─ SummaryBar      — "+3 added · -2 removed · ~5 changed" pills
 *     └─ DiffBody        — two-column scrollable grid:
 *          left  = Table A column rows   (red/dim/amber)
 *          right = Table B column rows   (green/dim/amber)
 *
 * ===== KEYBOARD =====
 *   Escape → close
 *   Backdrop click → close
 *   ✕ button → close
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../stores/app";
import type { ColumnInfo } from "../../hooks/useSchema";
import { parseSelectTable } from "../../utils/parseSelectTable";

// ===== TYPES =====

/**
 * Props accepted by the SchemaDiff modal.
 *
 * The two callbacks are the only escape hatches back to the parent. The
 * component otherwise reads everything it needs from the Zustand store, so
 * App.tsx never has to thread schema data through props.
 */
interface SchemaDiffProps {
  /** Called when the user dismisses the modal (Escape, ✕, or backdrop click). */
  onClose: () => void;
  /** Called when the user clicks the "Data" segment of the mode toggle. */
  onSwitchMode: (mode: "data") => void;
}

/**
 * One row of the side-by-side diff. Built once per render via `buildSchemaDiff`.
 *
 * `status` drives color coding and which side the row is "owned" by:
 *   - "removed"  → column exists only in A (highlight left, blank/strike right)
 *   - "added"    → column exists only in B (blank left, highlight right)
 *   - "changed"  → column exists in both, but at least one attribute differs
 *   - "same"     → column exists in both and every attribute matches
 *
 * `changes` is populated only when status === "changed". Each boolean flag
 * marks which sub-attribute differs so the body can underline only the
 * specific cell that is divergent (e.g. type but not nullable).
 */
interface SchemaColumnDiff {
  status: "added" | "removed" | "changed" | "same";
  name: string;
  a: ColumnInfo | null;
  b: ColumnInfo | null;
  changes: {
    type: boolean;
    nullable: boolean;
    defaultValue: boolean;
    isPrimaryKey: boolean;
    foreignKey: boolean;
    isIndexed: boolean;
  };
}

// ===== HELPERS =====

/**
 * sameForeignKey — structural equality for the (table, column) FK pair.
 *
 * WHY a dedicated helper instead of `JSON.stringify(a) === JSON.stringify(b)`:
 *   JSON.stringify is order-sensitive and fragile for objects with optional
 *   properties (it would treat `{a:1,b:2}` and `{b:2,a:1}` as different).
 *   A two-field comparison is faster and immune to property-order accidents.
 */
function sameForeignKey(
  a: ColumnInfo["foreignKey"],
  b: ColumnInfo["foreignKey"]
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.table === b.table && a.column === b.column;
}

/**
 * buildSchemaDiff — pure function that produces the full row list for the
 * diff body, given the column metadata of both tables.
 *
 * WHY: a single pass over the union of names lets us label each row
 * exactly once and never produce duplicates (the alternative — three
 * separate passes for added / removed / changed — would require careful
 * de-duplication and risk subtle ordering bugs).
 *
 * HOW:
 *   1. Build name → ColumnInfo maps for A and B. O(n) per side.
 *   2. Sort the UNION of names alphabetically so the output is stable
 *      regardless of how the database happens to order columns. Stable
 *      ordering matters because the user will compare runs across sessions.
 *   3. For each name decide the status by checking presence on each side.
 *      When present on both, compare every attribute and record per-flag
 *      changes so the body can underline only what differs.
 */
function buildSchemaDiff(
  a: ColumnInfo[],
  b: ColumnInfo[]
): SchemaColumnDiff[] {
  const aMap = new Map<string, ColumnInfo>();
  const bMap = new Map<string, ColumnInfo>();
  for (const c of a) aMap.set(c.name, c);
  for (const c of b) bMap.set(c.name, c);

  const allNames = Array.from(
    new Set<string>([...aMap.keys(), ...bMap.keys()])
  ).sort();

  return allNames.map<SchemaColumnDiff>((name) => {
    const ca = aMap.get(name) ?? null;
    const cb = bMap.get(name) ?? null;

    // Empty change-set placeholder. Mutated below only for the "both" case.
    const changes = {
      type: false,
      nullable: false,
      defaultValue: false,
      isPrimaryKey: false,
      foreignKey: false,
      isIndexed: false,
    };

    if (ca && !cb) return { status: "removed", name, a: ca, b: null, changes };
    if (!ca && cb) return { status: "added", name, a: null, b: cb, changes };
    if (!ca || !cb) return { status: "same", name, a: ca, b: cb, changes };

    changes.type = ca.type !== cb.type;
    changes.nullable = ca.nullable !== cb.nullable;
    changes.defaultValue = ca.defaultValue !== cb.defaultValue;
    changes.isPrimaryKey = ca.isPrimaryKey !== cb.isPrimaryKey;
    changes.foreignKey = !sameForeignKey(ca.foreignKey, cb.foreignKey);
    changes.isIndexed = ca.isIndexed !== cb.isIndexed;

    const anyChanged = Object.values(changes).some(Boolean);
    return {
      status: anyChanged ? "changed" : "same",
      name,
      a: ca,
      b: cb,
      changes,
    };
  });
}

/**
 * pickDefaultTable — best-effort resolution of which table a tab "is about".
 *
 * WHY: the user's mental model is "compare the table I'm looking at in
 * Tab 1 vs Tab 2". When a tab's SQL is a simple `SELECT … FROM users` we
 * can hand the user that pre-filled choice for free. When the SQL is
 * absent or too complex (joins, CTEs, non-SELECT) we fall back to null
 * and the user picks manually from the dropdown.
 */
function pickDefaultTable(sql: string, knownTables: string[]): string | null {
  const parsed = parseSelectTable(sql);
  if (parsed.kind !== "ok") return null;
  return knownTables.includes(parsed.table) ? parsed.table : null;
}

// ===== ICONS =====

/**
 * SwapIcon — two-arrow glyph used on the "Swap A↔B" button. Reusing the
 * universal "exchange" affordance from version-control diff tools so the
 * button reads instantly without a tooltip.
 */
function SwapIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 5h9l-2-2" />
      <path d="M13 11H4l2 2" />
    </svg>
  );
}

// ===== SUB-COMPONENT: ColumnCell =====

/**
 * Props for the per-side cell renderer.
 *
 * `present` indicates whether THIS side of the row has a column object;
 * when false the cell renders as an empty "missing" placeholder so the
 * left and right columns stay vertically aligned even when one side is
 * absent. `peerChanges` lets the cell know which sub-attributes diverged
 * from the OTHER side so it can underline only the divergent attributes.
 */
interface ColumnCellProps {
  column: ColumnInfo | null;
  present: boolean;
  status: SchemaColumnDiff["status"];
  /** Which side this cell belongs to — affects the missing-row palette. */
  side: "a" | "b";
  /** Per-attribute change flags carried from buildSchemaDiff. */
  peerChanges: SchemaColumnDiff["changes"];
}

/**
 * ColumnCell — renders ONE side of ONE row in the diff body.
 *
 * WHY a sub-component: the row body would otherwise nest three layers of
 * conditional Tailwind classes inline. Hoisting it makes the row layout
 * (left, separator, right) read as a clean two-line render. It also lets
 * us memoise here later if the diff body ever grows large.
 *
 * COLOR PALETTE (per status, per side):
 *   "removed" + side a   → red text + red bg (this column is going away)
 *   "removed" + side b   → muted "(missing)" placeholder
 *   "added"   + side a   → muted "(missing)" placeholder
 *   "added"   + side b   → green text + green bg
 *   "changed" + either   → amber text + amber bg, with per-attr underline
 *   "same"    + either   → dim default text, no background tint
 */
function ColumnCell({
  column,
  present,
  status,
  side,
  peerChanges,
}: ColumnCellProps) {
  // ── Missing placeholder ────────────────────────────────────────────────
  // When this side has no column object the row still occupies a slot so
  // that the user can SEE the asymmetry visually. The text is faint italics
  // so the eye reads it as "absent" rather than "data".
  if (!present || !column) {
    return (
      <div
        className={[
          "flex items-center min-h-[28px] px-3 py-1.5 text-[11px] font-mono italic text-[#374151]",
          "border-b border-[#1f2033]",
          // Background hint about WHY it's missing — in a "removed" row the
          // empty side is the green (would-be-added) one and vice-versa.
          status === "removed" && side === "b"
            ? "bg-emerald-950/10"
            : status === "added" && side === "a"
            ? "bg-rose-950/10"
            : "bg-transparent",
        ].join(" ")}
      >
        — not present —
      </div>
    );
  }

  // ── Row palette by diff status ─────────────────────────────────────────
  // Fully-present cells get a tinted background that matches their status.
  // The accent border on the appropriate edge points to the OTHER side so
  // the eye naturally flows L→R (added) or R→L (removed) when scanning.
  const tint =
    status === "removed"
      ? "bg-rose-950/30 text-rose-200 border-l-2 border-l-rose-500/70"
      : status === "added"
      ? "bg-emerald-950/30 text-emerald-200 border-r-2 border-r-emerald-500/70"
      : status === "changed"
      ? "bg-amber-950/25 text-amber-100"
      : "bg-transparent text-[#9ca3af]";

  // The "default" string is the only field that may be null on either side.
  // Render NULL defaults as a muted "—" so the user doesn't confuse it with
  // an empty string default.
  const defaultDisplay =
    column.defaultValue === null ? "—" : String(column.defaultValue);

  // Per-attribute underline helper. Underline a sub-attribute only when:
  //   1. status is "changed" (no sense underlining when the row is added/removed)
  //   2. the corresponding `peerChanges` flag is true
  // This lets the user spot WHICH attribute diverged without having to mentally
  // diff the two sides themselves.
  const u = (flag: boolean) =>
    status === "changed" && flag
      ? "underline decoration-amber-400 decoration-dotted underline-offset-2"
      : "";

  return (
    <div
      className={[
        "flex items-center gap-2 min-h-[28px] px-3 py-1.5 text-[11px] font-mono",
        "border-b border-[#1f2033]",
        tint,
      ].join(" ")}
    >
      {/* Column name — always present, never wraps; long names truncate. */}
      <span className="font-semibold text-[#ededf0] truncate max-w-[160px]">
        {column.name}
      </span>

      {/* Type — the most common attribute the user is comparing. */}
      <span className={["text-[#7c85d6]", u(peerChanges.type)].join(" ")}>
        {column.type}
      </span>

      {/* Nullable — rendered as "NULL" / "NOT NULL" rather than booleans
          because that mirrors how DDL would describe the column. */}
      <span
        className={["text-[#6b7280]", u(peerChanges.nullable)].join(" ")}
      >
        {column.nullable ? "NULL" : "NOT NULL"}
      </span>

      {/* Default value — shown only when relevant or divergent. Hiding "—"
          on identical no-default columns keeps the row visually quiet. */}
      {(column.defaultValue !== null || peerChanges.defaultValue) && (
        <span
          className={[
            "text-[#6b7280] truncate max-w-[140px]",
            u(peerChanges.defaultValue),
          ].join(" ")}
        >
          DEFAULT {defaultDisplay}
        </span>
      )}

      {/* Key/index badges — pushed to the right edge of the cell so the eye
          can scan them as a column down the table. */}
      <span className="ml-auto flex items-center gap-1">
        {column.isPrimaryKey && (
          <span
            className={[
              "px-1 h-4 flex items-center rounded text-[9px] font-bold",
              "bg-amber-900/40 text-amber-300 border border-amber-700/40",
              u(peerChanges.isPrimaryKey),
            ].join(" ")}
          >
            PK
          </span>
        )}
        {column.foreignKey && (
          <span
            className={[
              "px-1 h-4 flex items-center rounded text-[9px] font-bold",
              "bg-violet-900/40 text-violet-300 border border-violet-700/40",
              u(peerChanges.foreignKey),
            ].join(" ")}
            title={`FK → ${column.foreignKey.table}.${column.foreignKey.column}`}
          >
            FK
          </span>
        )}
        {column.isIndexed && !column.isPrimaryKey && (
          <span
            className={[
              "px-1 h-4 flex items-center rounded text-[9px] font-bold",
              "bg-sky-900/40 text-sky-300 border border-sky-700/40",
              u(peerChanges.isIndexed),
            ].join(" ")}
          >
            IX
          </span>
        )}
      </span>
    </div>
  );
}

// ===== MAIN COMPONENT =====

/**
 * SchemaDiff — the side-by-side schema comparison modal.
 *
 * STATE:
 *   tableA / tableB — currently selected tables. Default-seeded from the
 *     active tab's SQL and the next tab's SQL respectively (when each tab
 *     has a parseable single-table SELECT). When seeding fails, defaults
 *     fall back to the first two known tables in alphabetical order so the
 *     modal is never empty.
 *   showUnchanged — toggle to hide rows where every attribute matches.
 *     Defaults to false so the user immediately sees only the divergence.
 */
export function SchemaDiff({ onClose, onSwitchMode }: SchemaDiffProps) {
  // ── Store reads ──────────────────────────────────────────────────────
  // schemaColumns is the rich `tableName → ColumnInfo[]` map. Without it
  // we cannot render anything; the modal shows a friendly empty state.
  const schemaColumns = useAppStore((s) => s.schemaColumns);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);

  // ── Sorted list of available tables (memoized) ────────────────────────
  // Used both to seed defaults and to populate the two dropdowns. Sorted
  // alphabetically so the dropdowns are predictable across reloads.
  const knownTables = useMemo(() => {
    if (!schemaColumns) return [];
    return Object.keys(schemaColumns).sort();
  }, [schemaColumns]);

  // ── Seed default table picks from the two most relevant tabs ──────────
  // The active tab is "Tab A" by default; the next tab over is "Tab B".
  // When either pick fails (no parseable table), we fall through to the
  // first / second entries of the known table list to keep the modal
  // populated with SOMETHING the user can see immediately.
  const [tableA, setTableA] = useState<string>(() => {
    const tabA = tabs[activeTabIndex];
    return (
      pickDefaultTable(tabA?.sql ?? "", knownTables) ??
      knownTables[0] ??
      ""
    );
  });
  const [tableB, setTableB] = useState<string>(() => {
    const tabB = tabs[(activeTabIndex + 1) % Math.max(tabs.length, 1)];
    const fromTab = pickDefaultTable(tabB?.sql ?? "", knownTables);
    if (fromTab && fromTab !== tableA) return fromTab;
    // Fall back to whichever known table is NOT already selected as A so
    // the initial render shows a non-trivial diff rather than a same/same.
    return knownTables.find((t) => t !== tableA) ?? knownTables[0] ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  /** Toggle for hiding rows where every attribute matches. */
  const [showUnchanged, setShowUnchanged] = useState(false);

  // ── Build the diff (memoized on table picks) ──────────────────────────
  // The diff is fully derived from schemaColumns + the two selected tables.
  // Memoising avoids rebuilding on unrelated re-renders (e.g. when the
  // user toggles `showUnchanged`).
  const diff = useMemo(() => {
    const colsA = schemaColumns?.[tableA] ?? [];
    const colsB = schemaColumns?.[tableB] ?? [];
    return buildSchemaDiff(colsA, colsB);
  }, [schemaColumns, tableA, tableB]);

  /** Visible rows after applying the showUnchanged toggle. */
  const visibleDiff = useMemo(
    () => (showUnchanged ? diff : diff.filter((r) => r.status !== "same")),
    [diff, showUnchanged]
  );

  /** Counts for the summary bar. Computed once per diff rebuild. */
  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    let changed = 0;
    let same = 0;
    for (const row of diff) {
      if (row.status === "added") added++;
      else if (row.status === "removed") removed++;
      else if (row.status === "changed") changed++;
      else same++;
    }
    return { added, removed, changed, same };
  }, [diff]);

  // ── Swap handler ──────────────────────────────────────────────────────
  // Swapping A↔B inverts the perspective of "added" vs "removed" without
  // changing the underlying data. Useful when the user realises they had
  // staging on the right when they expected it on the left.
  const handleSwap = useCallback(() => {
    setTableA(tableB);
    setTableB(tableA);
  }, [tableA, tableB]);

  // ── Escape key + body-scroll lock ─────────────────────────────────────
  // Mirrors DdlViewer's modal lifecycle so users get the same dismissal
  // affordances throughout the app (Escape, ✕ button, backdrop click).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // ===== RENDER =====

  return (
    <div
      // Backdrop: full-viewport dimmed layer. Click → close (matches DdlViewer).
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        // Dialog itself. stopPropagation prevents the backdrop click handler
        // from firing when the user clicks INSIDE the modal (e.g. dropdown).
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Schema diff"
        className="flex flex-col w-[min(1100px,95vw)] h-[min(720px,88vh)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden text-[#ededf0]"
      >
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-3 px-3 h-10 border-b border-[#1f2033] shrink-0">
          {/* Mode toggle — segmented control between Schema and Data diff.
              Active segment matches the editor's "active tab" visual language
              (blue accent). Inactive segment dims and is hover-brightenable. */}
          <div className="flex items-center gap-0 rounded border border-[#1f2033] overflow-hidden">
            <button
              type="button"
              className="px-2.5 h-6 text-[10px] font-semibold uppercase tracking-wider bg-blue-900/30 text-blue-400 border-r border-[#1f2033]"
              aria-pressed="true"
              title="Schema diff (current)"
            >
              Schema
            </button>
            <button
              type="button"
              onClick={() => onSwitchMode("data")}
              className="px-2.5 h-6 text-[10px] font-semibold uppercase tracking-wider bg-transparent text-[#9ca3af] hover:bg-[#14142b] hover:text-[#ededf0] transition-colors duration-100"
              aria-pressed="false"
              title="Switch to data diff"
            >
              Data
            </button>
          </div>

          <span className="text-[#374151]">·</span>

          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#9ca3af]">
            Schema Diff
          </span>

          <div className="flex-1" />

          {/* Show-unchanged toggle. Hidden by default since the whole point
              of a diff view is to surface differences quickly. */}
          <label className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#9ca3af] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
              className="accent-blue-500"
            />
            Show unchanged
          </label>

          {/* Close — explicit ✕ for users who don't know about Escape. */}
          <button
            onClick={onClose}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] transition-colors duration-100"
            aria-label="Close schema diff"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== TABLE PICKERS ===== */}
        {/* Two equal-width dropdowns separated by a "swap" button. The grid
            layout exactly mirrors the diff body grid below so the column
            headers line up vertically with the columns of data they describe. */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 py-2 border-b border-[#1f2033] bg-[#0c0c14] shrink-0">
          <TablePicker
            label="A (left)"
            value={tableA}
            options={knownTables}
            onChange={setTableA}
            sideClass="text-rose-300"
          />
          <button
            type="button"
            onClick={handleSwap}
            className="flex items-center justify-center w-7 h-7 rounded border border-[#1f2033] bg-[#0f0f1a] text-[#9ca3af] hover:bg-[#14142b] hover:text-[#ededf0] transition-colors duration-100"
            aria-label="Swap A and B"
            title="Swap A ↔ B"
          >
            <SwapIcon />
          </button>
          <TablePicker
            label="B (right)"
            value={tableB}
            options={knownTables}
            onChange={setTableB}
            sideClass="text-emerald-300"
          />
        </div>

        {/* ===== SUMMARY BAR ===== */}
        {/* Single-line counts so the user can read the shape of the diff at
            a glance. Pills are color-coded matching the body palette. */}
        <div className="flex items-center gap-2 px-3 h-8 border-b border-[#1f2033] shrink-0 text-[10.5px] font-mono">
          <SummaryPill
            label={`${counts.added} added`}
            className="bg-emerald-950/40 text-emerald-300 border-emerald-700/40"
          />
          <SummaryPill
            label={`${counts.removed} removed`}
            className="bg-rose-950/40 text-rose-300 border-rose-700/40"
          />
          <SummaryPill
            label={`${counts.changed} changed`}
            className="bg-amber-950/40 text-amber-300 border-amber-700/40"
          />
          <SummaryPill
            label={`${counts.same} unchanged`}
            className="bg-[#0f0f1a] text-[#6b7280] border-[#1f2033]"
          />

          {!schemaColumns && (
            <span className="ml-auto text-[#6b7280] italic">
              Schema not yet loaded…
            </span>
          )}
        </div>

        {/* ===== DIFF BODY ===== */}
        {/* flex-1 + min-h-0 + overflow-auto so the body fills the rest of the
            modal and scrolls independently. The two-column grid keeps left
            and right cells locked at the same row height, which is essential
            for visual diffing. */}
        <div className="flex-1 min-h-0 overflow-auto">
          {tableA === tableB && (
            <div className="p-4 text-[11px] font-mono italic text-[#6b7280]">
              A and B are the same table — pick a different table for one
              side to see meaningful differences.
            </div>
          )}

          {tableA !== tableB && visibleDiff.length === 0 && (
            <div className="p-4 text-[11px] font-mono italic text-[#6b7280]">
              No differences {showUnchanged ? "" : "to show"} — the two
              tables are structurally identical.
            </div>
          )}

          {visibleDiff.length > 0 && (
            <div className="grid grid-cols-2">
              {visibleDiff.map((row) => (
                <DiffRow
                  key={row.name}
                  // Spread two cells per row — we render the row into the
                  // two-column grid by emitting both halves as siblings,
                  // letting the grid auto-flow handle the layout.
                  row={row}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== SUB-COMPONENT: DiffRow =====

/**
 * DiffRow — emits both halves of a single column-row into the two-column
 * grid. Returned as a Fragment because the grid layout flows columns
 * automatically; wrapping each row in a div would break col-1 / col-2
 * alignment between adjacent rows.
 */
function DiffRow({ row }: { row: SchemaColumnDiff }) {
  return (
    <>
      <ColumnCell
        column={row.a}
        present={row.a !== null}
        status={row.status}
        side="a"
        peerChanges={row.changes}
      />
      <ColumnCell
        column={row.b}
        present={row.b !== null}
        status={row.status}
        side="b"
        peerChanges={row.changes}
      />
    </>
  );
}

// ===== SUB-COMPONENT: TablePicker =====

/**
 * TablePicker — labelled <select> bound to one side of the diff.
 *
 * Hoisted into its own component so the JSX inside SchemaDiff stays
 * focused on layout. The browser-native <select> is intentional: a
 * custom-styled combobox would add weight without buying anything for a
 * list of identifiers most schemas keep under a few dozen entries.
 */
function TablePicker({
  label,
  value,
  options,
  onChange,
  sideClass,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (next: string) => void;
  /** Tailwind class controlling the side-label color (red for A, green for B). */
  sideClass: string;
}) {
  return (
    <label className="flex items-center gap-2 min-w-0">
      <span
        className={[
          "text-[10px] uppercase tracking-widest font-semibold shrink-0",
          sideClass,
        ].join(" ")}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 min-w-0 h-7 px-2 text-[11px] font-mono rounded border border-[#1f2033] bg-[#0f0f1a] text-[#ededf0] hover:border-[#3b4070] focus:border-blue-500/60 focus:outline-none transition-colors duration-100"
      >
        {options.length === 0 && <option value="">No tables loaded</option>}
        {options.map((t) => (
          <option key={t} value={t} className="bg-[#0a0a0f] text-[#ededf0]">
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

// ===== SUB-COMPONENT: SummaryPill =====

/**
 * SummaryPill — tiny rounded label used in the summary bar. Hoisted out
 * mostly to keep the bar's JSX from getting a four-line className soup
 * repeated four times.
 */
function SummaryPill({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={[
        "px-2 h-5 flex items-center rounded border text-[10px] font-semibold uppercase tracking-wider",
        className,
      ].join(" ")}
    >
      {label}
    </span>
  );
}
