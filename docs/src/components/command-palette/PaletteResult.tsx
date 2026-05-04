/**
 * PaletteResult — Single result row in the command palette.
 *
 * WHY: Each row needs consistent layout (icon | title | category badge),
 * hover/selected highlight, and special treatment for external links
 * (ExternalLink icon on the right instead of Hash).
 *
 * HOW: Props control the label, category, selection state, and whether
 * the result navigates internally or externally. The parent
 * (PaletteResults) handles onClick so this component stays pure-presentational.
 *
 * Selected state: bg-[#1a1a24] with a left accent border.
 * External results: show ExternalLink icon on the far right.
 */

import React from 'react';
import { Hash, ChevronRight, ExternalLink } from 'lucide-react';

interface PaletteResultProps {
  /** The page title to display. */
  label: string;
  /** The sidebar group this page belongs to (e.g. "Getting started"). */
  category?: string;
  /** Whether this row is the currently keyboard-selected item. */
  isSelected: boolean;
  /** Whether this result navigates to an external URL. */
  isExternal?: boolean;
  /** Called when the user clicks this row. */
  onClick: () => void;
  /** Row index for aria-setsize / aria-posinset. */
  index: number;
  /** Total number of results (for aria-setsize). */
  total: number;
}

/**
 * A single search result row in the command palette.
 * Displays icon, title, category, and selection highlight.
 */
export const PaletteResult: React.FC<PaletteResultProps> = ({
  label,
  category,
  isSelected,
  isExternal = false,
  onClick,
  index,
  total,
}) => (
  <div
    role="option"
    aria-selected={isSelected}
    aria-posinset={index + 1}
    aria-setsize={total}
    onClick={onClick}
    className={[
      // Base layout — 48px tall
      'flex items-center gap-3 px-4 cursor-pointer transition-colors',
      'min-h-[48px]',
      // Selected vs hover state
      isSelected
        ? 'bg-[#e8f0fe] dark:bg-[#1a1a24] border-l-2 border-[#4a8af4] pl-[14px]'
        : 'hover:bg-[#f4f4f5] dark:hover:bg-[#111118] border-l-2 border-transparent',
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {/* Left icon — Hash for internal, ChevronRight for external */}
    {isExternal ? (
      <ChevronRight
        size={16}
        className="text-[#4a8af4] shrink-0"
        aria-hidden="true"
      />
    ) : (
      <Hash
        size={16}
        className="text-[#4a8af4] shrink-0"
        aria-hidden="true"
      />
    )}

    {/* Title */}
    <span className="flex-1 text-sm text-[#0a0a0f] dark:text-[#ededf0] truncate">{label}</span>

    {/* Category badge */}
    {category && (
      <span className="text-xs text-[#525252] dark:text-[#555566] shrink-0 hidden sm:block">
        {category}
      </span>
    )}

    {/* External link indicator */}
    {isExternal && (
      <ExternalLink
        size={12}
        className="text-[#555566] shrink-0"
        aria-hidden="true"
      />
    )}
  </div>
);

export default PaletteResult;
