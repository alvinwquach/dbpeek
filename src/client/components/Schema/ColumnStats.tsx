/**
 * src/client/components/Schema/ColumnStats.tsx
 *
 * ===== FILE PURPOSE =====
 * Floating popover that displays aggregate statistics for one column in the
 * schema sidebar. Opens when the user clicks a column row in `SchemaTree`,
 * fetches `GET /api/schema/:table/:column/stats`, and renders:
 *
 *   - distinct value count
 *   - null percentage (with a horizontal visual bar)
 *   - min / max / avg     (numeric columns only)
 *   - top 5 values        (string / enum / non-numeric columns only)
 *
 * ===== ARCHITECTURE =====
 *
 *   ColumnStats (this file)
 *     ├─ uses TanStack Query keyed on [table, column]
 *     ├─ positions itself with `position: fixed` anchored to the row that
 *     │   was clicked (rect snapshotted by SchemaTree)
 *     ├─ closes on:
 *     │   - Escape key
 *     │   - clicking outside the popover (mousedown listener on document)
 *     │   - the explicit close (✕) button in the header
 *     └─ renders three vertical sections: Header / Universal stats / Body
 *
 * ===== POSITIONING STRATEGY =====
 *
 * The sidebar is a narrow column (244 px). Putting the popover INSIDE the
 * sidebar would either stretch the sidebar or clip the popover. Instead we
 * use `position: fixed` and place the popover JUST OUTSIDE the right edge of
 * the sidebar at the vertical position of the clicked row:
 *
 *     left  = clickedRow.right + 8 px gap
 *     top   = clickedRow.top
 *
 * If the popover would overflow the viewport bottom, we shift it up so the
 * full content remains visible. Width is fixed (260 px) so we don't have to
 * measure the content before painting.
 *
 * WHY no portal:
 *   `position: fixed` on a descendant escapes the scroll container of the
 *   sidebar (overflow-y-auto). A Portal would also work, but pulls in
 *   ReactDOM.createPortal and an extra mount target. Fixed-positioning is
 *   sufficient and keeps the component self-contained.
 *
 * ===== TANSTACK QUERY =====
 *
 *   queryKey: ["columnStats", table, column]
 *   staleTime: 5 minutes — column statistics don't change very often during
 *     a typical session, and re-running the aggregate query on every popover
 *     reopen would needlessly hit the database. 5 min covers a typical
 *     "click around the schema, come back to this column" flow without
 *     stale data lasting the whole session.
 */

import { useEffect, useRef, useMemo, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnInfo } from "../../hooks/useSchema";

// ===== TYPES =====

/**
 * Shape returned by GET /api/schema/:table/:column/stats. Mirrors the server
 * `ColumnStats` interface in src/server/routes/schema.ts.
 *
 * WHY a discriminated-by-presence shape (optional fields) rather than a
 * tagged union:
 *   See the server-side type comment for the full rationale. In short: the
 *   client wants `if (stats.min != null) ...` over `if (stats.kind === ...)`.
 */
interface ColumnStatsPayload {
  distinct: number;
  nullPct: number;
  min?: number | null;
  max?: number | null;
  avg?: number | null;
  topValues?: Array<{ value: unknown; count: number }>;
}

/** Shape of error responses from the stats endpoint. */
interface StatsErrorPayload {
  error: string;
}

/** Props for the ColumnStats popover. */
interface ColumnStatsProps {
  /** Table name the column belongs to. */
  table: string;
  /** Column name. */
  column: string;
  /** Rich column metadata, used to label the popover header. */
  info: ColumnInfo;
  /**
   * Bounding rect of the column row that was clicked. Snapshotted at click
   * time by SchemaTree so the popover anchors to where the user clicked
   * even if they scroll afterward.
   */
  anchor: DOMRect;
  /** Called when the user dismisses the popover (Escape, click-outside, ✕). */
  onClose: () => void;
}

