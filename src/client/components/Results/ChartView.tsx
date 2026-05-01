/**
 * src/client/components/Results/ChartView.tsx
 *
 * WHAT:
 *   State router for the "Chart" view mode in the results panel. Selects which
 *   sub-state to render (loading / error / no-result / no-columns / no-chart /
 *   truncation-warning / chart), then delegates all chart rendering to the
 *   focused sub-modules in ./chart/.
 *
 * ARCHITECTURE:
 *   ChartView            ← this file: state router + header strip
 *   └─ chart/
 *      ├─ chartDetect.ts  ← pure: column classification + Recharts data build
 *      ├─ chartExport.ts  ← pure: SVG → PNG download
 *      ├─ ChartTooltip    ← UI: dark-theme hover tooltip
 *      ├─ BarChartView    ← UI: categorical bar chart
 *      └─ LineChartView   ← UI: temporal line chart
 *
 * MOUNT / ANIMATION:
 *   The chart wrapper div carries a key derived from the column names + row
 *   count. When a new query result arrives the wrapper re-mounts, which re-fires
 *   Recharts' entrance animation and prevents the old series morphing into the
 *   new one when column counts change.
 */

import { useMemo, useRef, useCallback } from "react";
import type { QueryResult } from "../../types";
import { detectChartConfig, SERIES_COLORS, MAX_CHART_ROWS } from "./chart/chartDetect";
import { exportChartAsPng } from "./chart/chartExport";
import { BarChartView } from "./chart/BarChartView";
import { LineChartView } from "./chart/LineChartView";

// ===== TYPES =====

interface ChartViewProps {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
}

// ===== COMPONENT =====

/**
 * ChartView — routes to the correct view for the current query state.
 *
 * States (mirrors DataGrid's pattern for visual consistency when toggling):
 *   loading              → pulsing "Running…" text
 *   error                → red error banner
 *   no result            → placeholder text
 *   non-SELECT (0 cols)  → "No columns to chart" placeholder
 *   no chartable pair    → "No chartable columns detected" (spec requirement)
 *   rows truncated       → amber warning strip above the chart
 *   chart ready          → header strip + BarChartView or LineChartView
 */
export function ChartView({ result, error, loading }: ChartViewProps) {
  const chartWrapperRef = useRef<HTMLDivElement>(null);

  // detectChartConfig is O(cols × MAX_SAMPLE_ROWS) — memoize on result identity
  // so toggling between view modes doesn't re-run it on every render.
  const config = useMemo(
    () => (result ? detectChartConfig(result) : null),
    [result]
  );

  const handleExport = useCallback(() => {
    const name =
      result && config
        ? `chart_${result.columns[config.xIndex]}_vs_${config.yIndices
            .map((i) => result.columns[i])
            .join("_")}`
        : "chart";
    void exportChartAsPng(chartWrapperRef, name);
  }, [result, config]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[#4b5563] text-xs animate-pulse font-mono">
          Running…
        </span>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
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

  // ── No query run yet ─────────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">Run a query to see a chart</p>
      </div>
    );
  }

  // ── Non-SELECT (no columns) ──────────────────────────────────────────────
  if (result.columns.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">No columns to chart</p>
      </div>
    );
  }

  // ── No chartable column pair detected ────────────────────────────────────
  if (!config) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#2d3047] text-xs italic">
          No chartable columns detected
        </p>
      </div>
    );
  }

  const truncated = result.rows.length > MAX_CHART_ROWS;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[#0a0a0f]">

      {/* ── Header strip: chart metadata + export button ─────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-b border-[#1f2033] bg-[#0d0d17]">
        <div className="flex items-center gap-3 text-[10px] font-mono text-[#4b5563]">
          <span className="uppercase tracking-widest text-[#9ca3af]">
            {config.type === "bar" ? "Bar" : "Line"}
          </span>

          <span>
            x{" "}
            <span className="text-[#ededf0]">{result.columns[config.xIndex]}</span>
          </span>

          <span>
            y{" "}
            {config.yIndices.map((yi, i) => (
              <span key={yi}>
                {i > 0 && <span className="text-[#2d3047]">, </span>}
                <span style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>
                  {result.columns[yi]}
                </span>
              </span>
            ))}
          </span>

          <span>
            {Math.min(result.rows.length, MAX_CHART_ROWS).toLocaleString()} pts
          </span>
        </div>

        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1.5 px-2 h-5 text-[9px] font-semibold uppercase tracking-wider rounded bg-[#0a0a0f] hover:bg-[#14142b] active:bg-[#1c1c38] text-[#4b5563] hover:text-[#7c85d6] border border-[#1f2033] hover:border-[#2a2a4a] transition-colors duration-100 select-none"
          title="Export chart as PNG"
        >
          Export PNG
        </button>
      </div>

      {/* ── Truncation warning ────────────────────────────────────────────── */}
      {truncated && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[#3d2e0a] bg-[#1a1408] text-[#f59e0b] text-[10px] font-mono">
          <span aria-hidden="true">⚠</span>
          <span>
            Showing first {MAX_CHART_ROWS.toLocaleString()} of{" "}
            {result.rows.length.toLocaleString()} rows
          </span>
        </div>
      )}

      {/* ── Chart ─────────────────────────────────────────────────────────── */}
      {/*
        key re-mounts (and re-animates) the chart whenever columns or row count
        change, so the entrance animation fires on each new result.
      */}
      <div
        ref={chartWrapperRef}
        key={result.columns.join("-") + result.rows.length}
        className="flex-1 min-h-0 px-2 py-3"
      >
        {config.type === "bar" ? (
          <BarChartView config={config} columns={result.columns} />
        ) : (
          <LineChartView config={config} columns={result.columns} />
        )}
      </div>

    </div>
  );
}
