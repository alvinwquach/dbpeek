/**
 * MDXProvider — Provides styled component overrides for MDX elements.
 *
 * WHY: Without this, MDX renders unstyled HTML elements. By mapping every
 * HTML tag name to a styled React component, every .mdx file in the docs
 * site gets consistent typography and dark-theme colors automatically — no
 * className attributes in MDX content required.
 *
 * HOW: Uses @mdx-js/react's MDXProvider with a `components` prop that maps
 * HTML element names (h1, p, a, pre, code, …) to React components. Those
 * components apply Tailwind classes from the design system palette.
 *
 * Special cases:
 * - <h2> and <h3>: render an anchor link on hover using the Hash icon,
 *   enabling deep-linking and improving the TableOfContents experience.
 * - <a>: detects external hrefs and appends an ExternalLink icon; internal
 *   hrefs use React Router <Link>.
 * - <pre>: wraps shiki-processed code in CodeBlock for copy functionality.
 * - <code> inside <pre> is handled by shiki at build time — this component
 *   only styles inline `code` (backtick spans in prose).
 *
 * Custom components (DialectTabs, ScopeBadge, etc.) are also passed through
 * so MDX files can use them without importing.
 */

import React from 'react';
import { MDXProvider as BaseMDXProvider } from '@mdx-js/react';
import { Link } from 'react-router-dom';
import { Hash, ExternalLink } from 'lucide-react';

import { CopyButton } from '../ui/CopyButton';
import { Kbd } from '../ui/Kbd';
import { Pill } from '../ui/Pill';
import { DialectTabs, Tab } from './DialectTabs';
import { ScopeBadge } from './ScopeBadge';
import { KeyboardShortcut } from './KeyboardShortcut';
import { PrivacyCallout } from './PrivacyCallout';
import { WarningCallout } from './WarningCallout';
import { TerminalBlock } from './TerminalBlock';
import { CodeBlock } from './CodeBlock';
import { FeatureGrid } from './FeatureGrid';

// ─── Heading helpers ────────────────────────────────────────────────────────

/**
 * Generates a URL-safe anchor id from a heading's text content.
 * Mirrors what rehype-slug produces so our manually-placed # links match.
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

interface HeadingProps {
  children?: React.ReactNode;
  id?: string;
  [key: string]: unknown;
}

/**
 * An <h2> element with a hover-revealed anchor link.
 * The id is derived from rehype-slug (injected at build time) or computed here.
 */
const H2: React.FC<HeadingProps> = ({ children, id, ...rest }) => {
  const derivedId = id ?? slugify(String(children ?? ''));
  return (
    <h2
      id={derivedId}
      className="group flex items-center gap-2 text-2xl font-semibold text-[#0a0a0f] dark:text-[#ededf0] tracking-tight mt-12 mb-4 scroll-mt-20"
      {...rest}
    >
      {children}
      <a
        href={`#${derivedId}`}
        aria-label={`Link to section: ${String(children ?? '')}`}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#525252] dark:text-[#555566] hover:text-[#4a8af4]"
        tabIndex={-1}
      >
        <Hash size={16} aria-hidden="true" />
      </a>
    </h2>
  );
};

/**
 * An <h3> element with the same hover-anchor pattern as H2.
 */
const H3: React.FC<HeadingProps> = ({ children, id, ...rest }) => {
  const derivedId = id ?? slugify(String(children ?? ''));
  return (
    <h3
      id={derivedId}
      className="group flex items-center gap-2 text-xl font-semibold text-[#0a0a0f] dark:text-[#ededf0] tracking-tight mt-8 mb-3 scroll-mt-20"
      {...rest}
    >
      {children}
      <a
        href={`#${derivedId}`}
        aria-label={`Link to section: ${String(children ?? '')}`}
        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#525252] dark:text-[#555566] hover:text-[#4a8af4]"
        tabIndex={-1}
      >
        <Hash size={14} aria-hidden="true" />
      </a>
    </h3>
  );
};

// ─── Link helper ────────────────────────────────────────────────────────────

interface AnchorProps {
  href?: string;
  children?: React.ReactNode;
  [key: string]: unknown;
}

const isExternalHref = (href: string): boolean =>
  href.startsWith('http://') ||
  href.startsWith('https://') ||
  href.startsWith('//');

/**
 * Renders external hrefs as <a target="_blank"> with an icon, and internal
 * hrefs as React Router <Link> (inheriting the /docs basename).
 */
const Anchor: React.FC<AnchorProps> = ({ href = '#', children, ...rest }) => {
  if (isExternalHref(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4a8af4] hover:underline inline-flex items-center gap-1"
        {...rest}
      >
        {children}
        <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
      </a>
    );
  }
  return (
    <Link
      to={href}
      className="text-[#4a8af4] hover:underline"
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </Link>
  );
};

// ─── Pre / code (copy support) ──────────────────────────────────────────────

interface PreProps {
  children?: React.ReactNode;
  [key: string]: unknown;
}