// ===== CONSTANTS =====

/** Width of the popover. Fixed so we don't need to measure content before paint. */
const POPOVER_WIDTH_PX = 260;

/** Horizontal gap between the sidebar's right edge and the popover. */
const ANCHOR_GAP_PX = 8;

/**
 * Estimated maximum height of the popover. Used only for the bottom-overflow
 * check — if rendering the popover at `anchor.top` would push past the
 * viewport bottom, we shift it up by the overflow amount. The actual height
 * may be smaller (TanStack returns quickly and the body is short for numeric
 * stats), but using a worst-case estimate avoids mid-render measurement.
 */
const POPOVER_MAX_HEIGHT_PX = 320;

// ===== FETCHER =====

/**
 * Fetches stats for one (table, column). Throws on non-2xx so TanStack Query
 * can put the query into error state — the popover's error branch reads from
 * the thrown message.
 */
async function fetchColumnStats(
  table: string,
  column: string
): Promise<ColumnStatsPayload> {
  // URL-encode both segments. The server has its own whitelist, but encoding
  // is the right client-side hygiene for any name that could contain a slash
  // or other reserved URL character.
  const url = `/api/schema/${encodeURIComponent(table)}/${encodeURIComponent(
    column
  )}/stats`;
  const res = await fetch(url);
  if (!res.ok) {
    // Try to parse the standard { error } error envelope; fall back to the
    // status code if the body isn't JSON.
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as StatsErrorPayload;
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON — keep the HTTP status fallback
    }
    throw new Error(message);
  }
  return (await res.json()) as ColumnStatsPayload;
}

// ===== MAIN COMPONENT =====

/**
 * ColumnStats — the floating popover.
 *
 * WHY fetched lazily inside the popover (not by the parent SchemaTree):
 *   The parent has no idea whether the user will ever click a column. Fetching
 *   only when the popover renders means the database is not hammered with
 *   stats queries the user didn't ask for. TanStack Query's cache also lets
 *   us re-open a previously-viewed popover without a refetch within the
 *   staleTime window.
 */
