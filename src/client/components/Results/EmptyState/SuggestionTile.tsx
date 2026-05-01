/**
 * src/client/components/Results/EmptyState/SuggestionTile.tsx
 *
 * ===== FILE PURPOSE =====
 * One row in the empty-state suggestion list. Renders an accent letter tile,
 * a title + target subtitle, and a SQL preview block. Clicking the row fires
 * `onClick(suggestion.sql)`.
 *
 * Why a separate sub-component:
 *   The tile has its own layout (icon | text column with three lines), its
 *   own hover/active styling, and its own Tailwind class soup. Inlining it
 *   inside the parent's map() would dwarf the parent's structure (header +
 *   list + footer) and make either side harder to read. A sub-component lets
 *   the parent stay structural and the tile own its look.
 *
 * Why this lives next to its only caller (./index.tsx) instead of in a more
 * generic `components/` folder:
 *   The tile is shaped specifically for the empty-state use case (P/D/A/J
 *   accent letters, suggestion-shaped props). It would not be reusable
 *   without genericising — at which point we'd be designing for a hypothetical
 *   second caller. Co-locate now; extract later if a second caller appears.
 */

import type { Suggestion } from "./buildSuggestions";

// ===== TYPES =====

/** Props for one suggestion tile. */
interface SuggestionTileProps {
  /** The suggestion to render. */
  suggestion: Suggestion;
  /**
   * Called with the suggestion's SQL when the user clicks the tile.
   *
   * The parent (./index.tsx) handles the load-into-editor + auto-run wiring;
   * this component is purely presentational. Passing only `sql` (rather than
   * the full Suggestion) keeps the contract narrow — the parent's handler
   * doesn't need to know about accentText / letter / subtitle when running.
   */
  onClick: (sql: string) => void;
}

// ===== COMPONENT =====

/**
 * SuggestionTile — one clickable row inside the empty-state suggestion list.
 *
 * Why a <button> wrapping the entire row:
 *   The whole tile is the click target. Wrapping it in a <button> gives us
 *   correct keyboard semantics (Enter / Space activate, focus ring) for free,
 *   plus the right ARIA role for assistive tech, with no manual ARIA wiring.
 *
 * Why the title attribute carries the SQL:
 *   Long multi-line SQL is collapsed to a single line in the native browser
 *   tooltip so the user can confirm what they're about to run by hovering,
 *   without expanding the tile or reading the visible <pre>.
 *
 * Layout:
 *   [letter tile] | [title + subtitle row]
 *                 | [SQL preview block (whitespace-pre-wrap)]
 */
export function SuggestionTile({ suggestion, onClick }: SuggestionTileProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(suggestion.sql)}
      className="group w-full flex items-start gap-3 px-3 py-2.5 rounded border border-[#1f2033] bg-[#0c0c14] hover:bg-[#0f0f1a] hover:border-[#2a2a4a] active:bg-[#14142b] transition-colors duration-100 text-left"
      title={`Run: ${suggestion.sql.replace(/\n/g, " ")}`}
    >
      {/* ── Letter tile ── */}
      {/*
        A square accent tile — single uppercase letter mapped to the
        suggestion type (P / D / A / J). Distinguishable at a glance even
        before the user reads the title row.
      */}
      <span
        className={[
          "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded",
          "bg-[#0d0d17] border font-mono text-[11px] font-semibold uppercase tracking-wider",
          suggestion.accentBorder,
          suggestion.accentText,
        ].join(" ")}
        aria-hidden="true"
      >
        {suggestion.letter}
      </span>

      {/* ── Text column ── */}
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Title + target subtitle on the same baseline. The subtitle is
            capped at 55% width so a long table.column reference truncates
            gracefully instead of wrapping the title onto a second line. */}
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] text-[#ededf0] font-medium group-hover:text-white transition-colors duration-100">
            {suggestion.title}
          </span>
          <span className="shrink-0 text-[10px] font-mono text-[#4b5563] truncate max-w-[55%]">
            {suggestion.subtitle}
          </span>
        </span>

        {/* SQL preview — pre + whitespace-pre-wrap so multi-line suggestions
            render with their original line breaks but still wrap if the
            panel is narrow. */}
        <pre className="text-[10.5px] font-mono text-[#6b7280] whitespace-pre-wrap break-words leading-relaxed">
          {suggestion.sql}
        </pre>
      </span>
    </button>
  );
}
