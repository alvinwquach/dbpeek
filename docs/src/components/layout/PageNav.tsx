/**
 * PageNav — Previous / Next page navigation at the bottom of each doc page.
 *
 * WHY: After finishing a page, readers need a clear path forward (or back).
 * Prev/Next buttons in sidebar order give a linear reading flow that mirrors
 * how the docs are structured conceptually — matching the sidebar sequence.
 *
 * HOW: Uses getPrevNext() from sidebar-config, which flattens the full nav
 * tree into a linear list and returns the items adjacent to the current slug.
 * We read the current pathname from React Router's useLocation() so the
 * component needs no props and can be dropped anywhere inside the Router.
 *
 * Cards use React Router <Link> for internal navigation (basename applied).
 * The "Previous" card is left-aligned; "Next" is right-aligned.
 * A spacer <div /> fills the empty side when there's only one adjacent page.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPrevNext } from '@/lib/sidebar-config';

/**
 * Renders previous and next page navigation links.
 * Returns null when there are no adjacent pages (single-page docs edge case).
 */
export const PageNav: React.FC = () => {
  const { pathname } = useLocation();
  const { prev, next } = getPrevNext(pathname);

  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Page navigation"
      className="mt-12 pt-8 border-t border-[#e4e4e7] dark:border-[#1e1e2e] flex items-stretch justify-between gap-4"
    >
      {/* ── Previous page ── */}
      {prev ? (
        <Link
          to={prev.slug}
          className={[
            'group flex flex-col gap-1.5 flex-1 max-w-[45%]',
            'bg-[#f4f4f5] dark:bg-[#111118] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg p-4',
            'transition-colors hover:border-[#4a8af4]/40',
            'no-underline',
          ].join(' ')}
        >
          {/* Direction label */}
          <span className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#555566]">
            <ChevronLeft size={12} aria-hidden="true" />
            Previous
          </span>
          {/* Page title */}
          <span className="text-sm font-medium text-[#0a0a0f] dark:text-[#ededf0] group-hover:text-[#4a8af4] transition-colors leading-snug">
            {prev.label}
          </span>
        </Link>
      ) : (
        // Spacer to keep "Next" pushed right when "Previous" is absent.
        <div className="flex-1 max-w-[45%]" aria-hidden="true" />
      )}

      {/* ── Next page ── */}
      {next ? (
        <Link
          to={next.slug}
          className={[
            'group flex flex-col items-end gap-1.5 flex-1 max-w-[45%]',
            'bg-[#f4f4f5] dark:bg-[#111118] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg p-4',
            'transition-colors hover:border-[#4a8af4]/40',
            'no-underline',
          ].join(' ')}
        >
          {/* Direction label */}
          <span className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#555566]">
            Next
            <ChevronRight size={12} aria-hidden="true" />
          </span>
          {/* Page title */}
          <span className="text-sm font-medium text-[#0a0a0f] dark:text-[#ededf0] group-hover:text-[#4a8af4] transition-colors leading-snug text-right">
            {next.label}
          </span>
        </Link>
      ) : (
        <div className="flex-1 max-w-[45%]" aria-hidden="true" />
      )}
    </nav>
  );
};

export default PageNav;
