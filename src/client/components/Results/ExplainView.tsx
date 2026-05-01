/**
 * src/client/components/Results/ExplainView.tsx
 *
 * WHAT:
 *   Renders a normalized EXPLAIN plan tree returned by POST /api/explain.
 *   The tree is shown as an indented hierarchy with cost-coloured backgrounds
 *   (red >500, amber 100–500, green <100), proportional cost bars, a summary
 *   box (total cost, total estimated rows, sequential-scan count), and a
 *   warning callout when any node is a sequential scan on a non-trivial table.
 *
 * WHY a separate component from DataGrid:
 *   DataGrid is purpose-built for tabular row data — it owns sorting, virtual
 *   scroll, column resizing, etc. None of that applies to a plan tree, which
 *   is a small (usually <50-node) recursive structure best rendered as nested
 *   <div>s. Mixing the two responsibilities into DataGrid would tangle two
 *   unrelated layouts; keeping them separate also lets the editor toolbar
 *   choose which view to mount per tab via tab.viewMode.
 *
 * VISUAL SYSTEM:
 *   - Indentation: 16 px per depth level. Deep enough to scan the hierarchy at
 *     a glance, narrow enough that a 6-level tree still fits in a 340 px column.
 *   - Cost colour scheme:
 *       cost > 500   → red    (#f87171 text on #2a0e0e bg)
 *       100–500      → amber  (#f59e0b text on #2a1d0a bg)
 *       0–100        → green  (#34d399 text on #0a2018 bg)
 *       null         → muted  (#4b5563 text on #0d0d17 bg)  — used for SQLite,
 *                                                              which has no costs.
 *   - Cost bars: each row's bar width = node_cost / max_node_cost across the
 *     whole tree, rendered behind the node header. The bar uses the same
 *     colour as the text but at 15 % opacity, so the contrast tier stays
 *     legible while the bar adds a glanceable visual weight.
 *
 * SEQ SCAN WARNING:
 *   When ANY node in the tree is a sequential scan ("Seq Scan", "ALL" access
 *   type, or SQLite "SCAN TABLE") on a relation with rows > 1000, we surface
 *   a yellow callout above the tree linking to that node. This is the primary
 *   "why is my query slow" signal for someone new to query planning.
 */

import { Fragment, useMemo, useState } from "react";
import type { ExplainNode, ExplainResponse } from "../../hooks/useExplain";

// ===== CONSTANTS =====

/** Pixels of left-padding added per tree depth level. */
const INDENT_PX = 16;

/** Cost above which a node is rendered in the red "expensive" tier. */
const COST_RED = 500;

/** Cost above which a node is rendered in the amber "warning" tier. */
const COST_AMBER = 100;

/**
 * Minimum row estimate for a sequential scan to trigger the warning callout.
 * Below this threshold a seq scan is the planner's correct choice (small tables
 * fit in a single page; an index scan would be slower). 1000 is the conventional
 * cutoff used by most query-tuning guides.
 */
const SEQ_SCAN_WARN_ROWS = 1000;

// ===== TYPES =====

/** Props for the top-level ExplainView component. */
interface ExplainViewProps {
  /** Loading state — true while POST /api/explain is in flight. */
  loading: boolean;
  /** Server error message, or null. */
  error: string | null;
  /** Successful EXPLAIN response, or null if none yet. */
  data: ExplainResponse | null;
}

// ===== HELPERS =====

/**
 * tierFor — picks the colour tier for a numeric cost.
 *
 * WHY a discrete tier rather than a continuous gradient:
 *   A continuous gradient (interpolated red→amber→green) is harder to scan
 *   because adjacent nodes look nearly identical. Three discrete tiers
 *   (>500 / 100–500 / <100) give a crisper "at-a-glance" signal of which
 *   nodes deserve attention. The thresholds match the spec.
 */
function tierFor(cost: number | null): "red" | "amber" | "green" | "muted" {
  if (cost == null) return "muted";
  if (cost > COST_RED) return "red";
  if (cost >= COST_AMBER) return "amber";
  return "green";
}

/** Tailwind utility-class bundles for each tier. Centralized so colour edits don't scatter. */
const TIER_STYLES: Record<
  "red" | "amber" | "green" | "muted",
  { text: string; bg: string; bar: string; border: string }
> = {
  red:    { text: "text-[#f87171]", bg: "bg-[#1a0a0a]", bar: "bg-[#f87171]/20", border: "border-[#3d1f1f]" },
  amber:  { text: "text-[#f59e0b]", bg: "bg-[#1a1408]", bar: "bg-[#f59e0b]/20", border: "border-[#3d2e0a]" },
  green:  { text: "text-[#34d399]", bg: "bg-[#0a1814]", bar: "bg-[#34d399]/20", border: "border-[#0d2a1f]" },
  muted:  { text: "text-[#9ca3af]", bg: "bg-[#0d0d17]", bar: "bg-[#3b3d5c]/20", border: "border-[#1f2033]" },
};

