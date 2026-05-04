/**
 * search-client.ts — Lazy-loading FlexSearch wrapper for the docs site.
 *
 * WHAT: Provides a loadIndex() function that fetches the pre-built search
 * index from /docs/search-index.json, populates a FlexSearch Document index,
 * and exposes a search() function that returns ranked results.
 *
 * WHY lazy: the index can be 50-200 KB on a large docs site. Fetching eagerly
 * would block the initial page paint. Users who never open the command palette
 * pay zero cost. The index is fetched once and cached at module level.
 *
 * HOW: build-search-index.ts (scripts/) serializes all MDX content to a JSON
 * array at build time. At runtime we load that array, add each doc to a
 * FlexSearch Document index, and run queries against it. We don't use
 * FlexSearch's native import/export format because it's opaque and changes
 * between minor versions — a plain JSON array is far more portable.
 *
 * WHY /docs/search-index.json: Vite serves public/ assets at the base path
 * (/docs/), so public/search-index.json resolves to /docs/search-index.json
 * in both dev and production.
 */

import FlexSearch from 'flexsearch';

/** Shape of each document stored in public/search-index.json. */
export interface SearchDoc {
  /** Route slug (relative to /docs) — used to navigate on selection. */
  slug: string;
  /** Page title — shown as the primary result label. */
  title: string;
  /** Sidebar group label — shown as a secondary tag. */
  category: string;
  /**
   * Plain-text page content (MDX stripped to text).
   * Indexed by FlexSearch for full-text search.
   */
  content: string;
  /** Space-separated extra keywords from the sidebar config. */
  keywords?: string;
}

/** What the search hook and command palette receive per result. */
export interface SearchResult {
  slug: string;
  title: string;
  category: string;
  /** A short excerpt from the matching content section. */
  snippet: string;
}

/** Max results returned per query — keeps the palette list scannable. */
const MAX_RESULTS = 8;

/**
 * Module-level state. These live for the lifetime of the browser session.
 * Once loaded, the index is never re-fetched, even if the palette is closed
 * and reopened.
 */
let indexReady = false;
let loadPromise: Promise<void> | null = null;

// WHY Map<string, SearchDoc> and not Array:
//   After FlexSearch returns matching slugs, we need to look up each full
//   doc to build the result object (title, category, snippet). Array.find()
//   is O(n) per lookup — with 8 results × 40 docs that's 320 comparisons.
//   Map.get() is O(1) (hash lookup), and the code reads like a dictionary
//   rather than a search, which better reflects the intent.
//
// WHY module-level (not inside loadIndex):
//   The Map needs to survive across calls — loadIndex() populates it once,
//   and search() reads from it many times. A closure inside loadIndex would
//   not be reachable from search().
const _docs = new Map<string, SearchDoc>();

/**
 * FlexSearch Document index.
 *
 * tokenize: 'forward' enables prefix search — typing "inst" matches
 * "installation" without needing the full word. This is more useful than
 * exact-match (tokenize: 'strict') for a command palette.
 *
 * We index three fields: title (high-value), keywords (high-value), and
 * content (lower-value bulk text). Field-level searching lets FlexSearch
 * rank title/keyword matches above content matches.
 */
const index = new FlexSearch.Document<SearchDoc>({
  tokenize: 'forward',
  document: {
    id: 'slug',
    index: [
      { field: 'title', tokenize: 'forward' },
      { field: 'keywords', tokenize: 'forward' },
      { field: 'content', tokenize: 'forward' },
    ],
    // `store: true` tells FlexSearch to keep each full document in memory
    // so we can retrieve it on search without a second map lookup.
    // Cast needed because FlexSearch's TS types incorrectly type this field.
    store: true as unknown as false,
  },
});

