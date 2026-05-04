import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    label: 'Resources',
    links: [
      {
        label: 'Releases',
        href: 'https://github.com/alvinwquach/dbpeek/releases',
        external: true,
      },
      {
        label: 'Roadmap',
        href: 'https://github.com/alvinwquach/dbpeek/blob/main/ROADMAP.md',
        external: true,
      },
      {
        label: 'Source code',
        href: 'https://github.com/alvinwquach/dbpeek',
        external: true,
      },
    ],
  },
  {
    label: 'Product',
    links: [
      { label: 'Marketing site', href: '/', internal: false },
      { label: 'Privacy model', href: '/advanced/privacy-model', internal: true },
      { label: 'FAQ', href: '/reference/faq', internal: true },
    ],
  },
  {
    label: 'Project',
    links: [
      {
        label: 'License (MIT)',
        href: 'https://github.com/alvinwquach/dbpeek/blob/main/LICENSE',
        external: true,
      },
      {
        label: 'Contributing',
        href: 'https://github.com/alvinwquach/dbpeek/blob/main/CONTRIBUTING.md',
        external: true,
      },
      {
        label: 'Report an issue',
        href: 'https://github.com/alvinwquach/dbpeek/issues/new',
        external: true,
      },
    ],
  },
] as const;

export function DocsFooter() {
  return (
    <footer
      className="
        mt-16 pt-8 pb-8
        border-t border-[#e4e4e7] dark:border-[#1e1e2e]
      "
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
        {SECTIONS.map((section) => (
          <div key={section.label}>
            <p className="
              text-[11px] font-semibold uppercase tracking-[0.08em]
              text-[#525252] dark:text-[#555566]
              mb-3
            ">
              {section.label}
            </p>
            <ul className="space-y-2">
              {section.links.map((link) => (
                <li key={link.label}>
                  {'external' in link && link.external ? (
                    <a
                      href={link.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="
                        text-[13px]
                        text-[#525252] hover:text-[#0a0a0f]
                        dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
                        transition-colors
                      "
                    >
                      {link.label}
                    </a>
                  ) : 'internal' in link && link.internal ? (
                    <Link
                      to={link.href}
                      className="
                        text-[13px]
                        text-[#525252] hover:text-[#0a0a0f]
                        dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
                        transition-colors
                      "
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      className="
                        text-[13px]
                        text-[#525252] hover:text-[#0a0a0f]
                        dark:text-[#8a8a9a] dark:hover:text-[#ededf0]
                        transition-colors
                      "
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="
        pt-6 mt-2
        border-t border-[#e4e4e7] dark:border-[#1e1e2e]
        flex flex-col md:flex-row md:items-center md:justify-between
        gap-3
        text-[12px] text-[#8a8a9a] dark:text-[#555566]
      ">
        <span>
          dbpeek · MIT License · Built by{' '}
          <a
            href="https://alvinquach.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#525252] dark:text-[#8a8a9a] hover:text-[#4a8af4]"
          >
            Alvin Quach
          </a>
        </span>
        <span className="font-mono">v1.0.0</span>
      </div>
    </footer>
  );
}
