/**
 * src/client/components/Results/EmptyState/index.tsx
 *
 * ===== FILE PURPOSE =====
 * Smart "what should I run?" placeholder for the results panel. Shown by
 * DataGrid in place of the old static "Run a query to see results" hint
 * whenever the active tab has no result, no error, and is not currently
 * loading.
 *
 * Reads the live database schema from Zustand, builds up to four CLICKABLE
 * query suggestions via buildSuggestions(), and renders each via
 * SuggestionTile. Clicking a suggestion loads its SQL into the active tab
 * AND auto-runs it.
 *
 * The state DISAPPEARS the moment any character is typed into the editor —
 * at that point the user already knows what they want to run, and surfacing
 * canned suggestions becomes noise.
 *
 * ===== ARCHITECTURE =====
 *
 *   index.tsx (this file)            — React component, store wiring, click handler
 *     ├─ buildSuggestions.ts         — pure schema → Suggestion[] orchestrator
 *     │    └─ columnHelpers.ts       — numeric / enum classifiers, FK normalizer
 *     └─ SuggestionTile.tsx          — one tile (button + accent letter + SQL)
 *
 * Splitting along these seams keeps each file under ~200 lines, makes the
 * suggestion engine independently testable, and lets the React layer focus
 * on Zustand wiring and lifecycle decisions.
 *
 * ===== LIFECYCLE STATES =====
 *
 *   - schema loading / no schema yet  → quiet "Run a query to see results"
 *   - editor non-empty (typing)       → quiet "Run a query to see results"
 *   - schema produced no suggestions  → quiet "Run a query to see results"
 *   - schema loaded, editor empty     → suggestion list
 *
 * Why we render the quiet fallback instead of returning null when typing:
 *   DataGrid's parent panel is flex-1 with a fixed minimum height; returning
 *   null would leave a blank gray rectangle that looks broken. A single
 *   centered hint occupies the same visual real estate as the suggestion
 *   list, so the panel never appears empty.
 *
 * ===== DESIGN DECISIONS =====
 *
 * Why suggestions auto-run on click instead of just populating the editor:
 *   The spec is explicit: "Click -> populates editor AND auto-runs". This
 *   removes a friction step ("oh I have to press Run too") for what is a
 *   deliberate, low-cost action — every suggestion is a read-only query
 *   bounded with LIMIT 20 or an aggregate.
 *
 * Why no SQL identifier quoting on table / column names:
 *   Same trade-off as SchemaTree.tsx's preview button: the server forwards
 *   SQL verbatim to Knex, so a column literally named "select" or with a
 *   hyphen would syntax-error. For a localhost dev tool with self-trusted
 *   schemas this is acceptable. Adding dialect-aware quoting would require
 *   shipping the dialect down here from the connection-info store; not worth
 *   it until somebody hits the limitation in the wild.
 */

import { useCallback, useMemo } from "react";
import { useAppStore } from "../../../stores/app";
import { useQueryExecution } from "../../../hooks/useQuery";
import { buildSuggestions, type Suggestion } from "./buildSuggestions";
import { SuggestionTile } from "./SuggestionTile";

// ===== COMPONENT =====

/**
 * EmptyState — schema-driven suggestions panel rendered by DataGrid when the
 * active tab has no result, no error, and is not currently loading.
 *
 * Reads everything it needs from Zustand directly (no props): schema slices
 * to build suggestions, the active tab id + sql to know whether to show
 * suggestions or the quiet fallback, and the loadSqlFromHistory action to
 * inject the chosen SQL into the editor.
 */