/**
 * formatCost — human-friendly cost display.
 *
 * WHY a custom formatter:
 *   Cost units are arbitrary planner units. We round to one decimal up to
 *   1000, switch to comma-separated integers above that. "12345.6789" is
 *   noise; "12,346" is what a developer wants to see at a glance.
 */
function formatCost(cost: number | null): string {
  if (cost == null) return "—";
  if (cost < 1000) return cost.toFixed(1);
  return Math.round(cost).toLocaleString();
}

/** formatRows — comma-separated integer or em dash for null. */
function formatRows(rows: number | null): string {
  if (rows == null) return "—";
  return Math.round(rows).toLocaleString();
}

/**
 * isSeqScan — true if a node represents a sequential / full-table scan.
 *
 * Recognized across dialects:
 *   - Postgres: "Seq Scan"
 *   - MySQL:    type "Table Scan (ALL)" (we fold access_type into the type label)
 *   - SQLite:   "SCAN" with a table reference
 */
function isSeqScan(node: ExplainNode): boolean {
  const t = node.type.toLowerCase();
  if (t.includes("seq scan")) return true;
  if (t.includes("table scan (all)")) return true;
  if (t === "scan" && node.table != null) return true;
  return false;
}

/**
 * walkTree — depth-first iterator that yields every node in the tree.
 * Used to compute aggregate statistics (max cost, seq-scan count, etc.).
 *
 * WHY a recursive generator:
 *   Cleaner than building an intermediate array. Yields one node at a time,
 *   so multiple callers (max-cost finder, seq-scan finder) can share the same
 *   walker without allocating intermediate lists per pass.
 */
function* walkTree(node: ExplainNode): Generator<ExplainNode> {
  yield node;
  for (const child of node.children) {
    yield* walkTree(child);
  }
}

// ===== TOP-LEVEL COMPONENT =====

/**
 * ExplainView — state router for the EXPLAIN result panel.
 *
 * Mirrors the loading / error / empty / results pattern from DataGrid so the
 * two views feel like siblings when toggled in the same panel.
 */
export function ExplainView({ loading, error, data }: ExplainViewProps) {
  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[#4b5563] text-xs animate-pulse font-mono">
          Planning…
        </span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
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

  // ── No EXPLAIN run yet ─────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">
          Click Explain to see the query plan
        </p>
      </div>
    );
  }

  return <PlanTree data={data} />;
}

// ===== PLAN TREE =====

/**
 * PlanTree — renders the summary header, optional warning, and recursive tree.
 *
 * The render is split into:
 *   1. SummaryBox          — total cost, total rows, scan counts (top of panel)
 *   2. SeqScanWarning      — yellow callout (only when an offending scan exists)
 *   3. The recursive tree  — one PlanNodeRow per node, depth-aware indentation
 *   4. Raw plan toggle     — collapsible <details> with the verbatim native plan
 */
function PlanTree({ data }: { data: ExplainResponse }) {
  const { plan, raw } = data;

  // ── Aggregate stats (memoized on plan identity) ────────────────────────────
  // We compute max cost (for cost-bar width), total rows, and the list of
  // seq-scan nodes once per plan and reuse those values for both the summary
  // box and the per-node bar widths.
  const stats = useMemo(() => {
    let maxCost = 0;
    let nodeCount = 0;
    const seqScans: ExplainNode[] = [];

    for (const node of walkTree(plan)) {
      nodeCount++;
      if (node.cost != null && node.cost > maxCost) maxCost = node.cost;
      if (isSeqScan(node) && (node.rows ?? 0) >= SEQ_SCAN_WARN_ROWS) {
        seqScans.push(node);
      }
    }

    return {
      maxCost,
      nodeCount,
      // Top-level cost is the planner's overall estimate (all child costs are
      // already rolled up into the root node's Total Cost in PG / cost_info in MySQL).
      totalCost: plan.cost,
      totalRows: plan.rows,
      seqScans,
    };
  }, [plan]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0f] text-[#ededf0]">
      {/* ── Summary stats bar ─────────────────────────────────────────────── */}
      <SummaryBox
        totalCost={stats.totalCost}
        totalRows={stats.totalRows}
        nodeCount={stats.nodeCount}
        seqScanCount={stats.seqScans.length}
      />

      {/* ── Seq scan warning (only when any scan crossed the threshold) ───── */}
      {stats.seqScans.length > 0 && (
        <SeqScanWarning scans={stats.seqScans} />
      )}

      {/* ── Recursive node list ───────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-3 py-2 space-y-1">
        <PlanNodeRow node={plan} depth={0} maxCost={stats.maxCost} />

        {/* ── Raw plan toggle ─────────────────────────────────────────────── */}
        {/*
          <details>/<summary> is the lightest possible disclosure widget — no
          extra deps and the keyboard navigation is built in. The raw payload
          is useful for power users who want to compare the normalized tree
          with the dialect-native output.
        */}
        <details className="mt-4 group">
          <summary className="cursor-pointer text-[10px] uppercase tracking-widest text-[#4b5563] hover:text-[#7c85d6] select-none">
            Raw plan
          </summary>
          <pre className="mt-2 p-3 rounded border border-[#1f2033] bg-[#0d0d17] text-[10px] font-mono text-[#9ca3af] whitespace-pre-wrap break-all overflow-x-auto">
            {raw}
          </pre>
        </details>
      </div>
    </div>
  );
}

