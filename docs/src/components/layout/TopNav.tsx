import { Search, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useKeyboard } from '@/hooks/useKeyboard';
import { useMemo } from 'react';

interface TopNavProps {
  onOpenSearch: () => void;
  onMobileMenuOpen?: () => void;
}

export function TopNav({ onOpenSearch, onMobileMenuOpen }: TopNavProps) {
  const { theme, toggleTheme } = useTheme();

  const shortcuts = useMemo(
    () => [{ key: 'k', meta: true, onMatch: onOpenSearch }],
    [onOpenSearch]
  );
  useKeyboard(shortcuts);

  return (
    <header
      className="
        fixed top-0 left-0 right-0 z-40
        h-16 w-full
        border-b border-[#e4e4e7] dark:border-[#1e1e2e]
        bg-white/95 dark:bg-[#0a0a0f]/95
        backdrop-blur-md
      "
    >
      <div className="flex h-full items-center justify-between px-6">

        {/* ── LEFT: brand cluster ───────────────────────────────────── */}
        <div className="flex items-center gap-3">
          {/* Plain anchor — escapes /docs basename to marketing site root */}
          <a
            href="/"
            className="flex items-center gap-2"
            aria-label="Back to dbpeek.com"
          >
            <span className="font-mono text-[#4a8af4] text-base">$</span>
            <span className="font-semibold text-[15px] text-[#0a0a0f] dark:text-[#ededf0]">
              dbpeek
            </span>
          </a>

          {/* Slash separator — marks section boundary */}
          <span className="text-[#d4d4d8] dark:text-[#1e1e2e] select-none">/</span>

          {/* "docs" pill — current section indicator, non-interactive */}
          <span
            className="
              px-2 py-0.5 rounded
              text-[12px] font-medium
              text-[#525252] dark:text-[#8a8a9a]
              bg-[#f4f4f5] dark:bg-[#111118]
              border border-[#e4e4e7] dark:border-[#1e1e2e]
            "
          >
            docs
          </span>

          {/* Version pill — links to GitHub releases */}
          <a
            href="https://github.com/alvinwquach/dbpeek/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="
              hidden md:inline-flex
              px-2 py-0.5 rounded
              text-[11px] font-medium font-mono
              text-[#4a8af4] hover:text-[#6a9ff5]
              bg-[#4a8af4]/10 hover:bg-[#4a8af4]/15
              border border-[#4a8af4]/20
              transition-colors
            "
          >
            v1.0.0
          </a>
        </div>

        {/* ── RIGHT: utility cluster ────────────────────────────────── */}
        <div className="flex items-center gap-2">

          {/* Search trigger — desktop, looks like an input */}
          <button
            type="button"
            onClick={onOpenSearch}
            className="
              hidden md:flex
              h-8 w-[220px] items-center gap-2
              px-3 rounded-md
              text-[13px] text-left
              text-[#8a8a9a] hover:text-[#525252]
              dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
              bg-[#f4f4f5] hover:bg-[#e4e4e7]
              dark:bg-[#111118] dark:hover:bg-[#1a1a24]
              border border-[#e4e4e7] dark:border-[#1e1e2e]
              transition-colors
            "
            aria-label="Search docs (Cmd+K)"
          >
            <Search size={14} />
            <span className="flex-1">Search docs</span>
            <kbd
              className="
                px-1.5 py-0.5 rounded
                text-[10px] font-mono
                text-[#8a8a9a]
                bg-white dark:bg-[#0a0a0f]
                border border-[#e4e4e7] dark:border-[#1e1e2e]
              "
            >
              ⌘K
            </kbd>
          </button>

          {/* Search icon — mobile only */}
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search docs"
            className="
              md:hidden
              flex h-8 w-8 items-center justify-center
              rounded-md
              text-[#8a8a9a] hover:text-[#0a0a0f] dark:hover:text-[#ededf0]
              hover:bg-[#f4f4f5] dark:hover:bg-[#111118]
              transition-colors
            "
          >
            <Search size={16} />
          </button>

          {/* GitHub icon button */}
          <a
            href="https://github.com/alvinwquach/dbpeek"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="dbpeek on GitHub"
            className="
              flex h-8 w-8 items-center justify-center rounded-md
              text-[#525252] hover:text-[#0a0a0f]
              dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
              hover:bg-[#f4f4f5] dark:hover:bg-[#111118]
              border border-transparent hover:border-[#e4e4e7]
              dark:hover:border-[#1e1e2e]
              transition-colors
            "
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61-.546-1.385-1.335-1.755-1.335-1.755-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.295 24 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>

          {/* Theme toggle — same visual treatment as GitHub button */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            className="
              flex h-8 w-8 items-center justify-center rounded-md
              text-[#525252] hover:text-[#0a0a0f]
              dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
              hover:bg-[#f4f4f5] dark:hover:bg-[#111118]
              border border-transparent hover:border-[#e4e4e7]
              dark:hover:border-[#1e1e2e]
              transition-colors
            "
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Mobile menu button — lg:hidden */}
          {onMobileMenuOpen && (
            <button
              type="button"
              onClick={onMobileMenuOpen}
              aria-label="Open navigation menu"
              className="
                lg:hidden
                flex h-8 w-8 items-center justify-center rounded-md
                text-[#525252] hover:text-[#0a0a0f]
                dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
                hover:bg-[#f4f4f5] dark:hover:bg-[#111118]
                transition-colors
              "
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 4h12M2 8h12M2 12h12"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