export function ColumnStats({
  table,
  column,
  info,
  anchor,
  onClose,
}: ColumnStatsProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  // ── Dismissal: Escape key ──────────────────────────────────────────────────
  // Bound to window so it works regardless of which element has focus when
  // the user presses Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Dismissal: click outside the popover ──────────────────────────────────
  //
  // WHY mousedown rather than click:
  //   "click" fires AFTER mouseup, so a drag that started inside the popover
  //   and ended outside would close it — annoying for text selection. Listening
  //   on mousedown closes only on a true outside click without affecting drag.
  //
  // WHY skip the close when the click was on the source column row:
  //   The row's onClick handler in SchemaTree toggles the popover (re-clicking
  //   the same column should close it via that handler). If our outside-click
  //   detector ALSO closed on that mousedown, the click would close-then-
  //   reopen and look broken. We detect "was the click inside the source row
  //   rect?" via the snapshot rect.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!popoverRef.current) return;

      const target = e.target as Node | null;
      if (target && popoverRef.current.contains(target)) {
        // Click was inside the popover — keep it open.
        return;
      }

      // Click was on the source column row — let SchemaTree handle the toggle.
      // We approximate "inside the row" via the snapshot rect since the actual
      // DOM node was not passed to us. clientX/clientY are viewport coords,
      // matching DOMRect's coordinate system.
      const inAnchor =
        e.clientX >= anchor.left &&
        e.clientX <= anchor.right &&
        e.clientY >= anchor.top &&
        e.clientY <= anchor.bottom;
      if (inAnchor) return;

      onClose();
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [anchor, onClose]);

  // ── Position calculation ──────────────────────────────────────────────────
  //
  // WHY useMemo on the anchor:
  //   The anchor rect is a DOMRect snapshot — its identity is stable for the
  //   lifetime of the popover. We memoize the position so the inline style
  //   object reference doesn't churn on every render and trip React's
  //   diffing heuristics for inline styles.
  //
  // WHY inline style here despite the codebase's "Tailwind for everything"
  // guidance:
  //   Position values are runtime-computed pixel offsets dependent on where
  //   the user clicked. Tailwind cannot express that without arbitrary value
  //   classes that would have to be generated dynamically (defeating the
  //   build-time scan). Inline style is the only correct tool for runtime-
  //   computed coordinates.
  const positionStyle = useMemo<CSSProperties>(() => {
    // Default: anchor to the right of the source row.
    let left = anchor.right + ANCHOR_GAP_PX;
    let top = anchor.top;

    // Bottom-overflow check: shift the popover up if it would extend past the
    // viewport bottom. We use POPOVER_MAX_HEIGHT_PX as the worst-case height.
    const viewportBottom = window.innerHeight;
    if (top + POPOVER_MAX_HEIGHT_PX > viewportBottom) {
      top = Math.max(8, viewportBottom - POPOVER_MAX_HEIGHT_PX - 8);
    }

    // Right-overflow safety net: if there isn't room to the right of the
    // sidebar, pin to the right edge of the viewport with the same gap.
    if (left + POPOVER_WIDTH_PX > window.innerWidth) {
      left = Math.max(8, window.innerWidth - POPOVER_WIDTH_PX - 8);
    }

    return {
      position: "fixed",
      top,
      left,
      width: POPOVER_WIDTH_PX,
    };
  }, [anchor]);

  // ── Data fetch ────────────────────────────────────────────────────────────
  //
  // queryKey includes both table and column so different columns get separate
  // cache entries — clicking column A then B doesn't re-fetch A on return.
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["columnStats", table, column],
    queryFn: () => fetchColumnStats(table, column),
    // 5 minutes — long enough to cover "click around and come back" but short
    // enough that long-running sessions still see updated stats after schema
    // changes outside the tool. Not Infinity because the DB IS expected to
    // change underneath us (this isn't immutable connection info).
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Statistics for ${table}.${column}`}
      style={positionStyle}
      className="z-50 rounded-md border border-[#1f2033] bg-[#0d0d17] shadow-2xl shadow-black/50 overflow-hidden"
    >
      {/* ===== HEADER ===== */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1f2033] bg-[#0a0a0f]">
        <div className="flex-1 min-w-0">
          {/* Table.column path. The table name is muted to emphasize the column. */}
          <div className="text-[9px] uppercase tracking-widest text-[#4b5563] font-mono">
            {table}
          </div>
          <div className="text-[12px] font-mono text-[#ededf0] truncate">
            {column}
          </div>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] transition-colors duration-100"
          aria-label="Close stats popover"
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      {/* ===== TYPE LINE ===== */}
      <div className="px-3 py-1.5 text-[10px] font-mono text-[#6b7280] border-b border-[#1f2033]">
        <span className="text-[#374151]">type</span>{" "}
        <span>{info.type}</span>
      </div>

      {/* ===== BODY ===== */}
      <div className="px-3 py-2 space-y-2.5">
        {isPending && (
          <div className="text-[11px] italic text-[#374151] font-mono py-2">
            Computing stats…
          </div>
        )}

        {isError && (
          <div className="text-[11px] text-[#f87171] font-mono break-words py-1">
            {error instanceof Error ? error.message : "Failed to load stats"}
          </div>
        )}

        {data && <StatsBody stats={data} />}
      </div>
    </div>
  );
}

// ===== STATS BODY =====

/**
 * StatsBody — renders the universal rows (distinct, null %) plus either the
 * numeric or non-numeric branch.
 */
function StatsBody({ stats }: { stats: ColumnStatsPayload }) {
  // The two branches are detected by the presence of either `min` or
  // `topValues`. Both being absent would be unexpected (the server always
  // populates one or the other), so we render an empty fragment in that
  // pathological case rather than crashing.
  const isNumeric = stats.min !== undefined || stats.max !== undefined || stats.avg !== undefined;

  return (
    <>
      {/* ── Distinct values ─────────────────────────────────────────────── */}
      <StatRow label="Distinct" value={stats.distinct.toLocaleString()} />

      {/* ── Null percentage with bar ───────────────────────────────────── */}
      <NullPercentRow nullPct={stats.nullPct} />

      {/* ── Branch: numeric MIN/MAX/AVG ──────────────────────────────── */}
      {isNumeric && (
        <div className="pt-2 border-t border-[#1f2033] space-y-1.5">
          <NumericStatRow label="Min" value={stats.min ?? null} />
          <NumericStatRow label="Max" value={stats.max ?? null} />
          <NumericStatRow label="Avg" value={stats.avg ?? null} />
        </div>
      )}

      {/* ── Branch: non-numeric top values list ───────────────────────── */}
      {!isNumeric && stats.topValues && (
        <TopValuesList values={stats.topValues} />
      )}
    </>
  );
}

// ===== STAT ROW =====

/**
 * StatRow — generic label/value row, used for "Distinct" and as the building
 * block of the numeric rows below.
 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] uppercase tracking-wider text-[#4b5563] font-mono">
        {label}
      </span>
      <span className="text-[11px] font-mono text-[#ededf0] tabular-nums">
        {value}
      </span>
    </div>
  );
}

// ===== NULL PERCENT ROW =====

/**
 * NullPercentRow — distinct from StatRow because it adds a visual bar.
 *
 * WHY a bar in addition to the numeric percentage:
 *   "12.3%" is a number; "▮▮▮░░░░░░░" gives a magnitude at a glance. For a
 *   stats panel, the visual bar makes very-null vs. mostly-populated columns
 *   discernible without reading the digits — useful when scanning multiple
 *   columns in succession.
 *
 * STYLING NOTE — the only inline style in this component:
 *   The bar's filled width is `${nullPct}%`. Tailwind's arbitrary-value
 *   syntax cannot generate runtime classes (the JIT scans source text at
 *   build time, not runtime), so a dynamic percentage requires inline style.
 *   Every other property uses Tailwind utilities.
 */
function NullPercentRow({ nullPct }: { nullPct: number }) {
  // Clamp to [0, 100] for the bar width. The server should never send a value
  // outside that range, but the UI should not break if it does.
  const clamped = Math.max(0, Math.min(100, nullPct));
  // Format the label: 0 and 100 are displayed without a decimal; intermediate
  // values get one decimal place ("12.3% null") to communicate precision
  // without false confidence.
  const label =
    clamped === 0 || clamped === 100
      ? `${clamped.toFixed(0)}%`
      : `${clamped.toFixed(1)}%`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-[#4b5563] font-mono">
          Null
        </span>
        <span className="text-[11px] font-mono text-[#ededf0] tabular-nums">
          {label}
        </span>
      </div>
      {/* Bar track */}
      <div className="h-1 w-full rounded-full bg-[#0a0a0f] border border-[#1f2033] overflow-hidden">
        {/* Bar fill — width is the only runtime-dynamic style. */}
        <div
          className={[
            "h-full rounded-full",
            // Color cue: low null% = green, high null% = amber, very high = red.
            // Thresholds chosen by intuition: a column that's 5%+ null is mildly
            // notable; 30%+ is a "watch out" signal in most schemas.
            clamped < 5
              ? "bg-[#34d399]"
              : clamped < 30
              ? "bg-[#f59e0b]"
              : "bg-[#f87171]",
          ].join(" ")}
          style={{ width: `${clamped}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ===== NUMERIC STAT ROW =====

