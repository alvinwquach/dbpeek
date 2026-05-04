/**
 * DialectTabs — Shows SQL content for postgres / mysql / sqlite / mssql.
 *
 * WHY: Most SQL concepts differ slightly between databases. Rather than
 * duplicating a whole page per dialect, DialectTabs lets authors write one
 * page with dialect-specific snippets inline. The selected dialect persists
 * to localStorage so the reader's choice carries across page navigations.
 *
 * HOW: Two usage patterns are supported:
 *
 *   1. Prop pattern (preferred for short snippets):
 *      <DialectTabs
 *        postgres={<CodeBlock code="SELECT now();" />}
 *        mysql={<CodeBlock code="SELECT NOW();" />}
 *      />
 *
 *   2. Children pattern (for longer or mixed content):
 *      <DialectTabs>
 *        <Tab dialect="postgres">...postgres content...</Tab>
 *        <Tab dialect="mysql">...mysql content...</Tab>
 *      </DialectTabs>
 *
 * Inactive dialects are hidden with CSS (not unmounted) so code blocks
 * don't re-mount and lose copy-state on tab switch.
 *
 * Dialects not provided via props or children are shown as dimmed tabs to
 * communicate "this dialect is not yet documented here", without confusing
 * users who switched dialect globally.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ──────────────────────────────────────────────────────────────────

type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql';

const DIALECTS: Dialect[] = ['postgres', 'mysql', 'sqlite', 'mssql'];

const DIALECT_LABELS: Record<Dialect, string> = {
  postgres: 'PostgreSQL',
  mysql:    'MySQL',
  sqlite:   'SQLite',
  mssql:    'SQL Server',
};

const STORAGE_KEY = 'dbpeek-dialect';

interface DialectTabsProps {
  postgres?: React.ReactNode;
  mysql?:    React.ReactNode;
  sqlite?:  React.ReactNode;
  mssql?:   React.ReactNode;
  children?: React.ReactNode;
}

interface TabProps {
  dialect: Dialect | string;
  children: React.ReactNode;
}

// ─── Tab (child pattern) ────────────────────────────────────────────────────

/**
 * Used as a child of DialectTabs to provide per-dialect content.
 * The dialect prop must be one of: postgres | mysql | sqlite | mssql.
 */
export const Tab: React.FC<TabProps> = ({ children }) => (
  // Tab is a data carrier; DialectTabs reads its props and renders children.
  // This component itself never renders — DialectTabs intercepts the children.
  <>{children}</>
);

// ─── DialectTabs ─────────────────────────────────────────────────────────────

/**
 * Tabbed container showing SQL content for each supported database dialect.
 * Persists the selected dialect to localStorage across page navigations.
 */
export const DialectTabs: React.FC<DialectTabsProps> = ({
  postgres,
  mysql,
  sqlite,
  mssql,
  children,
}) => {
  // Read persisted dialect preference, defaulting to postgres.
  const [active, setActive] = useState<Dialect>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && DIALECTS.includes(stored as Dialect)) {
        return stored as Dialect;
      }
    } catch {
      // localStorage may be unavailable (SSR, private mode limits, etc.)
    }
    return 'postgres';
  });

  // Persist selection whenever the user changes tabs.
  const handleSelect = useCallback((dialect: Dialect) => {
    setActive(dialect);
    try {
      localStorage.setItem(STORAGE_KEY, dialect);
    } catch {
      // Silently ignore write failures.
    }
  }, []);

  // Sync if another DialectTabs on the same page changes the stored value.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue && DIALECTS.includes(e.newValue as Dialect)) {
        setActive(e.newValue as Dialect);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // ── Build content map ────────────────────────────────────────────────────

  /**
   * Merge prop-based content and children-based <Tab> elements into a single
   * dialect → ReactNode map. Prop content takes precedence over children.
   */
  const contentMap: Partial<Record<Dialect, React.ReactNode>> = {
    ...(postgres ? { postgres } : {}),
    ...(mysql    ? { mysql }    : {}),
    ...(sqlite   ? { sqlite }   : {}),
    ...(mssql    ? { mssql }    : {}),
  };

  // Extract <Tab dialect="..."> children.
  if (children) {
    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) return;
      const tabProps = child.props as TabProps;
      const dialect = tabProps.dialect as Dialect;
      if (DIALECTS.includes(dialect) && !(dialect in contentMap)) {
        contentMap[dialect] = tabProps.children;
      }
    });
  }

  const availableDialects = DIALECTS.filter((d) => d in contentMap);

  return (
    <div className="rounded-lg border border-[#e4e4e7] dark:border-[#1e1e2e] overflow-hidden my-4">
      {/* Tab bar */}
      <div
        className="flex bg-[#fafafa] dark:bg-[#0d0d14] border-b border-[#e4e4e7] dark:border-[#1e1e2e]"
        role="tablist"
        aria-label="SQL dialect"
      >
        {DIALECTS.map((dialect) => {
          const isAvailable = availableDialects.includes(dialect);
          const isActive = active === dialect;

          return (
            <button
              key={dialect}
              role="tab"
              aria-selected={isActive}
              aria-controls={`dialect-panel-${dialect}`}
              id={`dialect-tab-${dialect}`}
              disabled={!isAvailable}
              onClick={() => isAvailable && handleSelect(dialect)}
              className={[
                'px-4 py-2.5 text-sm font-medium transition-colors relative',
                isActive
                  ? 'text-[#4a8af4] border-b-2 border-[#4a8af4] bg-transparent -mb-px'
                  : isAvailable
                  ? 'text-[#525252] dark:text-[#8a8a9a] hover:text-[#0a0a0f] dark:hover:text-[#ededf0] border-b-2 border-transparent'
                  : 'text-[#8a8a9a] dark:text-[#555566] border-b-2 border-transparent cursor-not-allowed',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {DIALECT_LABELS[dialect]}
            </button>
          );
        })}
      </div>

      {/* Content panels — all rendered, inactive ones hidden */}
      {DIALECTS.map((dialect) => (
        <div
          key={dialect}
          id={`dialect-panel-${dialect}`}
          role="tabpanel"
          aria-labelledby={`dialect-tab-${dialect}`}
          hidden={active !== dialect || !(dialect in contentMap)}
          className="p-4 bg-[#fafafa] dark:bg-[#0d0d14]"
        >
          {contentMap[dialect] ?? null}
        </div>
      ))}

      {/* Fallback: active dialect not provided */}
      {!(active in contentMap) && availableDialects.length > 0 && (
        <div className="p-4 bg-[#fafafa] dark:bg-[#0d0d14] text-[#525252] dark:text-[#555566] text-sm italic">
          Content for {DIALECT_LABELS[active]} is not yet available on this page.
          {' '}Showing {DIALECT_LABELS[availableDialects[0]!]} instead.
        </div>
      )}
    </div>
  );
};

export default DialectTabs;
