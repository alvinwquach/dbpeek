/**
 * src/client/components/Results/ErrorDisplay.tsx
 *
 * WHAT:
 *   A standalone error presentation component for SQL query failures.
 *   Renders a red-themed card with a human-friendly message, an error icon,
 *   and the original SQL that caused the failure in a monospace code block.
 *
 * WHY a separate component instead of inline error in DataGrid:
 *   DataGrid's inline error was a single line — functional but not informative.
 *   A DB developer debugging a query needs two things at a glance:
 *     1. What went wrong (the human-friendly message from mapDatabaseError on server).
 *     2. What SQL triggered it (the original statement, for easy copy/edit).
 *   Separating this into its own component also makes it reusable — it can be
 *   dropped into any results panel, history view, or future "explain" tab.
 *
 * DESIGN DECISIONS:
 *   - Red background (#130a0a) and border (#3d1f1f) — standard destructive/error
 *     color language. Contrast is intentionally subtle to avoid harsh flashes in
 *     an editor that the user stares at all day.
 *   - Error icon is an SVG circle-X — universally understood, scales cleanly.
 *   - SQL block uses a slightly lighter background (#0d0509) to distinguish it
 *     from the error message area. Pre-wrap preserves newlines in multi-statement SQL.
 *   - The SQL label ("SQL") is rendered in uppercase tracking-wider to match the
 *     column header style used in DataGrid — visual consistency across the results area.
 */

import type { ReactNode } from "react";

// ===== TYPES =====

/** Props for the ErrorDisplay component. */
interface ErrorDisplayProps {
  /**
   * Human-friendly error message from the server's mapDatabaseError() function.
   * Examples: "Table not found: users", "Permission denied: INSERT is not allowed"
   */
  message: string;

  /**
   * The SQL statement that caused the error.
   * Shown in a monospace block below the message so the user can immediately
   * see and edit the failing query. Optional — omit for non-SQL errors.
   */
  sql?: string;
}

// ===== COMPONENT =====

/**
 * ErrorDisplay — renders a structured error card for SQL query failures.
 *
 * Layout (top to bottom):
 *   [icon] Error message text
 *   ─────────────────────────
 *   SQL  (label)
 *   <the SQL that caused the error>
 *
 * The SQL section is only rendered when `sql` prop is provided and non-empty.
 */
export function ErrorDisplay({ message, sql }: ErrorDisplayProps): ReactNode {
  return (
    <div
      role="alert"
      className="rounded border border-[#3d1f1f] bg-[#130a0a] overflow-hidden"
    >
      {/* ── Error message section ─────────────────────────────────────────── */}
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        {/* Circle-X icon — more visually prominent than a plain "✕" glyph */}
        <ErrorIcon />

        <div className="min-w-0 flex-1">
          <p className="text-[#f87171] text-xs font-mono leading-relaxed break-words">
            {message}
          </p>
        </div>
      </div>

      {/* ── SQL section — only shown when sql is provided ─────────────────── */}
      {sql && sql.trim().length > 0 && (
        <>
          {/* Thin divider between message and SQL — same color as the border */}
          <div className="border-t border-[#3d1f1f]" />

          <div className="px-3 py-2 bg-[#0d0509]">
            {/* Section label */}
            <p className="text-[10px] uppercase tracking-wider text-[#6b2222] mb-1.5 font-mono select-none">
              SQL
            </p>

            {/*
              Pre-wrap so newlines in multi-statement SQL are preserved.
              Horizontal scroll handles very long single-line statements.
              Max-height + overflow-y-auto prevents a 100-line SQL from
              taking over the entire results panel.
            */}
            <pre className="text-[#cd7070] text-[11px] font-mono whitespace-pre-wrap break-words leading-relaxed max-h-40 overflow-y-auto">
              {sql.trim()}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

// ===== ICON =====

/**
 * ErrorIcon — a circle with an X inside, rendered as SVG.
 *
 * WHY SVG instead of an emoji or Unicode glyph:
 *   Emojis render at inconsistent sizes across platforms (macOS vs Linux).
 *   Unicode glyphs like ✕ vary in baseline and weight by font.
 *   SVG is pixel-precise, scales with text size via em units, and inherits
 *   color via currentColor.
 *
 * shrink-0 prevents the icon from being crushed when the error message is long.
 * mt-0.5 aligns the icon's visual center with the first line of message text.
 */
function ErrorIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 text-[#f87171] shrink-0 mt-0.5"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      {/* Outer circle */}
      <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.2" />
      {/* X mark — two crossing lines centered in the circle */}
      <path
        d="M4.5 4.5L9.5 9.5M9.5 4.5L4.5 9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
