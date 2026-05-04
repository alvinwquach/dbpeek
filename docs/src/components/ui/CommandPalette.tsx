/**
 * CommandPalette.tsx — Cmd+K search modal for the docs site.
 *
 * WHAT: A full-screen overlay dialog with a search input that queries the
 * FlexSearch index and presents ranked results. Closing navigates to the
 * selected page.
 *
 * WHY: A command palette is faster than sidebar scanning for users who know
 * what they're looking for. It also surfaces deep pages that aren't visible
 * in the sidebar without scrolling.
 *
 * HOW:
 *   1. Triggered by Cmd+K (registered in TopNav via useKeyboard).
 *   2. On open, the search input auto-focuses so the user can type immediately.
 *   3. useSearch handles debouncing and FlexSearch index lazy-loading.
 *   4. Keyboard navigation: Arrow up/down to move selection, Enter to navigate,
 *      Escape to close.
 *   5. framer-motion animates the backdrop and dialog in/out.
 *   6. Clicking the backdrop closes the palette.
 *
 * Accessibility:
 *   - role="dialog" + aria-modal="true" traps screen reader focus.
 *   - aria-activedescendant tracks the highlighted result.
 *   - Results have role="option" inside role="listbox".
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowRight, Loader2 } from 'lucide-react';
import { useSearch } from '@/hooks/useSearch';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useMemo } from 'react';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { query, results, isLoading, search, clear } = useSearch();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Auto-focus input when palette opens; clear state when it closes
  useEffect(() => {
    if (open) {
      setSelectedIdx(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else {
      clear();
    }
  }, [open, clear]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [results]);

  const handleSelect = useCallback(
    (slug: string) => {
      onClose();
      navigate(slug);
    },
    [navigate, onClose]
  );

  // Keyboard navigation within the palette
  const paletteShortcuts = useMemo(
    () => [
      {
        key: 'Escape',
        allowInInput: true,
        onMatch: onClose,
      },
      {
        key: 'ArrowDown',
        allowInInput: true,
        onMatch: () =>
          setSelectedIdx((prev) => Math.min(prev + 1, results.length - 1)),
      },
      {
        key: 'ArrowUp',
        allowInInput: true,
        onMatch: () => setSelectedIdx((prev) => Math.max(prev - 1, 0)),
      },
      {
        key: 'Enter',
        allowInInput: true,
        onMatch: () => {
          const result = results[selectedIdx];
          if (result) handleSelect(result.slug);
        },
      },
    ],
    [onClose, results, selectedIdx, handleSelect]
  );
  useKeyboard(paletteShortcuts);

  // Scroll the selected item into view when arrow keys change selection
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const selected = list.children[selectedIdx] as HTMLElement | undefined;
    selected?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-white/80 dark:bg-[#0a0a0f]/80 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Dialog */}
          <motion.div
            key="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Search documentation"
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="
              fixed left-1/2 top-[10vh] z-50
              w-full max-w-[560px] -translate-x-1/2
              rounded-xl border border-[#e4e4e7] dark:border-[#1e1e2e]
              bg-white dark:bg-[#111118] shadow-2xl shadow-black/20 dark:shadow-black/50
              overflow-hidden
            "
          >
            {/* Search input row */}
            <div className="flex items-center gap-3 border-b border-[#e4e4e7] dark:border-[#1e1e2e] px-4 py-3">
              {isLoading ? (
                <Loader2 size={16} className="text-[#525252] dark:text-[#8a8a9a] animate-spin flex-shrink-0" />
              ) : (
                <Search size={16} className="text-[#525252] dark:text-[#8a8a9a] flex-shrink-0" />
              )}
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls="palette-results"
                aria-autocomplete="list"
                placeholder="Search docs..."
                value={query}
                onChange={(e) => search(e.target.value)}
                className="
                  flex-1 bg-transparent text-[#0a0a0f] dark:text-[#ededf0] placeholder-[#525252] dark:placeholder-[#555566]
                  text-sm outline-none
                "
              />
              {query && (
                <button
                  onClick={clear}
                  className="text-xs text-[#525252] dark:text-[#555566] hover:text-[#0a0a0f] dark:hover:text-[#8a8a9a] transition-colors"
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Results list */}
            {results.length > 0 && (
              <ul
                id="palette-results"
                ref={listRef}
                role="listbox"
                aria-label="Search results"
                className="max-h-[400px] overflow-y-auto py-2"
              >
                {results.map((result, idx) => {
                  const isSelected = idx === selectedIdx;
                  return (
                    <li
                      key={result.slug}
                      role="option"
                      aria-selected={isSelected}
                      id={`palette-result-${idx}`}
                    >
                      <button
                        onClick={() => handleSelect(result.slug)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                        className={[
                          'w-full text-left px-4 py-3 flex items-start gap-3 transition-colors',
                          isSelected ? 'bg-[#4a8af4]/10' : 'hover:bg-[#f4f4f5] dark:hover:bg-[#0d0d14]',
                        ].join(' ')}
                      >
                        {/* Category badge */}
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="
                              rounded bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e]
                              px-1.5 py-0.5 text-xs text-[#525252] dark:text-[#555566] font-mono
                              flex-shrink-0
                            ">
                              {result.category}
                            </span>
                            <span className={[
                              'text-sm font-medium truncate',
                              isSelected ? 'text-[#4a8af4]' : 'text-[#0a0a0f] dark:text-[#ededf0]',
                            ].join(' ')}>
                              {result.title}
                            </span>
                          </div>
                          {result.snippet && (
                            <p className="text-xs text-[#525252] dark:text-[#555566] line-clamp-1 pl-0">
                              {result.snippet}
                            </p>
                          )}
                        </div>
                        {isSelected && (
                          <ArrowRight
                            size={14}
                            className="text-[#4a8af4] flex-shrink-0 mt-0.5"
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Empty state */}
            {query && !isLoading && results.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[#525252] dark:text-[#555566]">
                  No results for{' '}
                  <span className="text-[#0a0a0f] dark:text-[#8a8a9a]">"{query}"</span>
                </p>
                <p className="mt-1 text-xs text-[#525252] dark:text-[#555566]">
                  Try a different term or browse the sidebar.
                </p>
              </div>
            )}

            {/* Footer hints */}
            <div className="flex items-center gap-4 border-t border-[#e4e4e7] dark:border-[#1e1e2e] px-4 py-2">
              <span className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#555566]">
                <kbd className="rounded border border-[#e4e4e7] dark:border-[#1e1e2e] px-1 font-mono text-xs">↑↓</kbd>
                Navigate
              </span>
              <span className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#555566]">
                <kbd className="rounded border border-[#e4e4e7] dark:border-[#1e1e2e] px-1 font-mono text-xs">↵</kbd>
                Open
              </span>
              <span className="flex items-center gap-1 text-xs text-[#525252] dark:text-[#555566]">
                <kbd className="rounded border border-[#e4e4e7] dark:border-[#1e1e2e] px-1 font-mono text-xs">Esc</kbd>
                Close
              </span>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
