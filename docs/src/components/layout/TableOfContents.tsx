/**
 * TableOfContents.tsx — Right-rail table of contents for the current page.
 *
 * WHAT: Scrapes h2/h3 headings from the content area after mount, renders
 * a clickable list of them, and highlights the active heading as the user
 * scrolls using IntersectionObserver (via useScrollSpy).
 *
 * WHY: Long docs pages benefit from an always-visible navigation list on the
 * right so users can jump to a section without scrolling manually or using
 * Cmd+F. Highlighting the active heading provides "you are here" context.
 *
 * HOW:
 *   1. useEffect extracts headings from the DOM after React paints the MDX.
 *   2. useScrollSpy watches those headings and returns the active id.
 *   3. Clicking a TOC link scrolls smoothly to the heading (native anchor).
 *   4. The component is keyed by pathname in DocsLayout so it re-mounts on
 *      navigation (triggering a fresh heading extraction for the new page).
 *
 * Re-keying on pathname is simpler than detecting DOM changes with
 * MutationObserver, and avoids the risk of reading stale headings from the
 * previous page during React's concurrent rendering.
 */

import { useState, useEffect } from 'react';
import { extractHeadings, type Heading } from '@/lib/extract-headings';
import { useScrollSpy } from '@/hooks/useScrollSpy';

export function TableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    /**
     * A short delay lets React finish painting the MDX content before we
     * query the DOM. Without this, the content area may still show the
     * previous page's headings on rapid navigation.
     *
     * requestAnimationFrame waits for the next paint tick — more reliable
     * than setTimeout(0) which fires before the browser commits the frame.
     */
    const raf = requestAnimationFrame(() => {
      const found = extractHeadings('[data-content]');
      setHeadings(found);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const headingIds = headings.map((h) => h.id);
  const activeId = useScrollSpy(headingIds);

  // Don't render the TOC panel at all if the page has no h2/h3 headings
  if (headings.length === 0) return null;

  return (
    <nav aria-label="On this page">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#525252] dark:text-[#555566]">
        On this page
      </p>

      <ul className="space-y-0.5" role="list">
        {headings.map((heading) => {
          const isActive = activeId === heading.id;

          return (
            <li key={heading.id}>
              <a
                href={`#${heading.id}`}
                className={[
                  'block text-sm transition-colors',
                  /**
                   * h3 headings are indented to show hierarchy visually.
                   * pl-4 vs pl-2 matches the visual weight of h2 vs h3 in
                   * the content area.
                   */
                  heading.level === 3 ? 'pl-4' : 'pl-0',
                  isActive
                    ? 'text-[#4a8af4] font-medium'
                    : 'text-[#525252] dark:text-[#555566] hover:text-[#0a0a0f] dark:hover:text-[#8a8a9a]',
                ].join(' ')}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
