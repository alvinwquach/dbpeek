/**
 * useSearch.ts — React hook wrapping the FlexSearch client.
 *
 * WHAT: Exposes { results, isLoading, query, search } to any component that
 * needs full-text search over the docs pages.
 *
 * WHY: Encapsulates the async index loading, debouncing, and state management
 * so the CommandPalette component stays focused on presentation.
 *
 * HOW:
 *   1. On first call to search(query), loadIndex() is triggered (lazy-loads
 *      the search JSON over the network if not already cached).
 *   2. Queries are debounced 150ms — fast enough to feel instant, slow enough
 *      to avoid re-running FlexSearch on every keystroke during fast typing.
 *   3. Empty queries immediately clear results without touching the index.
 *   4. isLoading is true only while the index is being fetched (first search),
 *      not during subsequent fast lookups.
 */

import { useState, useCallback, useRef } from 'react';
import { loadIndex, search as flexSearch, type SearchResult } from '@/lib/search-client';

/** How long to wait after the last keystroke before running the search. */
const DEBOUNCE_MS = 150;

interface UseSearchReturn {
  /** Current search query string (controlled by the hook). */
  query: string;
  /** Ranked search results for the current query. Empty array when query is blank. */
  results: SearchResult[];
  /**
   * True while the search index is being fetched for the first time.
   * Use to show a loading spinner in the command palette.
   */
  isLoading: boolean;
  /**
   * Update the query. Debounces the actual search by DEBOUNCE_MS.
   * Calling with '' immediately clears results.
   */
  search: (query: string) => void;
  /** Clear query and results without triggering a search. */
  clear: () => void;
}

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * debounceRef stores the setTimeout id so we can cancel it when the
   * user types another character before the delay expires. Using a ref
   * (not state) avoids triggering a re-render on each keystroke.
   */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback((newQuery: string) => {
    setQuery(newQuery);

    // Cancel any pending debounced search
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }

    // Empty query — clear immediately, no debounce needed
    if (!newQuery.trim()) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        /**
         * loadIndex() is a no-op if the index is already loaded.
         * Only shows the loading indicator on the very first search.
         */
        setIsLoading(true);
        await loadIndex();
        setIsLoading(false);

        const hits = flexSearch(newQuery);
        setResults(hits);
      } catch (err) {
        // Network error fetching the index — fail silently rather than
        // crashing the palette. Log to console for debuggability.
        console.error('[useSearch] Failed to load search index:', err);
        setIsLoading(false);
        setResults([]);
      }
    }, DEBOUNCE_MS);
  }, []);

  const clear = useCallback(() => {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
    }
    setQuery('');
    setResults([]);
    setIsLoading(false);
  }, []);

  return { query, results, isLoading, search, clear };
}
