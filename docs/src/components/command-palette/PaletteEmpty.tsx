/**
 * PaletteEmpty — Default content shown when the search query is empty.
 *
 * WHY: An empty palette is a missed opportunity. When the user opens the
 * palette without typing, we show:
 *   1. "Jump to…" quick links — the most commonly visited pages.
 *   2. External actions — marketing site, GitHub, bug reports, star CTA.
 *
 * HOW: Uses PaletteResult rows for visual consistency with the search results
 * list. Quick-jump items call onNavigate (internal React Router nav); external
 * actions call onExternal (window.location / window.open).
 *
 * IMPORTANT: "Back to dbpeek.com" uses window.location.href = '/' rather than
 * React Router navigate() because it needs to EXIT the /docs basename and
 * reach the marketing site root. React Router navigate('/') would stay inside
 * the basename.
 */

import React from 'react';
import { PaletteResult } from './PaletteResult';

interface PaletteEmptyProps {
  /** Called when the user picks an internal quick-jump link. Receives the slug. */
  onNavigate: (slug: string) => void;
  /** Called when the user picks an external action. Receives the URL. */
  onExternal: (url: string) => void;
}

// ── Quick-jump items (internal routes) ──────────────────────────────────────

interface QuickItem {
  label: string;
  slug: string;
  category: string;
}

const QUICK_ITEMS: QuickItem[] = [
  { label: 'Introduction',        slug: '/',                                 category: 'Getting started' },
  { label: 'Installation',        slug: '/getting-started/installation',     category: 'Getting started' },
  { label: 'Quickstart',          slug: '/getting-started/quickstart',       category: 'Getting started' },
  { label: 'Permission modes',    slug: '/getting-started/permission-modes', category: 'Getting started' },
  { label: 'CLI flags',           slug: '/reference/cli-flags',              category: 'Reference' },
  { label: 'Keyboard shortcuts',  slug: '/reference/keyboard-shortcuts',     category: 'Reference' },
  { label: 'Privacy model',       slug: '/advanced/privacy-model',           category: 'Advanced' },
  { label: 'Architecture',        slug: '/advanced/architecture',            category: 'Advanced' },
  { label: 'FAQ',                 slug: '/reference/faq',                    category: 'Reference' },
];

// ── External action items ────────────────────────────────────────────────────

interface ExternalItem {
  label: string;
  url: string;
  /** If true, uses window.location.href (hard navigate); otherwise window.open. */
  hardNav?: boolean;
}

const EXTERNAL_ITEMS: ExternalItem[] = [
  { label: 'Back to dbpeek.com', url: '/',                                                hardNav: true  },
  { label: 'Open GitHub',        url: 'https://github.com/alvinwquach/dbpeek',             hardNav: false },
  { label: 'Report a bug',       url: 'https://github.com/alvinwquach/dbpeek/issues/new', hardNav: false },
  { label: 'Star on GitHub',     url: 'https://github.com/alvinwquach/dbpeek',             hardNav: false },
];

/**
 * Default palette content when no query has been entered.
 * Shows quick-jump links and external actions.
 */
export const PaletteEmpty: React.FC<PaletteEmptyProps> = ({
  onNavigate,
  onExternal,
}) => (
  <div className="overflow-y-auto max-h-[400px] py-2">
    {/* ── Quick jump section ── */}
    <div className="px-4 pt-3 pb-1">
      <span className="text-[#525252] dark:text-[#555566] text-xs font-medium uppercase tracking-widest">
        Jump to...
      </span>
    </div>

    {QUICK_ITEMS.map((item, index) => (
      <PaletteResult
        key={item.slug}
        label={item.label}
        category={item.category}
        isSelected={false}
        isExternal={false}
        index={index}
        total={QUICK_ITEMS.length + EXTERNAL_ITEMS.length}
        onClick={() => onNavigate(item.slug)}
      />
    ))}

    {/* Divider */}
    <div className="border-t border-[#e4e4e7] dark:border-[#1e1e2e] mx-4 my-2" />

    {/* ── External actions section ── */}
    <div className="px-4 pt-1 pb-1">
      <span className="text-[#525252] dark:text-[#555566] text-xs font-medium uppercase tracking-widest">
        Actions
      </span>
    </div>

    {EXTERNAL_ITEMS.map((item, index) => (
      <PaletteResult
        key={item.url + item.label}
        label={item.label}
        category={undefined}
        isSelected={false}
        isExternal
        index={QUICK_ITEMS.length + index}
        total={QUICK_ITEMS.length + EXTERNAL_ITEMS.length}
        onClick={() => onExternal(item.hardNav ? item.url : item.url)}
      />
    ))}
  </div>
);

export default PaletteEmpty;
