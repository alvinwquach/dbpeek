/**
 * src/client/components/Results/SortIndicator.tsx
 *
 * WHAT:
 *   A tiny arrow icon displayed inside sortable column headers to communicate
 *   the current sort direction (ascending, descending, or unsorted).
 *
 * WHY a separate file:
 *   SortIndicator is a pure presentational component with no dependencies on
 *   table state. Keeping it isolated makes it trivial to test and means
 *   ResultsTable.tsx doesn't carry unrelated SVG markup.
 */

// ===== COMPONENT =====

/** Props for SortIndicator. */
interface SortIndicatorProps {
  /**
   * The current sort direction for the column, as returned by TanStack Table's
   * `column.getIsSorted()`. `false` means the column is not sorted.
   */
  direction: false | "asc" | "desc";
}

/**
 * SortIndicator — a small arrow icon that shows the sort direction for a column.
 *
 * WHY a custom SVG instead of a Unicode arrow:
 *   Unicode arrows (↑ ↓ ⇅) vary in size and baseline across fonts and OSes.
 *   An SVG is pixel-precise and inherits the parent's text color via currentColor.
 *
 * When `direction` is false (unsorted), renders a dim double-arrow to hint that
 * clicking will sort — better discoverability than showing nothing at all.
 */
export function SortIndicator({ direction }: SortIndicatorProps) {
  if (direction === "asc") {
    return (
      <svg
        className="w-2.5 h-2.5 text-[#6366f1] shrink-0"
        viewBox="0 0 10 10"
        fill="none"
        aria-label="sorted ascending"
      >
        <path d="M5 2L8.5 7H1.5L5 2Z" fill="currentColor" />
      </svg>
    );
  }

  if (direction === "desc") {
    return (
      <svg
        className="w-2.5 h-2.5 text-[#6366f1] shrink-0"
        viewBox="0 0 10 10"
        fill="none"
        aria-label="sorted descending"
      >
        <path d="M5 8L1.5 3H8.5L5 8Z" fill="currentColor" />
      </svg>
    );
  }

  // Unsorted: dim double-chevron hints that clicking will sort this column.
  return (
    <svg
      className="w-2.5 h-2.5 text-[#2d3047] shrink-0 opacity-0 group-hover:opacity-100"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path d="M5 1.5L7.5 4H2.5L5 1.5Z" fill="currentColor" />
      <path d="M5 8.5L2.5 6H7.5L5 8.5Z" fill="currentColor" />
    </svg>
  );
}