export function EmptyState() {
  // ── Store reads ───────────────────────────────────────────────────────────
  // Pull EXACTLY the slices we need so unrelated store updates (a history
  // push, a connection-status refresh) do not re-render this panel.
  const schemaMap = useAppStore((s) => s.schemaMap);
  const schemaColumns = useAppStore((s) => s.schemaColumns);
  const schemaRowCounts = useAppStore((s) => s.schemaRowCounts);
  const schemaLoading = useAppStore((s) => s.schemaLoading);

  // Active-tab id + sql so we can:
  //   (a) detect "user is composing" (sql.trim() !== "") and hide suggestions
  //   (b) inject SQL into the right tab when a suggestion is clicked.
  const activeTabId = useAppStore(
    (s) => s.tabs[s.activeTabIndex]?.id ?? null
  );
  const activeTabSql = useAppStore(
    (s) => s.tabs[s.activeTabIndex]?.sql ?? ""
  );

  const loadSqlFromHistory = useAppStore((s) => s.loadSqlFromHistory);

  // ── Query execution ───────────────────────────────────────────────────────
  // Reuse the same imperative pipeline that Cmd+Enter goes through. This
  // keeps history bookkeeping, error formatting, and result-state writes in
  // one place — clicking a suggestion is indistinguishable from typing the
  // suggestion and pressing Run.
  const { execute } = useQueryExecution();

  // ── Derived: suggestion catalog ───────────────────────────────────────────
  // Recompute only when the schema OR the row counts change. Memoizing on
  // these three slices avoids walking every column on every keystroke (the
  // active-tab sql we read above triggers re-renders on every keystroke).
  const suggestions = useMemo<Suggestion[]>(() => {
    if (schemaMap == null || schemaColumns == null) return [];
    return buildSuggestions(schemaMap, schemaColumns, schemaRowCounts ?? {});
  }, [schemaMap, schemaColumns, schemaRowCounts]);

  // ── Click handler ─────────────────────────────────────────────────────────

  /**
   * runSuggestion — single-call "load & go" for a suggestion tile.
   *
   * Order matters: we MUST update the store's tab.sql (via loadSqlFromHistory)
   * BEFORE calling execute(sql). loadSqlFromHistory both writes the new SQL
   * into the tab and bumps loadNonce, which the SqlEditor's external-injection
   * effect uses to swap its CodeMirror document to match. execute() then runs
   * the same SQL string against /api/query, and useQueryExecution writes the
   * result into the active tab — at which point the EmptyState is naturally
   * unmounted by DataGrid because `result != null`.
   *
   * Why the activeTabId guard:
   *   activeTabId can transiently be null during a tab close/create race
   *   (the store always rebuilds with a tab, but we read a slice not the
   *   whole array). Bailing out of the load step but still calling execute()
   *   means the user still sees their query run; useQueryExecution snapshots
   *   the active tab id internally for its own writes.
   */
  const runSuggestion = useCallback(
    (sql: string) => {
      if (activeTabId != null) {
        loadSqlFromHistory(activeTabId, sql);
      }
      void execute(sql);
    },
    [activeTabId, loadSqlFromHistory, execute]
  );

  // ===== RENDER: QUIET FALLBACK CASES =====
  // Three cases share the same minimal hint: schema not yet ready, editor is
  // already non-empty (user is composing), or schema produced no usable
  // suggestions (e.g. an empty database).

  const editorHasContent = activeTabSql.trim() !== "";
  const schemaUnavailable =
    schemaLoading || schemaMap == null || suggestions.length === 0;

  if (editorHasContent || schemaUnavailable) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">
          Run a query to see results
        </p>
      </div>
    );
  }

  // ===== RENDER: SUGGESTION LIST =====

  return (
    <div className="h-full flex items-start justify-center overflow-y-auto">
      <div className="w-full max-w-md px-6 py-8">
        {/* ===== HEADER ===== */}
        <div className="mb-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-widest text-[#4b5563]">
            Get started
          </h2>
          <p className="mt-1 text-[11px] text-[#374151] font-mono">
            Click a query below — it loads into the editor and runs.
          </p>
        </div>

        {/* ===== SUGGESTION LIST ===== */}
        <ul className="flex flex-col gap-2" role="list">
          {suggestions.map((s) => (
            <li key={s.id}>
              <SuggestionTile suggestion={s} onClick={runSuggestion} />
            </li>
          ))}
        </ul>

        {/* ===== FOOTER HINT ===== */}
        {/*
          Tiny reassurance line below the list — answers the implicit
          "what do I do next?" without taking up more space than necessary.
        */}
        <p className="mt-4 text-[10px] italic text-[#2d3047]">
          Or type your own query above and press{" "}
          <span className="font-mono not-italic">⌘↵</span> to run.
        </p>
      </div>
    </div>
  );
}
