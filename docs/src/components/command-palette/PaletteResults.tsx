/**
 * PaletteResults — Groups filtered results by sidebar category.
 *
 * WHY: Grouping results by category (e.g. "Getting started", "Reference")
 * makes the list easier to scan at a glance — the user can skip sections
 * they know aren't relevant. Flat lists become confusing at 10+ results.
 *
 * HOW: Groups the PaletteResult[] array by `category` string, preserving
 * insertion order (which mirrors sidebar order). Renders a category header
 * between each group, then a PaletteResult row for each item.
 *
 * onSelect is called with the SidebarItem slug when the user clicks a row.
 * The parent (CommandPalette) handles navigation.
 */

import React from 'react';
import { PaletteResult } from './PaletteResult';
import type { PaletteResult as PaletteResultData } from './usePalette';
import type { SidebarItem } from '@/lib/sidebar-config';

interface PaletteResultsProps {
  /** Filtered result list from usePalette. */
  results: PaletteResultData[];
  /** The currently keyboard-highlighted result index (global, across all groups). */
  selectedIndex: number;
  /** Called when the user selects a result. */
  onSelect: (item: SidebarItem) => void;
}

/**
 * Groups results by category and renders them with section headers.
 */
export const PaletteResults: React.FC<PaletteResultsProps> = ({
  results,
  selectedIndex,
  onSelect,
}) => {
  if (results.length === 0) return null;

  // ── Group by category (preserving insertion order) ──────────────────────

  type Group = { category: string; items: Array<{ result: PaletteResultData; globalIndex: number }> };

  const groups: Group[] = [];
  const categoryMap = new Map<string, Group>();

  results.forEach((result, globalIndex) => {
    const cat = result.category;
    let group = categoryMap.get(cat);
    if (!group) {
      group = { category: cat, items: [] };
      groups.push(group);
      categoryMap.set(cat, group);
    }
    group.items.push({ result, globalIndex });
  });

  return (
    <div
      role="listbox"
      aria-label="Search results"
      className="overflow-y-auto max-h-[360px] py-2"
    >
      {groups.map((group) => (
        <div key={group.category}>
          {/* Category header */}
          <div className="px-4 pt-3 pb-1">
            <span className="text-[#525252] dark:text-[#555566] text-xs font-medium uppercase tracking-widest">
              {group.category}
            </span>
          </div>

          {/* Result rows */}
          {group.items.map(({ result, globalIndex }) => (
            <PaletteResult
              key={result.item.slug}
              label={result.item.label}
              category={undefined} /* already shown in group header */
              isSelected={selectedIndex === globalIndex}
              isExternal={false}
              index={globalIndex}
              total={results.length}
              onClick={() => onSelect(result.item)}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default PaletteResults;
