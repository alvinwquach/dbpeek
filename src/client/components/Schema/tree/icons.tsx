/**
 * src/client/components/Schema/tree/icons.tsx
 *
 * ===== FILE PURPOSE =====
 * All inline SVG icon components used throughout the SchemaTree sub-modules.
 *
 * WHY inline SVGs rather than an icon library:
 *   Each icon is a tiny, purpose-built glyph that fits the 12×12 px design
 *   token used by the sidebar. Importing a full icon library (Heroicons,
 *   Lucide, etc.) would add significant bundle weight and introduce icons that
 *   don't match the custom metaphors below. Inline SVGs are styled via
 *   Tailwind's `text-*` utilities through `currentColor`.
 *
 * WHY all icons in one file:
 *   SchemaTree sub-components (TableRow, ContextMenu, SearchInput) each need
 *   a subset of these icons. A single icons.tsx lets any sub-module import
 *   exactly what it needs without a barrel index and without icon duplication.
 */

// ===== CHEVRON =====

/**
 * Right-pointing chevron used as the table-row collapse indicator.
 * Rotates 90° via Tailwind utility when expanded — no second SVG needed.
 */
export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={[
        "w-2.5 h-2.5 shrink-0 text-[#4b5563] transition-transform duration-100",
        open ? "rotate-90" : "",
      ].join(" ")}
      viewBox="0 0 8 8"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5L5.5 4L3 6.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ===== TABLE =====

/**
 * Small table icon for table rows. Three horizontal bars suggest "rows of data"
 * without being a literal grid (which would compete with the chevron visually).
 */
export function TableIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-[#6b7280]"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="1.5"
        y="2.5"
        width="9"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1"
      />
      <line x1="1.5" y1="5" x2="10.5" y2="5" stroke="currentColor" strokeWidth="0.75" />
      <line x1="1.5" y1="7.5" x2="10.5" y2="7.5" stroke="currentColor" strokeWidth="0.75" />
    </svg>
  );
}

// ===== PREVIEW =====

/**
 * Eye icon used for the preview action ("show me this table's first rows").
 * Universally recognized as "view" in dev tools and design apps.
 */
export function PreviewIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M1 6S2.5 2.5 6 2.5 11 6 11 6 9.5 9.5 6 9.5 1 6 1 6Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

// ===== DDL =====

/**
 * Code-brackets icon used for the "Show DDL" action on a table row. The
 * angle-brackets read as "structured definition" in dev tooling — the same
 * convention used in IDEs to mean "view source / definition".
 */
export function DdlIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4.5 3L1.5 6L4.5 9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 3L10.5 6L7.5 9"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ===== SEARCH =====

/**
 * Magnifying-glass icon for the search input.
 */
export function SearchIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0 text-[#4b5563]"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="5" cy="5" r="3" stroke="currentColor" strokeWidth="1" />
      <line
        x1="7.5"
        y1="7.5"
        x2="10"
        y2="10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ===== STAR =====

/**
 * Filled-star icon used next to pinned tables. The fill signals "pinned" state
 * clearly without relying on color alone — screen-reader users also get the
 * aria-label "Unpin table".
 *
 * WHY a star and not a pin/thumbtack:
 *   "Star to favorite" is the dominant mental model in developer tooling
 *   (GitHub stars, VS Code pinned tabs use filled icons). A thumbtack is
 *   also common, but a 12 px thumbtack is difficult to read; a star reads
 *   clearly at that size.
 */
export function StarFilledIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      {/*
        A five-pointed star drawn with a single polygon.
        Points calculated for a 12×12 viewport, center at (6,6), outer-
        radius 5, inner-radius 2.
      */}
      <polygon points="6,1 7.545,4.134 11,4.635 8.5,7.072 9.09,10.511 6,8.884 2.91,10.511 3.5,7.072 1,4.635 4.455,4.134" />
    </svg>
  );
}

// ===== IMPORT =====

/**
 * Upload-arrow icon used for the "Import CSV/JSON" action on a table row.
 * An upward arrow entering a tray is the universal "upload / import" metaphor
 * in developer tooling (VS Code's import, DBeaver's data-import button, etc.).
 * Rendered at 12×12 px to match every other icon in this file.
 */
export function ImportIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      {/* Tray / inbox line at the bottom — the "destination" visual */}
      <path
        d="M1.5 8.5h9v2a.5.5 0 01-.5.5H2a.5.5 0 01-.5-.5v-2z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Upward arrow shaft */}
      <line
        x1="6"
        y1="1.5"
        x2="6"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      {/* Arrow head */}
      <path
        d="M3.5 4L6 1.5L8.5 4"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ===== ERD =====

/**
 * Small network/graph icon used for the ERD button in the sidebar header.
 * Three circles connected by lines suggest a relational diagram, distinguishing
 * it from the table icon and clearly signalling "relationships between tables".
 */
export function ErdIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      {/* Three node circles */}
      <circle cx="2" cy="6" r="1.25" stroke="currentColor" strokeWidth="1" />
      <circle cx="10" cy="2.5" r="1.25" stroke="currentColor" strokeWidth="1" />
      <circle cx="10" cy="9.5" r="1.25" stroke="currentColor" strokeWidth="1" />
      {/* Edges connecting them */}
      <line x1="3.2" y1="5.5" x2="8.8" y2="3" stroke="currentColor" strokeWidth="0.9" />
      <line x1="3.2" y1="6.5" x2="8.8" y2="9" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}
