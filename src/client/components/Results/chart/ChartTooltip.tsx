/**
 * chart/ChartTooltip.tsx — dark-theme hover tooltip for bar and line charts.
 *
 * WHAT:
 *   Replaces Recharts' default tooltip, which uses inline styles that conflict
 *   with Tailwind's dark theme. Renders the x-axis label and all series values
 *   in a compact key/value list, each row colour-matched to its series line/bar.
 *
 * WHY custom instead of default:
 *   The default tooltip cannot be styled with Tailwind utility classes; it
 *   requires !important overrides or a wrapper div. A custom component is the
 *   Recharts-recommended approach and gives full control with zero hacks.
 *
 * Recharts injects `active`, `payload`, and `label` as props automatically when
 * the user hovers over a data point or bar.
 */

// ===== COMPONENT =====

interface TooltipEntry {
  name: string;
  value: number | null;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
}

/**
 * ChartTooltip — renders the floating tooltip card on hover.
 *
 * Returns null when Recharts passes active=false so the card disappears
 * cleanly without an empty box remaining on screen.
 */
export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded border border-[#2a2a4a] bg-[#0d0d1f] px-3 py-2 text-[11px] font-mono shadow-xl min-w-[120px]">
      {/* X-axis label header */}
      <p className="text-[#9ca3af] mb-1.5 truncate max-w-[200px]">{label}</p>

      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2">
          {/* Colour swatch matching the series line/bar */}
          <span
            className="shrink-0 w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
            aria-hidden="true"
          />
          <span className="text-[#6b7280] truncate max-w-[120px]">
            {entry.name}
          </span>
          <span className="ml-auto text-[#ededf0] font-semibold pl-3">
            {entry.value == null ? "—" : entry.value.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
