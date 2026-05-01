/**
 * chart/LineChartView.tsx — temporal line chart for date/timestamp x-axis results.
 *
 * WHAT:
 *   Renders one <Line> per numeric y-column using Recharts' LineChart. Dots are
 *   shown only when the series has ≤ 60 points (denser series become unreadable
 *   with dots). Null values render as gaps, not bridges.
 *
 * WHY connectNulls={false}:
 *   Bridging a null value (drawing a line through it to the next point) implies
 *   linear interpolation across missing data, which is misleading. Gaps are the
 *   correct semantic for unknown values.
 *
 * WHY dots suppressed above 60 points:
 *   At high density the dot SVG elements overlap and turn into a smear. The
 *   line alone is readable at any density; dots add useful precision only when
 *   individual points are spaced far apart.
 */

import {
  ResponsiveContainer,
  LineChart,
  Line,
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

const TICK_STYLE = {
  fill: "#4b5563",
  fontSize: 10,
  fontFamily: "ui-monospace, 'Cascadia Code', 'JetBrains Mono', monospace",
};

/** Data points at or below this count get rendered dots; above = line only. */
const DOT_THRESHOLD = 60;

// ===== COMPONENT =====

interface LineChartViewProps {
  /** Pre-computed chart specification from detectChartConfig(). */
  config: ChartConfig;
  /** Full column name array from QueryResult (for series dataKey labels). */
  columns: string[];
}

/**
 * LineChartView — renders a temporal line chart.
 *
 * Dots appear for sparse series (≤ DOT_THRESHOLD points) and are suppressed for
 * dense ones. activeDot always renders so hover targets remain available.
 * Legend is suppressed for single-series results.
 */
export function LineChartView({ config, columns }: LineChartViewProps) {
  const showDots = config.data.length <= DOT_THRESHOLD;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart
        data={config.data}
        margin={{ top: 8, right: 24, bottom: 48, left: 8 }}
      >
        <CartesianGrid strokeDasharray="2 4" stroke="#1f2033" vertical={false} />

        <XAxis
          dataKey="__x"
          tick={{ ...TICK_STYLE, angle: -35, textAnchor: "end" }}
          tickLine={false}
          axisLine={{ stroke: "#1f2033" }}
          interval="preserveStartEnd"
        />

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

        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: "#3b4070", strokeWidth: 1 }}
        />

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
          <Line
            key={columns[yi]}
            type="monotone"
            dataKey={columns[yi]}
            stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
            strokeWidth={2}
            dot={showDots}
            activeDot={{ r: 4, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive
            animationDuration={600}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
