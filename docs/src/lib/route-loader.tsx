/**
 * route-loader.tsx — Standard page chrome wrapper for MDX content pages.
 *
 * WHAT: A React context and hook that lets MDX pages declare metadata
 * (title, description) which the outer DocsLayout can read to render the
 * page header, breadcrumbs, and <title> tag — without polluting MDX files
 * with layout concerns.
 *
 * WHY: MDX files should be pure content. If every .mdx file had to import
 * and render a <PageHeader title="..." /> component, we'd have 40+ files
 * to update every time the header design changed. The context pattern keeps
 * the boilerplate in one place.
 *
 * HOW:
 *   1. DocsLayout renders <PageMetaContext.Provider> wrapping all routes.
 *   2. Each MDX file (optionally) calls useSetPageMeta({ title, description })
 *      in an effect to register its metadata.
 *   3. DocsLayout reads the metadata via usePageMeta() to render the heading.
 *   4. Metadata resets on route change so stale titles don't persist.
 *
 * For pages that don't call useSetPageMeta, the layout falls back to the
 * sidebar item label derived from the current slug.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';

/** Metadata a page can declare about itself. */
export interface PageMeta {
  /** Displayed as the h1 at the top of the content area and in <title>. */
  title: string;
  /** Optional subtitle shown below the title in a muted style. */
  description?: string;
}

interface PageMetaContextValue {
  meta: PageMeta | null;
  setMeta: (meta: PageMeta | null) => void;
}

const PageMetaContext = createContext<PageMetaContextValue>({
  meta: null,
  setMeta: () => undefined,
});

/**
 * PageMetaProvider wraps the entire route tree so any page can register its
 * metadata without prop drilling. Place this above <Routes> in DocsLayout.
 */
export function PageMetaProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<PageMeta | null>(null);
  return (
    <PageMetaContext.Provider value={{ meta, setMeta }}>
      {children}
    </PageMetaContext.Provider>
  );
}

/**
 * Read the current page's registered metadata.
 * Used by DocsLayout to render the page header section.
 */
export function usePageMeta(): PageMeta | null {
  return useContext(PageMetaContext).meta;
}

/**
 * Register page metadata from within an MDX page component.
 *
 * Call at the top level of your MDX export default component:
 *   useSetPageMeta({ title: 'Installation', description: '...' });
 *
 * The effect runs on mount and clears on unmount (route change), so
 * navigating away resets the title rather than showing the previous page's
 * title during the next page's render cycle.
 *
 * @param meta - Static object — recreating it on every render is fine because
 *   useEffect's dependency array compares by reference, and the layout will
 *   only re-render when the title/description values actually change.
 */
export function useSetPageMeta(meta: PageMeta): void {
  const { setMeta } = useContext(PageMetaContext);
  const { title, description } = meta;
  useEffect(() => {
    setMeta({ title, description });
    document.title = `${title} — dbpeek docs`;
    return () => {
      setMeta(null);
    };
  }, [title, description, setMeta]);
}
