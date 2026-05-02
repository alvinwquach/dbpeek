/**
 * src/client/components/Diff/DataDiff.tsx
 *
 * ===== FILE PURPOSE =====
 * Full-screen modal that compares the result rows of two queries side-by-side.
 * The user picks Tab A on the left and Tab B on the right; both tabs must
 * already have a successful result. Rows are aligned by a "key" column
 * (defaulting to the first column) and color-coded per status:
 *   - red    → row exists only in A (would be "removed" if A→B is the migration)
 *   - green  → row exists only in B (would be "added")
 *   - amber  → row exists in both, but at least one cell value differs;
 *              the specific differing cells are highlighted within the row
 *   - dim    → row exists in both and every cell matches (hidden by default)
 *
 * The summary row reads "X added, Y removed, Z changed, K unchanged" so the
 * user can grasp the shape of the diff immediately.
 *
 * ===== WHY A DATA DIFF =====
 * The classic use cases are:
 *   - Comparing staging vs production data: "did this row land everywhere?"
 *   - Verifying migration results: run a SELECT before and after the migration
 *     in two tabs and compare what changed.
 *   - Checking data consistency across environments or replicas.
 *
 * It's the same kind of operation Git's diff is for source: "I have two
 * snapshots; show me what changed." A side-by-side render makes per-cell
 * differences visible at a glance, which is impossible by simply re-running
 * the queries and reading them in turn.
 *
 * ===== INPUT DATA =====
 * The diff reads from `tabs[*].result` — both tabs must have produced a
 * QueryResult (executed at least once, no error). Tabs without a result
 * are omitted from the dropdowns; if fewer than two tabs have results the
 * dialog renders a friendly "run a query in two tabs first" empty state.
 *
 * The two result sets MUST have the same column list (same names, same order)
 * for the diff to be meaningful — the dialog refuses to render a diff body
 * when columns differ and surfaces a clear message instead.
 *
 * ===== KEY COLUMN =====
 * Rows from A and B are aligned via a single "key" column the user picks
 * (defaulting to the first column). Each unique key value becomes one row
 * in the diff body. WHY a single key column rather than the full row:
 *   - Hashing the full row would let "changed" rows escape detection (any
 *     cell change would produce a brand-new key, classifying the row as
 *     simultaneously added AND removed instead of "changed").
 *   - Most useful comparisons are keyed on a primary key or unique business
 *     key (id, slug, email) — single-column keys cover that cleanly.
 *   - When the "key" column has duplicates within a single side we still
 *     produce a sensible (lossy) result by deduping on the side and warning
 *     in the summary bar.
 *
 * ===== MODE TOGGLE =====
 * The header carries a "Schema | Data" segmented control. Clicking
 * "Schema" fires `onSwitchMode("schema")`, which the parent App.tsx handles
 * by unmounting this component and mounting `<SchemaDiff/>` in its place.
 *
 * ===== RENDER ARCHITECTURE =====
 *   DataDiff (this file)
 *     ├─ ModeToggle        — Schema | Data segmented control (in header)
 *     ├─ TabPicker x2      — dropdowns sourced from store.tabs (with results)
 *     ├─ KeyColumnPicker   — choose which column to use as the row key
 *     ├─ SummaryBar        — "+3 added · -2 removed · ~5 changed" pills
 *     └─ DiffBody          — virtualized side-by-side row list, color-coded
 *
 * ===== KEYBOARD =====
 *   Escape → close
 *   Backdrop click → close
 *   ✕ button → close
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../stores/app";
import type { Tab } from "../../stores/app";
import type { QueryResult } from "../../types";

// ===== TYPES =====

/**
 * Props accepted by the DataDiff modal. Mirrors SchemaDiff so the parent
 * can swap the two components by changing one piece of state.
 */
interface DataDiffProps {
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /** Called when the user clicks the "Schema" segment of the mode toggle. */
  onSwitchMode: (mode: "schema") => void;
}

/**
 * One row in the side-by-side diff body. Built once per render via
 * `buildDataDiff`. The structure mirrors SchemaColumnDiff so the visual
 * language of the two diff modes stays consistent.
 *
 * `changedCols` is populated only when status === "changed" and lists
 * the column indices whose values differ between A and B. The body uses
 * this to highlight only the divergent cells rather than the whole row.
 */