// ===== SUMMARY BOX =====

/**
 * SummaryBox — header strip showing the four numbers a developer needs first:
 * total cost, estimated rows, plan node count, and seq-scan count.
 *
 * WHY a header strip and not a card:
 *   The panel is narrow (could be ~340 px in the right rail). A dense grid of
 *   stats reads faster than vertically stacked cards. The matching height to
 *   ResultsHeader keeps DataGrid and ExplainView visually swappable.
 */
function SummaryBox({
  totalCost,
  totalRows,
  nodeCount,
  seqScanCount,
}: {
  totalCost: number | null;
  totalRows: number | null;
  nodeCount: number;
  seqScanCount: number;
}) {
  const tier = tierFor(totalCost);
  return (
    <div className="shrink-0 grid grid-cols-4 gap-2 px-3 py-2 border-b border-[#1f2033] bg-[#0d0d17] text-[10px] font-mono">
      <Stat label="Cost" value={formatCost(totalCost)} valueClass={TIER_STYLES[tier].text} />
      <Stat label="Rows" value={formatRows(totalRows)} />
      <Stat label="Nodes" value={String(nodeCount)} />
      <Stat
        label="Seq Scans"
        value={String(seqScanCount)}
        valueClass={seqScanCount > 0 ? "text-[#f59e0b]" : "text-[#9ca3af]"}
      />
    </div>
  );
}