// loadIndex() algorithm:
//   if index is already loaded → return immediately (fast path)
//   if a load is already in flight → return that same Promise (deduplicate)
//   otherwise:
//     start a new Promise and store it in loadPromise
//     fetch /docs/search-index.json
//     if response is not ok → throw (caller surfaces an error state)
//     parse JSON → SearchDoc[]
//     for each doc:
//       add to _docs Map (for O(1) slug → doc lookup in search())
//       add to FlexSearch index (for full-text querying)
//     set indexReady = true so the fast path is taken from now on
export async function loadIndex(): Promise<void> {
  if (indexReady) return;

  // WHY store the promise in a module variable:
  //   If two components call loadIndex() simultaneously (e.g. CommandPalette
  //   and a prefetch trigger both mount at the same time), without this guard
  //   we would issue two fetch() calls and insert every doc twice into the
  //   FlexSearch index — producing duplicate results. Returning the same
  //   Promise collapses N concurrent callers into one network request.
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const res = await fetch('/docs/search-index.json');
    if (!res.ok) {
      throw new Error(
        `Failed to load search index: ${res.status} ${res.statusText}`
      );
    }

    const data = (await res.json()) as SearchDoc[];

    for (const doc of data) {
      _docs.set(doc.slug, doc);
      // addAsync returns a Promise but resolves in the same microtask tick
      // for small indexes — awaiting keeps the loop sequential so we don't
      // fire 40 concurrent index writes.
      await index.addAsync(doc.slug, doc);
    }

    indexReady = true;
  })();

  return loadPromise;
}

// search() algorithm:
//   if index not ready or query is blank → return []
//   ask FlexSearch to search all three fields (title, keywords, content)
//     → returns [{ field: 'title', result: [...] }, { field: 'content', result: [...] }, ...]
//   iterate field groups in definition order (title first = highest priority)
//     for each result in the group:
//       resolve the full SearchDoc (from enriched result or _docs Map fallback)
//       if slug already seen → skip (first occurrence wins = highest-ranked field)
//       add slug to seen Set, push doc to ordered list
//       if ordered list has MAX_RESULTS items → stop
//   map ordered docs → SearchResult (slug, title, category, snippet)
export function search(query: string): SearchResult[] {
  if (!indexReady || !query.trim()) return [];

  const fieldResults = index.search(query, {
    limit: MAX_RESULTS * 2, // over-fetch before deduplication trims the list
    enrich: true,           // attach stored doc object to each result row
  });

  // WHY Set<string> and not Array for `seen`:
  //   We check `seen.has(slug)` once per result row. Set.has() is O(1).
  //   Array.includes() is O(n) — with up to MAX_RESULTS * 2 * 3 rows to
  //   check, that becomes a nested loop and the difference adds up.
  //   Set also self-documents the purpose: it is a membership tracker,
  //   not an ordered collection.
  const seen = new Set<string>();
  const ordered: SearchDoc[] = [];

  for (const fieldGroup of fieldResults) {
    for (const result of fieldGroup.result) {
      // @types/flexsearch incorrectly types enriched results — the actual
      // runtime shape includes a `.doc` property when `store: true`.
      // Fall back to the _docs Map if the type cast yields nothing.
      const enriched = result as unknown as { doc: SearchDoc };
      const doc = enriched.doc ?? _docs.get(result as unknown as string);
      if (!doc || seen.has(doc.slug)) continue;
      seen.add(doc.slug);
      ordered.push(doc);
      if (ordered.length >= MAX_RESULTS) break;
    }
    if (ordered.length >= MAX_RESULTS) break;
  }

  return ordered.map((doc) => ({
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    snippet: buildSnippet(doc.content, query),
  }));
}

/**
 * Extract a short excerpt from the content that contains the query term.
 *
 * We find the first occurrence of any query word, then grab a ±60-character
 * window around it. This gives the user context for why the page matched
 * without truncating important words mid-word.
 */
function buildSnippet(content: string, query: string): string {
  const words = query.trim().toLowerCase().split(/\s+/);
  const lower = content.toLowerCase();

  let bestIdx = -1;
  for (const word of words) {
    const idx = lower.indexOf(word);
    if (idx !== -1) {
      bestIdx = idx;
      break;
    }
  }

  if (bestIdx === -1) {
    // No match in content — return the start of the content as a fallback
    return content.slice(0, 120).trim() + (content.length > 120 ? '…' : '');
  }

  const start = Math.max(0, bestIdx - 60);
  const end = Math.min(content.length, bestIdx + 120);
  const raw = content.slice(start, end).trim();

  return (start > 0 ? '…' : '') + raw + (end < content.length ? '…' : '');
}
