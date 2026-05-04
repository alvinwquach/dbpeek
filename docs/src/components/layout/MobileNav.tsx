/**
 * MobileNav — Slide-in drawer for the sidebar on mobile viewports.
 *
 * WHY: The sidebar is hidden on mobile (lg:block) to preserve screen space.
 * When a user taps the hamburger menu, this drawer slides in from the left
 * and displays the full Sidebar component inside a scrollable container.
 *
 * HOW:
 * - Rendered via React.createPortal to document.body so the drawer overlays
 *   all content regardless of the parent's stacking context or overflow rules.
 * - A semi-transparent backdrop covers the rest of the screen. Clicking it
 *   closes the drawer.
 * - The Escape key also closes the drawer (registered via useEffect).
 * - Focus is trapped: when the drawer opens, the close button receives focus.
 *   When it closes, focus returns to the element that triggered the open
 *   (tracked via ref).
 * - Body scroll is locked while the drawer is open so the background doesn't
 *   scroll underneath it.
 * - CSS transitions (not Framer Motion — Framer Motion is reserved for the
 *   command palette per the design rules) drive the slide-in animation.
 *
 * Props:
 *   open        — whether the drawer is visible
 *   onClose     — called to close the drawer
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';

interface MobileNavProps {
  /** Whether the drawer is currently open. */
  open: boolean;
  /** Called when the user requests to close the drawer. */
  onClose: () => void;
}

/**
 * Left-side slide-in drawer containing the docs Sidebar.
 * Portaled to document.body; controlled by the open/onClose props.
 */
export const MobileNav: React.FC<MobileNavProps> = ({ open, onClose }) => {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<Element | null>(null);

  // ── Body scroll lock & focus management ──────────────────────────────────

  useEffect(() => {
    if (open) {
      // Remember what was focused before opening so we can restore it.
      previousFocusRef.current = document.activeElement;
      // Lock body scroll to prevent the page from scrolling behind the drawer.
      document.body.style.overflow = 'hidden';
      // Move focus to the close button (first interactive element in drawer).
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    } else {
      document.body.style.overflow = '';
      // Restore focus when the drawer closes.
      if (previousFocusRef.current instanceof HTMLElement) {
        previousFocusRef.current.focus();
      }
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ── Escape key handler ────────────────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // ── Portal guard (SSR safety) ─────────────────────────────────────────────

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/*
        Backdrop — fades in/out via CSS opacity transition.
        pointer-events:none when closed so it doesn't block clicks.
      */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={[
          'fixed inset-0 z-40 bg-black/60',
          'transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/*
        Drawer — slides in from the left via CSS transform transition.
        w-72 matches the sidebar's natural width on desktop.
      */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Documentation navigation"
        className={[
          'fixed top-0 left-0 bottom-0 z-50 w-72',
          'bg-[#f4f4f5] dark:bg-[#111118] border-r border-[#e4e4e7] dark:border-[#1e1e2e]',
          'transform transition-transform duration-200 ease-out',
          'overflow-y-auto sidebar-scroll',
          open ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* ── Drawer header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#e4e4e7] dark:border-[#1e1e2e] sticky top-0 bg-[#f4f4f5] dark:bg-[#111118] z-10">
          {/* Logo / title */}
          <span className="font-mono text-sm font-medium text-[#0a0a0f] dark:text-[#ededf0]">
            <span className="text-[#4a8af4]">db</span>peek{' '}
            <span className="ml-1 rounded bg-white dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] px-1.5 py-0.5 text-xs text-[#525252] dark:text-[#8a8a9a]">
              docs
            </span>
          </span>

          {/* Close button */}
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close navigation"
            className={[
              'p-1.5 rounded text-[#525252] dark:text-[#8a8a9a]',
              'hover:text-[#0a0a0f] dark:hover:text-[#ededf0] hover:bg-[#e4e4e7] dark:hover:bg-[#1e1e2e]',
              'transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a8af4]',
            ].join(' ')}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* ── Sidebar content ── */}
        {/*
          Pass onLinkClick so the drawer closes when a nav item is selected.
          Without this, the drawer would stay open after navigation.
        */}
        <Sidebar onLinkClick={onClose} />
      </div>
    </>,
    document.body
  );
};

export default MobileNav;