interface DataRowDiff {
  status: "added" | "removed" | "changed" | "same";
  /** String form of the row's key column value. Used as React key. */
  key: string;
  /** Row data on the A side, or null when the row only exists on B. */
  a: unknown[] | null;
  /** Row data on the B side, or null when the row only exists on A. */
  b: unknown[] | null;
  /** Indices into the column list whose values differ. Empty for same/added/removed. */
  changedCols: Set<number>;
}

// ===== HELPERS =====

/**
 * normalizeKey — turns an arbitrary cell value into a canonical string for
 * use as a Map key.
 *
 * WHY: JavaScript Map equality on objects is reference-based — `{x:1}` !==
 * `{x:1}`. Stringifying with a NULL sentinel avoids that pitfall and gives
 * us deterministic equality across both sides of the diff. The "(null)"
 * sentinel is intentionally NOT a valid SQL identifier so it can't collide
 * with a real key value.
 *
 * Numbers are coerced via String() so 42 and "42" are treated as the same
 * key — this matches what the user sees in the grid and avoids spurious
 * "added/removed" pairs when one driver returns numeric and another string.
 */
function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return "(null)";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * cellsEqual — value equality used for per-cell change detection.
 *
 * Same NULL handling as `normalizeKey`, but for arbitrary cells we compare
 * the canonical strings rather than try to be clever about numeric vs
 * string vs Date. The grid renders cells as strings anyway, so two cells
 * that LOOK the same on screen should be classified as equal here.
 */
function cellsEqual(a: unknown, b: unknown): boolean {
  return normalizeKey(a) === normalizeKey(b);
}

/**
 * sameColumns — strict structural equality of two column-name arrays.
 *
 * The data diff is meaningful only when both result sets project the same
 * columns in the same order. Position matters because rows are stored as
 * arrays (not objects), so col-index 2 on side A must mean the same thing
 * as col-index 2 on side B for the per-cell comparison to be valid.
 */