/** Stat — single labelled metric in the summary header strip. */
function Stat({
  label,
  value,
  valueClass = "text-[#ededf0]",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[#4b5563] uppercase tracking-widest text-[9px]">{label}</span>
      <span className={`${valueClass} truncate font-semibold`}>{value}</span>
    </div>
  );
}

// ===== SEQ SCAN WARNING =====

/**
 * SeqScanWarning — yellow callout shown above the tree when any node is a
 * sequential scan on a table large enough to be a planning concern.
 *
 * WHY list the offending tables:
 *   The warning's value is in being actionable. "You have 2 seq scans" is
 *   noise; "Seq Scan on users, orders" tells the developer where to add an
 *   index. We list up to three tables before truncating to "+N more" so the
 *   callout never grows tall enough to push the tree below the fold.
 */
function SeqScanWarning({ scans }: { scans: ExplainNode[] }) {
  const tables = scans
    .map((s) => s.table)
    .filter((t): t is string => typeof t === "string");
  const shown = tables.slice(0, 3).join(", ");
  const more = tables.length > 3 ? ` +${tables.length - 3} more` : "";

  return (
    <div className="shrink-0 flex items-start gap-2 px-3 py-2 border-b border-[#3d2e0a] bg-[#1a1408] text-[#f59e0b] text-[11px] font-mono">
      <span aria-hidden="true" className="shrink-0">⚠</span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">Sequential scan detected</div>
        <div className="text-[#d97706] text-[10px] mt-0.5 truncate">
          {tables.length > 0
            ? `On ${shown}${more}. Consider adding an index.`
            : `On ${scans.length} node${scans.length === 1 ? "" : "s"}. Consider adding an index.`}
        </div>
      </div>
    </div>
  );
}

// ===== PLAN NODE ROW =====

/**
 * PlanNodeRow — one node in the indented tree, plus its recursive children.
 *
 * WHY rendering the row + children in the same component:
 *   Recursion via component composition keeps the tree's React tree mirror the
 *   data tree exactly. Each node decides its own indent (depth * INDENT_PX)
 *   and delegates child rendering to itself one level deeper. There's no need
 *   for a separate flattening pass.
 *
 * @param node    - The plan node to render at this row.
 * @param depth   - Current depth (root = 0). Drives the left padding.
 * @param maxCost - The highest cost seen anywhere in the tree, used to scale
 *                  the cost bar widths so the most expensive node has a 100%
 *                  bar and others are proportional.
 */
function PlanNodeRow({
  node,
  depth,
  maxCost,
}: {
  node: ExplainNode;
  depth: number;
  maxCost: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const tier = tierFor(node.cost);
  const styles = TIER_STYLES[tier];

  // Cost bar width: 0 if no cost or no max; otherwise fraction of the max cost.
  // Capped at 100% defensively in case the root cost equals max (it should).
  const barPct =
    node.cost != null && maxCost > 0
      ? Math.min(100, (node.cost / maxCost) * 100)
      : 0;

  // Whether the node has any data worth expanding (children OR detail keys).
  const hasDetails = Object.keys(node.details).length > 0;
  const canExpand = hasDetails;

  return (
    <div className="space-y-1">
      {/* ── Node header row ───────────────────────────────────────────────── */}
      <div
        className={`relative rounded border ${styles.border} ${styles.bg} overflow-hidden`}
        style={{ marginLeft: depth * INDENT_PX }}
      >
        {/*
          Cost bar — absolutely positioned behind the row content. Width is the
          node's share of the max cost. Pointer-events disabled so the bar doesn't
          intercept clicks on the expand toggle below.
        */}
        <div
          className={`absolute inset-y-0 left-0 ${styles.bar} pointer-events-none`}
          style={{ width: `${barPct}%` }}
          aria-hidden="true"
        />

        {/* Foreground content — relative + z-10 so it sits above the bar. */}
        <button
          type="button"
          onClick={() => canExpand && setExpanded((v) => !v)}
          disabled={!canExpand}
          className={`relative z-10 w-full flex items-center gap-2 px-2 py-1.5 text-left text-[11px] font-mono ${
            canExpand ? "cursor-pointer hover:bg-white/5" : "cursor-default"
          } transition-colors duration-100`}
          aria-expanded={canExpand ? expanded : undefined}
        >
          {/* Disclosure caret — only meaningful when expandable. */}
          <span
            className={`shrink-0 w-3 text-center text-[#4b5563] ${
              canExpand ? "" : "opacity-0"
            }`}
            aria-hidden="true"
          >
            {expanded ? "▾" : "▸"}
          </span>

          {/* Node type label — coloured by tier so cost severity is glanceable. */}
          <span className={`${styles.text} font-semibold truncate`}>
            {node.type}
          </span>

          {/* Table name (when present) — separated by "on" to read like
              "Seq Scan on users", which matches the verbatim PG plan style. */}
          {node.table && (
            <span className="text-[#9ca3af] truncate">
              on <span className="text-[#ededf0]">{node.table}</span>
            </span>
          )}

          {/* Cost + rows pushed to the right edge so they line up vertically
              across the tree even when type/table strings vary in width. */}
          <span className="ml-auto flex items-center gap-3 text-[10px] text-[#9ca3af] shrink-0">
            <span>
              <span className="text-[#4b5563]">cost </span>
              <span className={styles.text}>{formatCost(node.cost)}</span>
            </span>
            <span>
              <span className="text-[#4b5563]">rows </span>
              <span className="text-[#ededf0]">{formatRows(node.rows)}</span>
            </span>
          </span>
        </button>

        {/* ── Expanded details ─────────────────────────────────────────── */}
        {/*
          The details object is a free-form bag of dialect-specific fields
          (Index Cond, Filter, attached_condition, etc.). We render it as a
          two-column key/value list so power users can read the verbatim
          planner output without leaving the panel.
        */}
        {expanded && hasDetails && (
          <div className="relative z-10 px-2 pb-2 pt-0">
            <div className="rounded bg-black/20 border border-[#1f2033] p-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[10px] font-mono">
              {Object.entries(node.details).map(([k, v]) => (
                <Fragment key={k}>
                  <span className="text-[#4b5563] truncate">{k}</span>
                  <span className="text-[#ededf0] break-all">
                    {typeof v === "string"
                      ? v
                      : JSON.stringify(v)}
                  </span>
                </Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Recursive children ────────────────────────────────────────────── */}
      {node.children.map((child, i) => (
        <PlanNodeRow
          // Tree nodes have no stable id; using {type-table-index} per parent
          // is sufficient because we never reorder children.
          key={`${depth}-${i}-${child.type}`}
          node={child}
          depth={depth + 1}
          maxCost={maxCost}
        />
      ))}
    </div>
  );
}

