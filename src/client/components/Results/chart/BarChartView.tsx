/**
 * chart/BarChartView.tsx — categorical bar chart for text x-axis results.
 *
 * WHAT:
 *   Renders one <Bar> per numeric y-column using Recharts' BarChart. Labels are
 *   rotated -35° to avoid overlap on narrow panels. Bars animate on mount.
 *
 * WHY -35° rotation:
 *   Column labels from real queries (e.g. country names, product slugs) vary
 *   wildly in length. Rotating avoids overlap without needing to measure text
 *   widths or truncate dynamically — the browser handles the layout.
 */

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip";
import type { ChartConfig } from "./chartDetect";
import { SERIES_COLORS } from "./chartDetect";

// ===== CONSTANTS =====

/** Shared tick style applied to both axes — monospace font matching the app. */
const TICK_STYLE = {
  fill: "#4b5563",
  fontSize: 10,
  fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace",
};

// ===== COMPONENT =====

interface BarChartViewProps {
  /** Pre-computed chart specification from detectChartConfig(). */
  config: ChartConfig;
  /** Full column name array from QueryResult (for series dataKey labels). */
  columns: string[];
}

/**
 * BarChartView — renders a categorical bar chart.
 *
 * One <Bar> per y-index in config.yIndices. Series colours cycle through
 * SERIES_COLORS via modulo so any number of series gets a distinct colour.
 * Legend is suppressed for single-series results to reduce visual noise.
 */
export function BarChartView({ config, columns }: BarChartViewProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={config.data}
        margin={{ top: 8, right: 24, bottom: 48, left: 8 }}
        barCategoryGap="30%"
      >
        {/* Horizontal grid lines only — vertical lines clutter bar charts. */}
        <CartesianGrid strokeDasharray="2 4" stroke="#1f2033" vertical={false} />

        {/* X-axis: categorical labels rotated to avoid overlap. */}
        <XAxis
          dataKey="__x"
          tick={{ ...TICK_STYLE, angle: -35, textAnchor: "end" }}
          tickLine={false}
          axisLine={{ stroke: "#1f2033" }}
          interval="preserveStartEnd"
        />

        {/* Y-axis: compact number formatting (k / M suffixes). */}
        <YAxis
          tick={TICK_STYLE}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) =>
            v >= 1_000_000
              ? `${(v / 1_000_000).toFixed(1)}M`
              : v >= 1_000
              ? `${(v / 1_000).toFixed(1)}k`
              : String(v)
          }
          width={52}
        />

        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#ffffff08" }} />

        {config.yIndices.length > 1 && (
          <Legend
            wrapperStyle={{
              fontSize: 10,
              color: "#9ca3af",
              fontFamily: "ui-monospace, 'JetBrains Mono', monospace",
              paddingTop: 8,
            }}
          />
        )}

        {config.yIndices.map((yi, idx) => (
          <Bar
            key={columns[yi]}
            dataKey={columns[yi]}
            fill={SERIES_COLORS[idx % SERIES_COLORS.length]}
            radius={[2, 2, 0, 0]}
            isAnimationActive
            animationDuration={600}
            animationEasing="ease-out"
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
