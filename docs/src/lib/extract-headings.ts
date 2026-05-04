/**
 * extract-headings.ts — Scrape h2/h3 headings from the rendered content area.
 *
 * WHAT: Reads the live DOM after React has rendered an MDX page and returns
 * a structured list of all h2 and h3 elements for use by the TableOfContents
 * component.
 *
 * WHY client-side: With SPA routing, MDX content is rendered by React on
 * navigation — there is no static HTML to parse at build time. Reading from
 * the DOM after the component mounts is simpler and more accurate than
 * parsing the raw MDX AST and threading heading data through props.
 *
 * HOW: rehype-slug (configured in vite.config.ts) assigns each heading an
 * id attribute derived from its text content (slugified). We rely on those
 * ids for anchor navigation and scroll-spy — never generate our own.
 *
 * WHEN: Call this inside a useEffect after the page has mounted, passing the
 * selector for the content area ('main' or '[data-content]').
 */

/** A single heading entry for the table of contents. */
export interface Heading {
  /**
   * The id attribute set by rehype-slug.
   * Used for anchor href="#id" and IntersectionObserver target ids.
   */
  id: string;
  /** Visible heading text — displayed in the TOC. */
  text: string;
  /** Heading depth — h2 creates a top-level TOC item, h3 is indented. */
  level: 2 | 3;
  /**
   * Reference to the DOM element.
   * Stored so the scroll-spy hook can observe it directly without a
   * second querySelectorAll call.
   */
  element: Element;
}

/**
 * Extract all h2 and h3 elements from the specified container.
 *
 * @param containerSelector - CSS selector for the content area to search.
 *   Defaults to 'main'. Narrow this if the layout has other headings
 *   (e.g. sidebar section labels) that should not appear in the TOC.
 *
 * @returns Ordered array of Heading objects matching DOM order. Returns []
 *   if the container is not found (e.g. called before mount).
 */
export function extractHeadings(containerSelector = 'main'): Heading[] {
  const container = document.querySelector(containerSelector);
  if (!container) return [];

  /**
   * Query for h2 and h3 only — h1 is the page title (not repeated in TOC),
   * and h4+ are too granular to navigate by.
   */
  const elements = container.querySelectorAll('h2, h3');

  const headings: Heading[] = [];

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    // Only process h2 and h3 — the type guard satisfies TypeScript's Heading.level
    if (tag !== 'h2' && tag !== 'h3') continue;

    const id = el.getAttribute('id');
    if (!id) {
      // Skip headings without an id — they won't work as anchor targets.
      // This can happen if rehype-slug was not configured or a heading was
      // added by hand without an id.
      continue;
    }

    /**
     * textContent strips all child HTML (e.g. the <a> wrapper added by
     * rehype-autolink-headings) and gives us clean plain text for display.
     */
    const text = (el.textContent ?? '').trim();
    if (!text) continue;

    headings.push({
      id,
      text,
      level: tag === 'h2' ? 2 : 3,
      element: el,
    });
  }

  return headings;
}
