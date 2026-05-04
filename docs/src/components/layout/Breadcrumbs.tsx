/**
 * Breadcrumbs — Category / page name above the page heading.
 *
 * WHY: Deep doc pages (e.g. /editor/autocomplete) are nested 2 levels.
 * A breadcrumb trail orients the reader within the documentation hierarchy
 * without requiring them to scan the sidebar.
 *
 * HOW: Reads the current location.pathname, looks up which sidebar group
 * it belongs to using getGroupForSlug(), then renders:
 *   Home > Category > Current page label
 *
 * "Home" links to "/" via React Router <Link> (basename="/docs" applied).
 * The category label is plain text (not linked) because clicking it would
 * just stay in the section — there's no category index page.
 * The current page label is text-[#ededf0] (unlinked, you're already here).
 *
 * Returns null if the current route isn't found in the sidebar config (e.g.
 * the 404 page) to avoid showing a broken breadcrumb.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { getGroupForSlug } from '@/lib/sidebar-config';

/**
 * Breadcrumb trail showing Home > Category > Current Page.
 */
export const Breadcrumbs: React.FC = () => {
  const { pathname } = useLocation();

  // Look up the group and item for the current path.
  const group = getGroupForSlug(pathname);
  const item = group?.items.find((i) => i.slug === pathname);

  // Don't render a broken breadcrumb for unknown routes.
  if (!group || !item) return null;

  // Is the current page the index/intro of a group? If so show 2 segments.
  const isIndex = pathname === '/';

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#8a8a9a] mb-4"
    >
      {/* Home */}
      <Link
        to="/"
        className="hover:text-[#0a0a0f] dark:hover:text-[#ededf0] transition-colors"
      >
        Docs
      </Link>

      {!isIndex && (
        <>
          {/* Separator */}
          <ChevronRight size={12} className="text-[#525252] dark:text-[#555566] shrink-0" aria-hidden="true" />

          {/* Category (not linked — no index page) */}
          <span className="text-[#525252] dark:text-[#8a8a9a]">{group.label}</span>

          {/* Current page */}
          <ChevronRight size={12} className="text-[#525252] dark:text-[#555566] shrink-0" aria-hidden="true" />
          <span className="text-[#0a0a0f] dark:text-[#ededf0]" aria-current="page">
            {item.label}
          </span>
        </>
      )}

      {/* Index page: just show the item label as current */}
      {isIndex && (
        <>
          <ChevronRight size={12} className="text-[#525252] dark:text-[#555566] shrink-0" aria-hidden="true" />
          <span className="text-[#0a0a0f] dark:text-[#ededf0]" aria-current="page">
            {item.label}
          </span>
        </>
      )}
    </nav>
  );
};

export default Breadcrumbs;
