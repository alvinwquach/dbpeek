/**
 * CommandPalette — Cmd+K modal search palette.
 *
 * WHY: A keyboard-accessible search palette is the fastest way for users
 * familiar with the docs to jump between pages. It also handles common
 * external actions (back to marketing site, GitHub links) without leaving
 * the keyboard.
 *
 * HOW:
 * - Rendered via React.createPortal into document.body so it sits above
 *   all content regardless of stacking context.
 * - Framer Motion animates the backdrop (opacity) and modal (scale + opacity)
 *   with a 0.15s ease-out enter, instant exit.
 * - usePalette drives all state and keyboard navigation.
 * - When the user selects a result:
 *     Internal route → React Router navigate() (basename="/docs" is automatic)
 *     External URL   → window.open() for new-tab links
 *     "Back to dbpeek.com" → window.location.href = '/' (exits /docs basename)
 * - Body scroll is locked while the palette is open.
 * - Focus is restored to the triggering element on close.
 *
 * Props:
 *   open       — controlled open state (from DocsLayout)
 *   onClose    — called when the palette requests to close
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

import { usePalette } from './usePalette';
import { PaletteInput } from './PaletteInput';
import { PaletteResults } from './PaletteResults';
import { PaletteEmpty } from './PaletteEmpty';
import type { SidebarItem } from '@/lib/sidebar-config';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  /** Whether the palette is visible. Controlled by DocsLayout. */
  open: boolean;
  /** Called when the palette wants to close (backdrop click, Escape, selection). */
  onClose: () => void;
}

// ─── External action URLs ────────────────────────────────────────────────────

const MARKETING_ROOT = '/';

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Full-screen command palette modal with animated entrance and keyboard nav.
 */
export const CommandPalette: React.FC<CommandPaletteProps> = ({
  open,
  onClose,
}) => {
  const navigate = useNavigate();

  // usePalette manages query, results, selection, and the Cmd+K listener.
  // We pass through open/close from props so the layout controls visibility.
  const {
    query,
    setQuery,
    selectedIndex,
    results,
    handleKeyDown: paletteKeyDown,
    closePalette: _closePalette,  // palette's own close — we wrap it
  } = usePalette();

  // Ref to the previously focused element, for focus restoration on close.
  const previousFocusRef = useRef<Element | null>(null);

  // ── Body scroll lock ──────────────────────────────────────────────────────

  useEffect(() => {
    if (open) {
      previousFocusRef.current = document.activeElement;
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      // Restore focus when palette closes.
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ── Navigation helpers ────────────────────────────────────────────────────

  /** Navigate to an internal docs route, then close the palette. */
  const navigateTo = useCallback(
    (item: SidebarItem) => {
      onClose();
      navigate(item.slug);
    },
    [navigate, onClose]
  );

  /**
   * Handle an external action URL.
   * - The marketing root ("/") uses window.location.href to exit the /docs basename.
   * - All other external URLs open in a new tab.
   */
  const handleExternal = useCallback(
    (url: string) => {
      onClose();
      if (url === MARKETING_ROOT) {
        window.location.href = url;
      } else {
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    },
    [onClose]
  );

  /** Navigate to an internal slug from the PaletteEmpty quick-jump list. */
  const handleQuickNavigate = useCallback(
    (slug: string) => {
      onClose();
      navigate(slug);
    },
    [navigate, onClose]
  );

  // ── Keyboard handler (wraps usePalette's handler) ─────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const selectedItem = paletteKeyDown(e);
      if (selectedItem) {
        navigateTo(selectedItem);
      }
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [paletteKeyDown, navigateTo, onClose]
  );

  // ── Portal target ─────────────────────────────────────────────────────────

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="palette-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* ── Modal ── */}
          <motion.div
            key="palette-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette — search documentation"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={[
              'fixed top-[20%] left-1/2 -translate-x-1/2',
              'w-full max-w-xl',
              'bg-white dark:bg-[#111118] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-xl shadow-2xl overflow-hidden',
              'z-50',
            ].join(' ')}
            // Prevent backdrop click from propagating through modal.
            onClick={(e) => e.stopPropagation()}
          >
            {/* ── Input row ── */}
            <PaletteInput
              value={query}
              onChange={setQuery}
              onKeyDown={handleKeyDown}
              autoFocus
            />

            {/* ── Results / empty state ── */}
            {query.trim() ? (
              results.length > 0 ? (
                <PaletteResults
                  results={results}
                  selectedIndex={selectedIndex}
                  onSelect={navigateTo}
                />
              ) : (
                // No results for the current query
                <div className="px-4 py-8 text-center">
                  <p className="text-[#525252] dark:text-[#555566] text-sm">
                    No results for{' '}
                    <span className="text-[#0a0a0f] dark:text-[#8a8a9a]">"{query}"</span>
                  </p>
                </div>
              )
            ) : (
              // Empty query — show quick-jump and external actions
              <PaletteEmpty
                onNavigate={handleQuickNavigate}
                onExternal={handleExternal}
              />
            )}

            {/* ── Footer hint bar ── */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-[#e4e4e7] dark:border-[#1e1e2e]">
              <div className="flex items-center gap-3 text-[#525252] dark:text-[#555566] text-xs">
                <span className="flex items-center gap-1">
                  <kbd className="bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded px-1 text-[10px] font-mono">↑</kbd>
                  <kbd className="bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded px-1 text-[10px] font-mono">↓</kbd>
                  navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded px-1 text-[10px] font-mono">↵</kbd>
                  select
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded px-1 text-[10px] font-mono">esc</kbd>
                  close
                </span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default CommandPalette;
