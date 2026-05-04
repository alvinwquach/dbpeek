/**
 * useScrollSpy.ts — Tracks which heading is currently visible in the viewport.
 *
 * WHAT: Returns the id of the topmost h2/h3 heading that is currently
 * scrolled into view. Used by TableOfContents to highlight the active item.
 *
 * WHY IntersectionObserver: scroll events fire at 60fps; calculating
 * getBoundingClientRect() inside a scroll handler is expensive (forces layout
 * reflow). IntersectionObserver fires only when visibility changes, making it
 * idle-until-needed and CPU-efficient.
 *
 * HOW:
 *   1. For each heading id, create an IntersectionObserver entry with a
 *      rootMargin that triggers slightly before the heading reaches the top
 *      of the viewport (accounting for the sticky header height).
 *   2. We track all "intersecting" headings at once and report the first one
 *      in DOM order — that is the heading the user is currently "reading past."
 *   3. The observer is rebuilt whenever headingIds changes (page navigation).
 *
 * @param headingIds - Ordered list of heading element ids to observe.
 *   Pass the ids from extractHeadings() in the same DOM order.
 *
 * @returns The id of the active heading, or null if none are visible
 *   (e.g. page has no headings, or user is at the very top before any h2).
 */

import { useState, useEffect } from 'react';

export function useScrollSpy(headingIds: string[]): string | null {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headingIds.length === 0) {
      setActiveId(null);
      return;
    }

    // Algorithm (runs once per IntersectionObserver callback):
    //   maintain a Map of headingId → isCurrentlyVisible
    //   when any heading's visibility changes → update the Map entry
    //   activeId = first id in headingIds order where Map[id] === true
    //
    // WHY Map<string, boolean> and not a plain object {}:
    //   We could use {} but Map communicates intent more clearly:
    //   it is a mutable lookup table, not a data record. More importantly,
    //   we initialize it from an array via the Map constructor which is
    //   cleaner than `headingIds.reduce((o, id) => ({ ...o, [id]: false }), {})`.
    //
    // WHY not React state for `intersecting`:
    //   setState inside an IntersectionObserver callback is async — React
    //   batches the update and re-renders later. But we need to read the
    //   complete updated Map immediately in updateActive() to derive activeId.
    //   A plain mutable Map lets us write and read synchronously in the same
    //   callback tick, then call setActiveId once with the final value.
    const intersecting = new Map<string, boolean>(
      headingIds.map((id) => [id, false])
    );

    // Walk headingIds in DOM order (top → bottom).
    // Return the first one whose Map entry is true.
    // WHY "first visible" and not "most recently intersected":
    //   When the user scrolls past two headings quickly, both trigger
    //   observer callbacks. We always want the one the user has most
    //   recently scrolled past — which is the topmost currently visible
    //   heading — not whichever callback fired last (race-condition prone).
    function updateActive() {
      const firstVisible = headingIds.find((id) => intersecting.get(id) === true);
      setActiveId(firstVisible ?? null);
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          intersecting.set(entry.target.id, entry.isIntersecting);
        }
        updateActive();
      },
      {
        /**
         * rootMargin: the top offset compensates for the sticky docs header
         * (~64px). The bottom is generous (0px) because we care about whether
         * a heading is in the upper portion of the screen, not the bottom.
         *
         * -72px top means a heading is considered "active" once it has
         * scrolled to within 72px of the viewport top — preventing the TOC
         * from flipping to the next section too early.
         */
        rootMargin: '-72px 0px -80% 0px',
        threshold: 0,
      }
    );

    // Attach the observer to each heading element
    for (const id of headingIds) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }

    return () => {
      observer.disconnect();
    };
  }, [headingIds]);

  return activeId;
}