/**
 * NumericStatRow — formats a possibly-null number for the min/max/avg rows.
 *
 * WHY a separate component from StatRow:
 *   StatRow takes a pre-formatted string; this one handles null and
 *   number-formatting concerns specific to numeric stats (toFixed, locale
 *   separators) so the parent doesn't have to.
 */
function NumericStatRow({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  // null comes back from MIN/MAX/AVG when the column is empty or all-NULL.
  // Render an em-dash so it's visually distinct from the digit "0".
  const display =
    value == null
      ? "—"
      : Number.isInteger(value)
      ? value.toLocaleString()
      // For non-integers, keep up to 4 decimals and trim trailing zeros so an
      // average of exactly 50 doesn't show as "50.0000".
      : trimTrailingZeros(value.toFixed(4));

  return <StatRow label={label} value={display} />;
}

/**
 * Strips trailing zeros after the decimal point (and a trailing decimal point
 * if no decimals remain). "50.0000" → "50"; "12.5000" → "12.5".
 */
function trimTrailingZeros(s: string): string {
  if (!s.includes(".")) return s;
  return s.replace(/\.?0+$/, "");
}

// ===== TOP VALUES LIST =====

/**
 * TopValuesList — renders up to 5 most-common values with their counts and a
 * proportional bar (count relative to the maximum count in the list).
 *
 * WHY a relative bar (vs. relative to total rows):
 *   The popover is narrow. A bar scaled against the total-row count would
 *   often produce all-tiny bars when one or two values dominate. Scaling
 *   against the MAX count in the list makes the comparison among the top 5
 *   immediately visible — which is the question the user is actually asking
 *   when they open this panel ("which value is most common?").
 */
function TopValuesList({
  values,
}: {
  values: Array<{ value: unknown; count: number }>;
}) {
  if (values.length === 0) {
    return (
      <div className="pt-2 border-t border-[#1f2033] text-[10px] italic text-[#2d3047] font-mono">
        No non-null values to summarize.
      </div>
    );
  }

  const maxCount = Math.max(...values.map((v) => v.count));

  return (
    <div className="pt-2 border-t border-[#1f2033]">
      <div className="text-[10px] uppercase tracking-wider text-[#4b5563] font-mono mb-1.5">
        Top values
      </div>
      <ul className="space-y-1">
        {values.map((entry, idx) => {
          // idx + ":" ensures the key is unique even when two distinct values
          // serialize to the same string (e.g., 1 vs "1" via formatTopValue).
          const key = `${idx}:${formatTopValue(entry.value)}`;
          const widthPct =
            maxCount === 0 ? 0 : Math.round((entry.count / maxCount) * 100);
          return (
            <li key={key} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="flex-1 min-w-0 truncate text-[10.5px] font-mono text-[#ededf0]"
                  title={formatTopValue(entry.value)}
                >
                  {formatTopValue(entry.value)}
                </span>
                <span className="shrink-0 text-[10px] font-mono text-[#6b7280] tabular-nums">
                  {entry.count.toLocaleString()}
                </span>
              </div>
              <div className="h-0.5 w-full rounded-full bg-[#0a0a0f] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#6366f1]"
                  style={{ width: `${widthPct}%` }}
                  aria-hidden="true"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Formats a top-values entry for display.
 *
 *   string  → as-is (with a max display length)
 *   number  → toLocaleString
 *   boolean → "true" / "false"
 *   null    → cannot occur (server filters NULLs out)
 *   object  → JSON.stringify (e.g., for jsonb columns)
 *
 * WHY truncate long strings:
 *   A column might hold a 4 KB blob. Showing the full value in a 260 px
 *   popover would explode the layout. We truncate to 60 chars; the title
 *   attribute on the parent <span> shows the full value on hover.
 */
function formatTopValue(value: unknown): string {
  if (value === null || value === undefined) return "(null)";
  if (typeof value === "string") {
    return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  }
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      return json.length > 60 ? `${json.slice(0, 57)}…` : json;
    } catch {
      return "(unserializable)";
    }
  }
  return String(value);
}
