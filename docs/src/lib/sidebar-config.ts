/**
 * sidebar-config.ts — Single source of truth for all docs navigation.
 *
 * Used by:
 *   - Sidebar        — renders the nav tree with active-link highlighting
 *   - CommandPalette — powers Cmd+K quick-jump with fuzzy title+keyword search
 *   - PageNav        — derives prev/next page links by flattening this array
 *   - Breadcrumbs    — looks up the group label for the current slug
 *
 * Slugs are RELATIVE to /docs (the React Router basename). Never prefix a
 * slug with "/docs" — React Router's BrowserRouter basename handles that.
 *
 * Keywords supplement the label for search — e.g. "Installation" also
 * matches "npx", "node", "setup" so users find it regardless of phrasing.
 *
 * To add a page:
 *   1. Add a SidebarItem here with the correct slug.
 *   2. Create the .mdx file at src/content/<group>/<slug>.mdx.
 *   3. Add the Route in App.tsx.
 */

/** A single navigable page in the docs. */
export interface SidebarItem {
  /** Human-readable nav label (kept short for the sidebar column width). */
  label: string;
  /**
   * Route path relative to /docs. Must match the <Route path="..."> in App.tsx
   * exactly — including the leading slash, excluding the /docs prefix.
   */
  slug: string;
  /**
   * Extra search keywords not present in the label. Helps the command palette
   * surface the right page when users use synonyms or related terms.
   */
  keywords?: string[];
}

/** A collapsible group of related pages in the sidebar. */
export interface SidebarGroup {
  /** Displayed as a section header above the group's items. */
  label: string;
  /**
   * When true, the group renders collapsed on first load.
   * Currently unused — all groups default to open. Reserved for future
   * "collapse all" / "expand all" UX.
   */
  collapsed?: boolean;
  items: SidebarItem[];
}

/**
 * The full navigation tree. Order here determines the order in the sidebar
 * and the prev/next links at the bottom of each page.
 */
