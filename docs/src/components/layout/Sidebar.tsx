/**
 * Sidebar.tsx — Left navigation panel for the docs site.
 *
 * WHAT: Renders the full docs navigation tree. All groups are always
 * expanded — the independent-scroll fixed container makes content density
 * a non-issue (user scrolls within the sidebar panel, not the page).
 *
 * WHY flat (not collapsible):
 *   The sidebar lives in its own fixed scroll container (see DocsLayout).
 *   Users scroll the panel independently to reach any item. Collapsing
 *   groups would add interaction cost with no layout benefit — the dead
 *   space problem is solved at the layout level, not the content level.
 *
 * HOW: Reads sidebar config from sidebar-config.ts (single source of
 * truth). Uses React Router's <NavLink> for active-state detection.
 * Active state uses exact path matching so only the current page is
 * highlighted, not parent segments.
 */

import { NavLink } from 'react-router-dom';
import { sidebar } from '@/lib/sidebar-config';

interface SidebarProps {
  currentSlug?: string;
  onLinkClick?: () => void;
}

export function Sidebar({ onLinkClick }: SidebarProps) {
  return (
    <nav aria-label="Documentation navigation">
      <ul className="space-y-4" role="list">
        {sidebar.map((group) => (
          <li key={group.label}>
            {/* Group label — non-interactive section header */}
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#525252] dark:text-[#555566]" aria-hidden="true">
              {group.label}
            </p>

            <ul className="space-y-px" role="list">
              {group.items.map((item) => (
                <li key={item.slug}>
                  <NavLink
                    to={item.slug}
                    end={item.slug === '/'}
                    onClick={onLinkClick}
                    className={({ isActive }) =>
                      [
                        'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                        isActive
                          ? 'bg-[#4a8af4]/8 text-[#4a8af4]'
                          : 'text-[#525252] dark:text-[#8a8a9a] hover:bg-[#f4f4f5] dark:hover:bg-[#111118]/60 hover:text-[#0a0a0f] dark:hover:text-[#ededf0]',
                      ].join(' ')
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </nav>
  );
}
