import { useState, useEffect } from 'react'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'Privacy',  href: '#privacy'  },
  { label: 'Scope',    href: '#scope'    },
  { label: 'Compare',  href: '#compare'  },
  { label: 'FAQ',      href: '#faq'      },
  { label: 'Docs',     href: '/docs'     },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleLinkClick = () => setMobileOpen(false)

  return (
    <header
      className={[
        'fixed top-0 inset-x-0 z-50 transition-all duration-300',
        scrolled
          ? 'backdrop-blur-xl bg-[#0a0a0f]/80 border-b border-[#1e1e2e]'
          : 'bg-transparent',
      ].join(' ')}
    >
      <nav className="mx-auto max-w-6xl px-5 sm:px-8 h-14 flex items-center justify-between">

        <a
          href="#"
          className="flex items-center gap-2 no-underline"
          aria-label="dbpeek home"
        >
          <span className="font-mono text-[#4a8af4] text-lg font-semibold select-none">$</span>
          <span className="font-mono text-[15px] font-semibold tracking-tight text-[#ededf0]">dbpeek</span>
        </a>

        <div className="hidden sm:flex items-center gap-7">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13px] text-[#8a8a9a] hover:text-[#ededf0] transition-colors font-medium"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden sm:flex items-center">
          <a
            href="https://github.com/alvinwquach/dbpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] border border-[#1e1e2e] text-[13px] text-[#8a8a9a] hover:text-[#ededf0] font-medium transition-all duration-200"
          >
            <svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
            Star on GitHub
          </a>
        </div>

        <button
          className="sm:hidden p-2 rounded-md text-[#8a8a9a] hover:text-[#ededf0] transition-colors"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
        >
          <div className="w-5 h-4 flex flex-col justify-between">
            <span className={`block h-px bg-current transition-all duration-200 origin-center ${mobileOpen ? 'rotate-45 translate-y-[7.5px]' : ''}`} />
            <span className={`block h-px bg-current transition-all duration-200 ${mobileOpen ? 'opacity-0 scale-x-0' : ''}`} />
            <span className={`block h-px bg-current transition-all duration-200 origin-center ${mobileOpen ? '-rotate-45 -translate-y-[7.5px]' : ''}`} />
          </div>
        </button>
      </nav>

      {/* Mobile drawer — CSS max-height transition */}
      <div
        className={[
          'sm:hidden overflow-hidden transition-all duration-300',
          'bg-[#0a0a0f]/95 backdrop-blur-xl border-b border-[#1e1e2e]',
          mobileOpen ? 'max-h-64' : 'max-h-0',
        ].join(' ')}
      >
        <div className="px-5 py-4 flex flex-col gap-1">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={handleLinkClick}
              className="py-2.5 text-[15px] text-[#8a8a9a] hover:text-[#ededf0] transition-colors font-medium"
            >
              {link.label}
            </a>
          ))}
          <a
            href="https://github.com/alvinwquach/dbpeek"
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            className="mt-2 py-2.5 text-[15px] text-[#555566] hover:text-[#8a8a9a] transition-colors"
          >
            GitHub →
          </a>
        </div>
      </div>
    </header>
  )
}