export const sidebar: SidebarGroup[] = [
  // ── 1. Getting started ────────────────────────────────────────────────────
  {
    label: 'Getting started',
    items: [
      {
        label: 'Introduction',
        slug: '/',
        keywords: ['intro', 'overview', 'about', 'what is dbpeek'],
      },
      {
        label: 'Installation',
        slug: '/getting-started/installation',
        keywords: ['install', 'npx', 'setup', 'node', 'npm', 'requirements'],
      },
      {
        label: 'Quickstart',
        slug: '/getting-started/quickstart',
        keywords: ['start', 'begin', 'walkthrough', 'first query', 'hello'],
      },
      {
        label: 'Connection strings',
        slug: '/getting-started/connection-strings',
        keywords: [
          'connect',
          'url',
          'postgres',
          'postgresql',
          'mysql',
          'sqlite',
          'mssql',
          'sql server',
          'connection url',
          'dsn',
        ],
      },
      {
        label: 'Permission modes',
        slug: '/getting-started/permission-modes',
        keywords: [
          'read-only',
          'readonly',
          'write',
          'full',
          'permissions',
          'security',
          'mode',
        ],
      },
    ],
  },

  // ── 2. Editor ─────────────────────────────────────────────────────────────
  {
    label: 'Editor',
    items: [
      {
        label: 'Overview',
        slug: '/editor/overview',
        keywords: ['editor', 'codemirror', 'sql editor'],
      },
      {
        label: 'Autocomplete',
        slug: '/editor/autocomplete',
        keywords: [
          'intellisense',
          'completion',
          'suggest',
          'hints',
          'autocompletion',
        ],
      },
      {
        label: 'Multi-tab',
        slug: '/editor/multi-tab',
        keywords: ['tabs', 'multiple queries', 'tabbed', 'workspaces'],
      },
      {
        label: 'Parameterized queries',
        slug: '/editor/parameterized-queries',
        keywords: ['params', 'parameters', 'variables', 'binding', 'prepared'],
      },
      {
        label: 'Format SQL',
        slug: '/editor/format-sql',
        keywords: ['format', 'pretty print', 'beautify', 'lint', 'prettier'],
      },
      {
        label: 'Query cancellation',
        slug: '/editor/query-cancellation',
        keywords: [
          'cancel',
          'stop',
          'kill',
          'interrupt',
          'abort',
          'long running',
        ],
      },
    ],
  },

  // ── 3. Schema ─────────────────────────────────────────────────────────────
  {
    label: 'Schema',
    items: [
      {
        label: 'Explorer',
        slug: '/schema/explorer',
        keywords: ['schema', 'tables', 'browse', 'tree', 'database objects'],
      },
      {
        label: 'Column statistics',
        slug: '/schema/column-statistics',
        keywords: ['stats', 'statistics', 'nulls', 'distinct', 'cardinality'],
      },
      {
        label: 'DDL viewer',
        slug: '/schema/ddl-viewer',
        keywords: ['ddl', 'create table', 'definition', 'schema sql'],
      },
      {
        label: 'Pin tables',
        slug: '/schema/pin-tables',
        keywords: ['pin', 'bookmark', 'favorite', 'quick access'],
      },
      {
        label: 'ERD diagrams',
        slug: '/schema/erd-diagrams',
        keywords: [
          'erd',
          'entity relationship',
          'diagram',
          'foreign keys',
          'relations',
        ],
      },
    ],
  },

  // ── 4. Results ────────────────────────────────────────────────────────────
  {
    label: 'Results',
    items: [
      {
        label: 'Grid',
        slug: '/results/grid',
        keywords: ['table', 'grid', 'rows', 'columns', 'data grid', 'datagrid'],
      },
      {
        label: 'Sorting & filtering',
        slug: '/results/sorting-filtering',
        keywords: ['sort', 'filter', 'order', 'where', 'search results'],
      },
      {
        label: 'Value viewer',
        slug: '/results/value-viewer',
        keywords: ['json', 'blob', 'long text', 'expand', 'cell detail'],
      },
      {
        label: 'Copy cell',
        slug: '/results/copy-cell',
        keywords: ['copy', 'clipboard', 'paste', 'tsv', 'csv'],
      },
      {
        label: 'Export',
        slug: '/results/export',
        keywords: ['export', 'download', 'csv', 'json', 'save results'],
      },
      {
        label: 'Charts',
        slug: '/results/charts',
        keywords: [
          'chart',
          'graph',
          'visualize',
          'bar chart',
          'line chart',
          'pie',
        ],
      },
    ],
  },

  // ── 5. Analysis ───────────────────────────────────────────────────────────
  {
    label: 'Analysis',
    items: [
      {
        label: 'Explain plans',
        slug: '/analysis/explain-plans',
        keywords: [
          'explain',
          'query plan',
          'analyze',
          'performance',
          'index scan',
          'seq scan',
        ],
      },
      {
        label: 'Query history',
        slug: '/analysis/query-history',
        keywords: ['history', 'past queries', 'recent', 'log'],
      },
      {
        label: 'Multi-statement',
        slug: '/analysis/multi-statement',
        keywords: ['batch', 'multiple statements', 'semicolon', 'transaction'],
      },
      {
        label: 'Session report',
        slug: '/analysis/session-report',
        keywords: ['session', 'report', 'summary', 'stats', 'overview'],
      },
      {
        label: 'Empty state',
        slug: '/analysis/empty-state',
        keywords: ['empty', 'no results', 'zero rows', 'blank'],
      },
    ],
  },

  // ── 6. Data modification ──────────────────────────────────────────────────
  {
    label: 'Data modification',
    items: [
      {
        label: 'Overview',
        slug: '/data-modification/overview',
        keywords: ['edit', 'modify', 'write', 'update', 'insert', 'delete'],
      },
      {
        label: 'Inline editing',
        slug: '/data-modification/inline-editing',
        keywords: ['inline edit', 'cell edit', 'edit row', 'update cell'],
      },
      {
        label: 'Import',
        slug: '/data-modification/import',
        keywords: ['import', 'csv', 'json', 'bulk insert', 'upload', 'load'],
      },
      {
        label: 'Table editor',
        slug: '/data-modification/table-editor',
        keywords: ['table editor', 'gui', 'spreadsheet', 'edit table'],
      },
      {
        label: 'Data diff',
        slug: '/data-modification/data-diff',
        keywords: ['diff', 'compare', 'changes', 'delta', 'before after'],
      },
    ],
  },

  // ── 7. Reference ──────────────────────────────────────────────────────────
  {
    label: 'Reference',
    items: [
      {
        label: 'CLI flags',
        slug: '/reference/cli-flags',
        keywords: [
          'cli',
          'flags',
          'options',
          'arguments',
          'command line',
          '--port',
          '--mode',
        ],
      },
      {
        label: 'Keyboard shortcuts',
        slug: '/reference/keyboard-shortcuts',
        keywords: [
          'shortcuts',
          'hotkeys',
          'keybindings',
          'keyboard',
          'cmd',
          'ctrl',
        ],
      },
      {
        label: 'Supported databases',
        slug: '/reference/supported-databases',
        keywords: [
          'databases',
          'postgres',
          'mysql',
          'sqlite',
          'mssql',
          'sql server',
          'support',
          'dialects',
        ],
      },
      {
        label: 'Troubleshooting',
        slug: '/reference/troubleshooting',
        keywords: [
          'troubleshoot',
          'error',
          'fix',
          'problem',
          'issue',
          'debug',
          'help',
        ],
      },
      {
        label: 'FAQ',
        slug: '/reference/faq',
        keywords: [
          'faq',
          'questions',
          'common',
          'frequently asked',
          'why',
          'how',
        ],
      },
    ],
  },

  // ── 8. Advanced ───────────────────────────────────────────────────────────
  {
    label: 'Advanced',
    items: [
      {
        label: 'Architecture',
        slug: '/advanced/architecture',
        keywords: [
          'architecture',
          'internals',
          'code',
          'codebase',
          'how it works',
          'security model',
        ],
      },
      {
        label: 'Privacy model',
        slug: '/advanced/privacy-model',
        keywords: [
          'privacy',
          'data',
          'local',
          'no cloud',
          'credentials',
          'telemetry',
        ],
      },
      {
        label: 'Credential audit',
        slug: '/advanced/credential-audit',
        keywords: [
          'credentials',
          'audit',
          'storage',
          'dbeaver',
          'datagrip',
          'tableplus',
          'security',
        ],
      },
      {
        label: 'Contributing',
        slug: '/advanced/contributing',
        keywords: [
          'contribute',
          'contributing',
          'pull request',
          'pr',
          'development',
          'open source',
        ],
      },
    ],
  },
];

/**
 * Flattened list of all sidebar items in order.
 * Used by PageNav to compute prev/next links without re-flattening each render.
 */
export const allItems: SidebarItem[] = sidebar.flatMap((group) => group.items);

/**
 * Look up which group a given slug belongs to.
 * Returns undefined if the slug is not found (e.g. 404 route).
 */
export function getGroupForSlug(slug: string): SidebarGroup | undefined {
  return sidebar.find((group) => group.items.some((item) => item.slug === slug));
}

/**
 * Return prev and next items relative to the given slug.
 * Used by PageNav at the bottom of each doc page.
 */
export function getPrevNext(slug: string): {
  prev: SidebarItem | null;
  next: SidebarItem | null;
} {
  const idx = allItems.findIndex((item) => item.slug === slug);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? (allItems[idx - 1] ?? null) : null,
    next: idx < allItems.length - 1 ? (allItems[idx + 1] ?? null) : null,
  };
}