/**
 * Wraps shiki-processed <pre> blocks with the CodeBlock container so the
 * CopyButton is available on every fenced code block in MDX.
 */
const Pre: React.FC<PreProps> = ({ children, ...rest }) => {
  // Extract raw text for the copy button by traversing the children tree.
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (React.isValidElement(node)) {
      return extractText((node.props as { children?: React.ReactNode }).children);
    }
    return '';
  };

  const rawText = extractText(children);

  return (
    <div className="relative bg-[#fafafa] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg overflow-hidden my-4">
      <div className="absolute top-2 right-2 z-10">
        <CopyButton text={rawText} />
      </div>
      <pre
        className="overflow-x-auto p-4 pr-10 text-sm [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-inherit"
        {...rest}
      >
        {children}
      </pre>
    </div>
  );
};

// ─── Table components ────────────────────────────────────────────────────────

const Table: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <div className="overflow-x-auto my-6">
    <table className="w-full border-collapse">{children}</table>
  </div>
);

const Th: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <th className="bg-[#f4f4f5] dark:bg-[#111118] border border-[#e4e4e7] dark:border-[#1e1e2e] text-left px-4 py-2.5 text-sm font-medium text-[#0a0a0f] dark:text-[#ededf0]">
    {children}
  </th>
);

const Td: React.FC<{ children?: React.ReactNode }> = ({ children }) => (
  <td className="border border-[#e4e4e7] dark:border-[#1e1e2e] px-4 py-2.5 text-sm text-[#525252] dark:text-[#ededf0]">
    {children}
  </td>
);

// ─── Component map ───────────────────────────────────────────────────────────

/**
 * Maps MDX element names to styled React components.
 * Also exposes custom components so MDX files can use them without importing.
 */
const components = {
  // Typography
  h1: (props: HeadingProps) => (
    <h1
      className="text-3xl font-semibold text-[#0a0a0f] dark:text-[#ededf0] tracking-tight mt-8 mb-4"
      {...props}
    />
  ),
  h2: H2,
  h3: H3,
  h4: (props: HeadingProps) => (
    <h4
      className="text-base font-semibold text-[#0a0a0f] dark:text-[#ededf0] mt-6 mb-2"
      {...props}
    />
  ),
  p: (props: { children?: React.ReactNode }) => (
    <p className="text-[#525252] dark:text-[#ededf0] leading-relaxed mb-4 text-base" {...props} />
  ),
  a: Anchor,

  // Lists
  ul: (props: { children?: React.ReactNode }) => (
    <ul className="ml-6 mb-4 list-disc space-y-1" {...props} />
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <ol className="ml-6 mb-4 list-decimal space-y-1" {...props} />
  ),
  li: (props: { children?: React.ReactNode }) => (
    <li className="text-[#525252] dark:text-[#ededf0] leading-relaxed" {...props} />
  ),

  // Block elements
  blockquote: (props: { children?: React.ReactNode }) => (
    <blockquote
      className="border-l-4 border-[#4a8af4] pl-4 italic text-[#525252] dark:text-[#8a8a9a] my-4"
      {...props}
    />
  ),
  pre: Pre,
  // Inline code — NOT pre>code (that's handled by shiki + Pre above)
  code: (props: { children?: React.ReactNode; className?: string }) => {
    // If className contains "language-*", this is a fenced block inside <pre>.
    // Let shiki handle it; only style inline backtick code here.
    if (props.className?.startsWith('language-')) {
      return <code {...props} />;
    }
    return (
      <code
        className="bg-[#f4f4f5] dark:bg-[#111118] text-[#4a8af4] px-1.5 py-0.5 rounded text-sm font-mono"
        {...props}
      />
    );
  },

  // Table
  table: Table,
  th: Th,
  td: Td,

  // Misc
  hr: () => <hr className="border-t border-[#e4e4e7] dark:border-[#1e1e2e] my-8" />,
  strong: (props: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-[#0a0a0f] dark:text-[#ededf0]" {...props} />
  ),
  em: (props: { children?: React.ReactNode }) => (
    <em className="italic text-[#525252] dark:text-[#8a8a9a]" {...props} />
  ),

  // ── Custom components available in all MDX files ──
  DialectTabs,
  Tab,
  ScopeBadge,
  KeyboardShortcut,
  PrivacyCallout,
  WarningCallout,
  TerminalBlock,
  CodeBlock,
  FeatureGrid,
  Kbd,
  Pill,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as Record<string, React.ComponentType<any>>;

// ─── Provider component ──────────────────────────────────────────────────────

interface DocsProviderProps {
  children: React.ReactNode;
}

/**
 * Wraps the docs app with the MDX component map.
 * Place this high in the tree (e.g. in App.tsx or DocsLayout) so every
 * MDX page rendered inside it inherits the styled components.
 */
export const DocsProvider: React.FC<DocsProviderProps> = ({ children }) => (
  <BaseMDXProvider components={components}>{children}</BaseMDXProvider>
);

export default DocsProvider;
