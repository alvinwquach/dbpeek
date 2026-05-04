/**
 * DocsLayout.tsx — Three-panel docs layout with independent scroll columns.
 *
 * WHAT: Provides the three-panel layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  TopNav (sticky, full width)                 │
 *   ├─────────────┬───────────────────┬────────────┤
 *   │  Sidebar    │  Content (main)   │  TOC       │
 *   │  (fixed)    │  (scrolls page)   │  (fixed)   │
 *   └─────────────┴───────────────────┴────────────┘
 *
 * WHY FIXED (not sticky) for sidebar and TOC:
 *   position:sticky pins an element within its CONTAINING BLOCK. The
 *   containing block must be at least as tall as the page for sticky to
 *   work across the full scroll range. But that creates a different bug:
 *   when the sidebar's nav content is shorter than the viewport, the
 *   sticky div still reserves h-[100vh], leaving dead space below the
 *   last item. There is no CSS solution that satisfies both constraints.
 *
 *   position:fixed removes the containing-block dependency entirely. The
 *   sidebar is always exactly viewport-height, always scrolls internally,
 *   and the main content scrolls independently. Dead space is gone because
 *   the sidebar IS the full viewport height — there's nothing "below" it.
 *   This is how Stripe Docs, Linear Docs, and Vercel Docs are built.
 *
 * HOW:
 *   - Sidebar: fixed left-0 top-[64px] h-[calc(100vh-64px)] w-[256px]
 *   - TOC: fixed right-0 top-[64px] h-[calc(100vh-64px)] w-[224px]
 *   - Main: pl-[256px] pr-[224px] so content doesn't slide under the
 *     fixed columns. No grid needed — fixed elements are out of flow.
 *   - z-30 on fixed asides so they layer above main content scrolled
 *     underneath but below the command palette (z-50) and nav (z-40).
 */

import { type ReactNode, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { PageMetaProvider } from '@/lib/route-loader';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';
import { TableOfContents } from './TableOfContents';
import { PageNav } from './PageNav';
import { Breadcrumbs } from './Breadcrumbs';
import { EditOnGitHub } from './EditOnGitHub';
import { DocsFooter } from './DocsFooter';
import { MobileNav } from './MobileNav';
import { CommandPalette } from '../ui/CommandPalette';

interface DocsLayoutProps {
  children: ReactNode;
}

/** Pixel dimensions that must stay in sync with TopNav height and Tailwind classes. */
const NAV_HEIGHT = 64;
const SIDEBAR_WIDTH = 256;
const TOC_WIDTH = 224;

// Silence unused-variable lint — these constants document the intent and
// keep the numeric values in one place even though the values are inlined
// in Tailwind class strings below.
void NAV_HEIGHT; void SIDEBAR_WIDTH; void TOC_WIDTH;

export function DocsLayout({ children }: DocsLayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <PageMetaProvider>
      <div className="min-h-screen bg-white dark:bg-[#0a0a0f] text-[#0a0a0f] dark:text-[#ededf0]">

        {/* ── Top navigation ─────────────────────────────────────────────
            sticky + z-40 keeps the nav above the fixed sidebars and
            above main content that scrolls under it.                    */}
        <TopNav
          onOpenSearch={() => setPaletteOpen(true)}
          onMobileMenuOpen={() => setMobileNavOpen(true)}
        />

        {/* ── Left sidebar ───────────────────────────────────────────────
            Fixed at left-0, below the nav (top-[64px]).
            h-[calc(100vh-64px)]: fills exactly the remaining viewport so
              there is never dead space below the last nav item.
            overflow-y-auto: own scrollbar — sidebar scrolls independently
              of the page. When the full 35-item nav is taller than the
              viewport the user can scroll within the panel.
            border-r: subtle separator, doesn't extend past viewport.
            z-30: above main scroll content, below nav (z-40).
            Hidden on mobile — replaced by the MobileNav drawer.         */}
        <aside
          className="hidden lg:block fixed left-0 top-[64px] h-[calc(100vh-64px)] w-[256px] overflow-y-auto sidebar-scroll bg-white dark:bg-[#0a0a0f] border-r border-[#e4e4e7] dark:border-[#1e1e2e] py-6 px-4 z-30"
          aria-label="Documentation navigation"
        >
          <Sidebar currentSlug={pathname} />
        </aside>

        {/* ── Main content ───────────────────────────────────────────────
            lg:pl-[256px]: compensate for the fixed left sidebar.
            xl:pr-[224px]: compensate for the fixed right TOC.
            Without these, content would render beneath the fixed panels.
            data-content="true": lets extractHeadings() scope its DOM
              query to this area only, keeping sidebar text out of TOC.  */}
        <main
          className="lg:pl-[256px] xl:pr-[224px]"
          data-content="true"
        >
          {/*
            Inner wrapper: max-w-[760px] for comfortable reading line length.
            px-6 lg:px-12: breathing room between content and fixed panels.
            py-8: vertical rhythm above and below the article.
          */}
          <div className="mx-auto max-w-[760px] px-6 lg:px-12 py-8">
            <Breadcrumbs />
            <article className="prose-doc">{children}</article>
            <PageNav />
            <div className="mt-8 pt-4 border-t border-[#e4e4e7] dark:border-[#1e1e2e]">
              <EditOnGitHub />
            </div>
            <DocsFooter />
          </div>
        </main>

        {/* ── Right table of contents ────────────────────────────────────
            Same fixed-positioning treatment as the left sidebar.
            right-0, top-[64px], same height calculation.
            No border-l — TOC floats at the edge, cleaner without it.
            key={pathname} forces a remount on navigation so heading
              extraction and scroll-spy reset for the new page.          */}
        <aside
          className="hidden xl:block fixed right-0 top-[64px] h-[calc(100vh-64px)] w-[224px] overflow-y-auto sidebar-scroll bg-white dark:bg-[#0a0a0f] py-8 px-6 z-30"
          aria-label="Page table of contents"
        >
          <TableOfContents key={pathname} />
        </aside>

      </div>

      {/* Command palette — portal, z-50, overlays everything */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />

      {/* Mobile nav drawer — portal, overlays everything on small screens */}
      <MobileNav
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />
    </PageMetaProvider>
  );
}