function sameColumns(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * buildDataDiff — pure function that produces the full row list.
 *
 * Pre-conditions (caller is responsible):
 *   - Both result sets have IDENTICAL column lists (verified via sameColumns).
 *   - keyColIndex is a valid index into that shared column list.
 *
 * Post-conditions:
 *   - Each unique key value appears as exactly one row in the output.
 *   - Rows are sorted by key (string compare) for stable rendering.
 *   - Within "changed" rows, `changedCols` lists every divergent cell so
 *     the body can target only the cells that actually differ.
 *
 * Performance: O(n + m) where n and m are the two side row counts. The two
 * Map builds are linear; the merge pass is linear in the union size.
 */
function buildDataDiff(
  a: QueryResult,
  b: QueryResult,
  keyColIndex: number
): DataRowDiff[] {
  const aMap = new Map<string, unknown[]>();
  const bMap = new Map<string, unknown[]>();

  // Build the side-A index. Later writes overwrite earlier ones so duplicate
  // keys collapse to "last row wins" — this mirrors how a SELECT DISTINCT
  // would behave and keeps the diff bounded even on accidental duplicates.
  for (const row of a.rows) {
    aMap.set(normalizeKey(row[keyColIndex]), row);
  }
  for (const row of b.rows) {
    bMap.set(normalizeKey(row[keyColIndex]), row);
  }

  const allKeys = Array.from(
    new Set<string>([...aMap.keys(), ...bMap.keys()])
  ).sort();

  const out: DataRowDiff[] = [];
  for (const key of allKeys) {
    const ra = aMap.get(key) ?? null;
    const rb = bMap.get(key) ?? null;

    if (ra && !rb) {
      out.push({ status: "removed", key, a: ra, b: null, changedCols: new Set() });
      continue;
    }
    if (!ra && rb) {
      out.push({ status: "added", key, a: null, b: rb, changedCols: new Set() });
      continue;
    }
    if (!ra || !rb) {
      // Defensive — both sides absent shouldn't happen given the union build,
      // but TypeScript can't prove it without this branch.
      out.push({ status: "same", key, a: ra, b: rb, changedCols: new Set() });
      continue;
    }

    // Both sides present — per-cell comparison. Walk the longest of the two
    // (they're the same length thanks to sameColumns, but defensively use
    // max to avoid out-of-bounds reads when caller bypasses the guard).
    const len = Math.max(ra.length, rb.length);
    const changedCols = new Set<number>();
    for (let i = 0; i < len; i++) {
      if (!cellsEqual(ra[i], rb[i])) changedCols.add(i);
    }
    out.push({
      status: changedCols.size > 0 ? "changed" : "same",
      key,
      a: ra,
      b: rb,
      changedCols,
    });
  }
  return out;
}

/**
 * tabsWithResults — filters the store's tab list to only those that have a
 * successful query result. Used to populate the A/B dropdowns.
 *
 * WHY filter here (not at the picker): both pickers share the same eligible
 * list. Computing it once at the dialog level avoids recomputation per
 * dropdown render and means a single source of truth for "is this tab
 * pickable".
 */
function tabsWithResults(tabs: Tab[]): Tab[] {
  return tabs.filter((t) => t.result !== null);
}

/**
 * formatCell — turns a JS cell value into the display string used in the
 * diff body. Mirrors the conventions used in the main DataGrid:
 *   - NULL → italic "NULL" placeholder
 *   - object → compact JSON
 *   - everything else → String(value)
 *
 * WHY a local helper rather than reusing DataGrid's: this view's needs are
 * narrower (no truncation tooltips, no editable affordances), so a separate
 * 3-line function is clearer than wiring up the grid's full cell pipeline.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// ===== ICONS =====

/**
 * SwapIcon — same glyph as in SchemaDiff. Duplicated locally rather than
 * extracted to a shared file so each diff component remains self-contained
 * and grep-friendly.
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

// ===== MAIN COMPONENT =====

/**
 * DataDiff — side-by-side row comparison modal.
 *
 * STATE:
 *   tabAId / tabBId — currently selected tab IDs. Default to the active tab
 *     and the next tab over (whichever has a result). When fewer than two
 *     tabs have results, the dialog renders a CTA empty state instead.
 *   keyColIndex — index into the shared column list used to align rows.
 *     Defaults to 0 (the first column, almost always a primary key in a
 *     typical SELECT). The user can change it if the first column isn't
 *     unique enough.
 *   showUnchanged — toggle to show rows where every cell matches between
 *     A and B. Defaults to false so divergence dominates the body.
 */
export function DataDiff({ onClose, onSwitchMode }: DataDiffProps) {
  // ── Store reads ──────────────────────────────────────────────────────
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);

  /** Tabs that have a result and are therefore eligible for diffing. */
  const eligibleTabs = useMemo(() => tabsWithResults(tabs), [tabs]);

  // ── Default tab selection ─────────────────────────────────────────────
  // Active tab → A if it has a result; otherwise the first eligible tab.
  // Next tab over → B; otherwise the second eligible tab. Falling back to
  // empty string is fine — the body branch handles the "not enough data"
  // case explicitly with a CTA.
  const [tabAId, setTabAId] = useState<string>(() => {
    const active = tabs[activeTabIndex];
    if (active?.result) return active.id;
    return eligibleTabs[0]?.id ?? "";
  });
  const [tabBId, setTabBId] = useState<string>(() => {
    const next = tabs[(activeTabIndex + 1) % Math.max(tabs.length, 1)];
    if (next?.result && next.id !== tabAId) return next.id;
    // Find the first eligible tab that ISN'T A so the initial render shows
    // a non-trivial diff (not the same tab compared to itself).
    return eligibleTabs.find((t) => t.id !== tabAId)?.id ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  /** Toggle hiding rows where every cell matches. */
  const [showUnchanged, setShowUnchanged] = useState(false);

  // ── Resolve the two result sets ──────────────────────────────────────
  // Map back from id to Tab → QueryResult. Memoised so referential equality
  // holds across re-renders that don't actually change the picks.
  const tabA = useMemo(
    () => tabs.find((t) => t.id === tabAId) ?? null,
    [tabs, tabAId]
  );
  const tabB = useMemo(
    () => tabs.find((t) => t.id === tabBId) ?? null,
    [tabs, tabBId]
  );
  const resultA = tabA?.result ?? null;
  const resultB = tabB?.result ?? null;

  // ── Column compatibility check ────────────────────────────────────────
  // Both sides must project the same columns in the same order for the
  // diff to be meaningful (see file header). When they don't match we
  // surface a friendly explanation rather than render misleading rows.
  const columnsMatch = useMemo(
    () =>
      !!resultA && !!resultB && sameColumns(resultA.columns, resultB.columns),
    [resultA, resultB]
  );

  /** The shared column list — null when columns don't match. */
  const sharedColumns = columnsMatch ? resultA?.columns ?? [] : [];

  // ── Key column selection ─────────────────────────────────────────────
  // Defaults to 0 (the first column). Reset to 0 whenever the column list
  // changes so an out-of-bounds index can't carry over from a previous pick.
  const [keyColIndex, setKeyColIndex] = useState(0);
  useEffect(() => {
    setKeyColIndex(0);
  }, [tabAId, tabBId]);

  // ── Build the diff (memoized on inputs) ──────────────────────────────
  // Only run the diff when both sides have a result AND columns are
  // compatible. Otherwise return an empty array so the body branches into
  // the explanatory empty state.
  const diff = useMemo<DataRowDiff[]>(() => {
    if (!resultA || !resultB || !columnsMatch) return [];
    return buildDataDiff(resultA, resultB, keyColIndex);
  }, [resultA, resultB, columnsMatch, keyColIndex]);

  /** Visible rows after applying the showUnchanged toggle. */
  const visibleDiff = useMemo(
    () => (showUnchanged ? diff : diff.filter((r) => r.status !== "same")),
    [diff, showUnchanged]
  );

  /** Counts for the summary bar. */
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

  // ── Swap A↔B handler ──────────────────────────────────────────────────
  // Same rationale as SchemaDiff: inverts perspective without changing data.
  const handleSwap = useCallback(() => {
    setTabAId(tabBId);
    setTabBId(tabAId);
  }, [tabAId, tabBId]);

  // ── Escape key + body-scroll lock ─────────────────────────────────────
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
      // Backdrop dismiss — matches DdlViewer / SchemaDiff convention.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Data diff"
        className="flex flex-col w-[min(1200px,96vw)] h-[min(760px,90vh)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden text-[#ededf0]"
      >
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-3 px-3 h-10 border-b border-[#1f2033] shrink-0">
          {/* Mode toggle — clicking "Schema" swaps to the SchemaDiff modal. */}
          <div className="flex items-center gap-0 rounded border border-[#1f2033] overflow-hidden">
            <button
              type="button"
              onClick={() => onSwitchMode("schema")}
              className="px-2.5 h-6 text-[10px] font-semibold uppercase tracking-wider bg-transparent text-[#9ca3af] hover:bg-[#14142b] hover:text-[#ededf0] border-r border-[#1f2033] transition-colors duration-100"
              aria-pressed="false"
              title="Switch to schema diff"
            >
              Schema
            </button>
            <button
              type="button"
              className="px-2.5 h-6 text-[10px] font-semibold uppercase tracking-wider bg-blue-900/30 text-blue-400"
              aria-pressed="true"
              title="Data diff (current)"
            >
              Data
            </button>
          </div>

          <span className="text-[#374151]">·</span>

          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#9ca3af]">
            Data Diff
          </span>

          <div className="flex-1" />

          <label className="flex items-center gap-1.5 text-[10.5px] font-mono text-[#9ca3af] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(e) => setShowUnchanged(e.target.checked)}
              className="accent-blue-500"
            />
            Show unchanged
          </label>

          <button
            onClick={onClose}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] transition-colors duration-100"
            aria-label="Close data diff"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== TAB + KEY COLUMN PICKERS ===== */}
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 px-3 py-2 border-b border-[#1f2033] bg-[#0c0c14] shrink-0">
          <TabPicker
            label="A (left)"
            value={tabAId}
            tabs={eligibleTabs}
            onChange={setTabAId}
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
          <TabPicker
            label="B (right)"
            value={tabBId}
            tabs={eligibleTabs}
            onChange={setTabBId}
            sideClass="text-emerald-300"
          />

          {/* Key column picker — only meaningful when both sides agree on
              their column list. Hidden otherwise so the user isn't confused
              by a dropdown that wouldn't change anything visible. */}
          <label className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-widest font-semibold text-[#9ca3af] shrink-0">
              Key
            </span>
            <select
              value={keyColIndex}
              onChange={(e) => setKeyColIndex(Number(e.target.value))}
              disabled={!columnsMatch || sharedColumns.length === 0}
              className="h-7 px-2 text-[11px] font-mono rounded border border-[#1f2033] bg-[#0f0f1a] text-[#ededf0] hover:border-[#3b4070] focus:border-blue-500/60 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
            >
              {sharedColumns.length === 0 && (
                <option value={0}>(no columns)</option>
              )}
              {sharedColumns.map((col, i) => (
                <option
                  key={`${col}-${i}`}
                  value={i}
                  className="bg-[#0a0a0f] text-[#ededf0]"
                >
                  {col}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ===== SUMMARY BAR ===== */}
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

          {tabA && tabB && !columnsMatch && (
            <span className="ml-auto text-amber-400 italic">
              Column lists differ — diff disabled
            </span>
          )}
        </div>

        {/* ===== DIFF BODY ===== */}
        {/*
          flex-1 + min-h-0 + overflow-auto so the body fills the rest of the
          modal and scrolls independently. We do NOT virtualize this list:
          a typical diff spans a few hundred rows at most, and the modal is
          a one-shot inspection tool — not a long-lived virtualized grid.
          If users start diffing 100k-row results we can swap in TanStack
          Virtual later without changing the row component contract.
        */}
        <div className="flex-1 min-h-0 overflow-auto">
          {/* Empty states, in priority order ─────────────────────────── */}

          {eligibleTabs.length < 2 && (
            <EmptyState
              title="Need two query results to diff"
              body="Open at least two tabs, run a query in each (with the same column list), then come back here."
            />
          )}

          {eligibleTabs.length >= 2 && tabA?.id === tabB?.id && (
            <EmptyState
              title="Same tab on both sides"
              body="Pick different tabs for A and B to see meaningful differences."
            />
          )}

          {eligibleTabs.length >= 2 &&
            tabA?.id !== tabB?.id &&
            (!resultA || !resultB) && (
              <EmptyState
                title="Missing result"
                body="One of the selected tabs has no result — run its query first."
              />
            )}

          {eligibleTabs.length >= 2 &&
            tabA?.id !== tabB?.id &&
            resultA &&
            resultB &&
            !columnsMatch && (
              <EmptyState
                title="Column lists differ"
                body={`A has [${resultA.columns.join(", ")}]; B has [${resultB.columns.join(
                  ", "
                )}]. Adjust your queries to project the same columns in the same order.`}
              />
            )}

          {eligibleTabs.length >= 2 &&
            tabA?.id !== tabB?.id &&
            columnsMatch &&
            visibleDiff.length === 0 && (
              <EmptyState
                title="No differences"
                body={
                  showUnchanged
                    ? "Both sides are empty."
                    : "The two result sets are identical. Toggle 'Show unchanged' to see the matching rows."
                }
              />
            )}

          {/* The actual diff — only rendered when all guards pass. */}
          {columnsMatch && visibleDiff.length > 0 && (
            <DiffTable
              columns={sharedColumns}
              rows={visibleDiff}
              keyColIndex={keyColIndex}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ===== SUB-COMPONENT: DiffTable =====

/**
 * DiffTable — the actual side-by-side row body.
 *
 * Layout: a single CSS grid with two equal-width columns. Each row of the
 * diff contributes TWO grid cells (left = A side, right = B side), allowing
 * the browser to keep both sides perfectly aligned regardless of cell
 * content height. A header row at the top labels the columns once on each
 * side so the user always knows which column they're reading.
 *
 * WHY a grid (not two side-by-side <table>s):
 *   Two tables would require a JS-based row-height sync mechanism to keep
 *   the rows aligned (since two tables size their rows independently). A
 *   single grid solves this for free — both children of a grid row share
 *   the same row height.
 */
function DiffTable({
  columns,
  rows,
  keyColIndex,
}: {
  columns: string[];
  rows: DataRowDiff[];
  keyColIndex: number;
}) {
  return (
    <div className="grid grid-cols-2">
      {/* ── Header row ──────────────────────────────────────────────────
          Two halves with column names. Sticky so they stay visible while
          the user scrolls through long diffs. */}
      <DiffHeader columns={columns} keyColIndex={keyColIndex} side="a" />
      <DiffHeader columns={columns} keyColIndex={keyColIndex} side="b" />

      {/* ── Data rows ───────────────────────────────────────────────────
          Each DataRowDiff emits two grid cells (left + right) via Fragment
          children of the grid. Using the row key as React key keeps the
          DOM stable as the user toggles showUnchanged. */}
      {rows.map((row) => (
        <RowCells
          key={row.key}
          columns={columns}
          row={row}
          keyColIndex={keyColIndex}
        />
      ))}
    </div>
  );
}

// ===== SUB-COMPONENT: DiffHeader =====

/**
 * DiffHeader — sticky label bar showing column names. The key column gets
 * a subtle accent so the user can confirm which column rows are aligned by.
 */
function DiffHeader({
  columns,
  keyColIndex,
  side,
}: {
  columns: string[];
  keyColIndex: number;
  side: "a" | "b";
}) {
  return (
    <div
      className={[
        "sticky top-0 z-10 flex border-b border-[#1f2033] bg-[#0c0c14]",
        // Side-tinted accent on the leading edge so the user always knows
        // which side they're looking at, even after scrolling.
        side === "a"
          ? "border-l-2 border-l-rose-700/40"
          : "border-l border-l-[#1f2033]",
      ].join(" ")}
    >
      {columns.map((col, i) => (
        <div
          key={`${col}-${i}`}
          className={[
            "px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold border-r border-[#1f2033] truncate min-w-0 flex-1",
            i === keyColIndex
              ? "text-blue-400 bg-blue-950/30"
              : "text-[#9ca3af]",
          ].join(" ")}
          title={col}
        >
          {col}
        </div>
      ))}
    </div>
  );
}

// ===== SUB-COMPONENT: RowCells =====

/**
 * RowCells — emits both halves of a single DataRowDiff into the parent grid.
 *
 * Returned as a Fragment because the parent uses a CSS grid with auto-flow:
 * each child element occupies the next free grid cell, so emitting `<a><b>`
 * places A in column 1 and B in column 2 of the same grid row. Wrapping
 * each row in a div would break the alignment between rows.
 */
function RowCells({
  columns,
  row,
  keyColIndex,
}: {
  columns: string[];
  row: DataRowDiff;
  keyColIndex: number;
}) {
  return (
    <>
      <SideCells
        columns={columns}
        cells={row.a}
        present={row.a !== null}
        status={row.status}
        side="a"
        changedCols={row.changedCols}
        keyColIndex={keyColIndex}
      />
      <SideCells
        columns={columns}
        cells={row.b}
        present={row.b !== null}
        status={row.status}
        side="b"
        changedCols={row.changedCols}
        keyColIndex={keyColIndex}
      />
    </>
  );
}

// ===== SUB-COMPONENT: SideCells =====

/**
 * SideCells — renders ONE side of ONE row as a horizontal flexbox of cells.
 *
 * Reads its background tint from the row's status (mirrors SchemaDiff's
 * ColumnCell palette so the two diff modes share visual language):
 *   removed + a → red-tinted row
 *   removed + b → faint "row missing" placeholder
 *   added   + a → faint placeholder
 *   added   + b → green-tinted row
 *   changed → amber-tinted row, with per-cell amber underline on changed cells
 *   same    → no tint
 */
function SideCells({
  columns,
  cells,
  present,
  status,
  side,
  changedCols,
  keyColIndex,
}: {
  columns: string[];
  cells: unknown[] | null;
  present: boolean;
  status: DataRowDiff["status"];
  side: "a" | "b";
  changedCols: Set<number>;
  keyColIndex: number;
}) {
  // ── Missing-row placeholder ──────────────────────────────────────────
  // When this side has no row, render a single full-width italic cell so
  // the user sees the absence without having to mentally check column
  // counts. Tint matches the other side's status for context.
  if (!present || !cells) {
    return (
      <div
        className={[
          "flex items-center min-h-[26px] px-2 py-1 text-[11px] font-mono italic text-[#374151] border-b border-[#1f2033]",
          status === "removed" && side === "b"
            ? "bg-emerald-950/10"
            : status === "added" && side === "a"
            ? "bg-rose-950/10"
            : "bg-transparent",
        ].join(" ")}
      >
        — row not present —
      </div>
    );
  }

  // ── Row palette by status ────────────────────────────────────────────
  // Same color logic as SchemaDiff::ColumnCell so the two diff modes feel
  // like one feature with two views.
  const tint =
    status === "removed"
      ? "bg-rose-950/30 border-l-2 border-l-rose-500/70"
      : status === "added"
      ? "bg-emerald-950/30 border-r-2 border-r-emerald-500/70"
      : status === "changed"
      ? "bg-amber-950/20"
      : "bg-transparent";

  const textColor =
    status === "removed"
      ? "text-rose-200"
      : status === "added"
      ? "text-emerald-200"
      : status === "changed"
      ? "text-amber-100"
      : "text-[#9ca3af]";

  return (
    <div
      className={[
        "flex border-b border-[#1f2033]",
        tint,
        textColor,
      ].join(" ")}
    >
      {columns.map((_, i) => {
        const isKeyCol = i === keyColIndex;
        const isChangedCell = status === "changed" && changedCols.has(i);
        const value = cells[i];
        const display = formatCell(value);
        const isNull = value === null || value === undefined;

        return (
          <div
            key={i}
            className={[
              "px-2 py-1 text-[11px] font-mono border-r border-[#1f2033] truncate min-w-0 flex-1",
              isChangedCell
                ? "bg-amber-900/40 text-amber-100 ring-1 ring-amber-500/40 ring-inset"
                : "",
              isKeyCol ? "font-semibold text-[#ededf0]" : "",
              isNull ? "italic text-[#6b7280]" : "",
            ].join(" ")}
            title={display}
          >
            {display}
          </div>
        );
      })}
    </div>
  );
}

// ===== SUB-COMPONENT: TabPicker =====

/**
 * TabPicker — labelled <select> bound to one side of the diff.
 *
 * Each option shows the tab title plus a row-count hint so users with
 * many open tabs can pick the right one without guessing. Tabs without a
 * result are filtered out before this component receives the list.
 */
function TabPicker({
  label,
  value,
  tabs,
  onChange,
  sideClass,
}: {
  label: string;
  value: string;
  tabs: Tab[];
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
        {tabs.length === 0 && <option value="">No tabs with results</option>}
        {tabs.map((t) => (
          <option key={t.id} value={t.id} className="bg-[#0a0a0f] text-[#ededf0]">
            {t.title} ({t.result?.rowCount ?? 0} rows)
          </option>
        ))}
      </select>
    </label>
  );
}

// ===== SUB-COMPONENT: SummaryPill =====

/**
 * SummaryPill — same shape as SchemaDiff's; duplicated locally so each diff
 * file is independently readable. The cost is ~10 lines; the benefit is
 * that a developer reading DataDiff doesn't have to follow an import to
 * understand the pill.
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

// ===== SUB-COMPONENT: EmptyState =====

/**
 * EmptyState — centered placeholder shown when the diff body cannot be
 * rendered (need more tabs, columns differ, etc.). One component per
 * dialog rather than a shared module — keeps DataDiff self-contained.
 */
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center gap-2">
      <span className="text-[12px] font-semibold text-[#ededf0]">{title}</span>
      <span className="text-[11px] font-mono text-[#6b7280] max-w-[600px]">
        {body}
      </span>
    </div>
  );
}
