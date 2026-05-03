export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-[#1e1e2e]/60 mt-10">
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">

        <div className="flex items-center gap-3 text-[#555566] text-[13px]">
          <span className="font-mono text-[#8a8a9a] font-semibold">dbpeek</span>
          <span className="text-[#1e1e2e]">·</span>
          <span>MIT License</span>
          <span className="text-[#1e1e2e]">·</span>
          <span>© {year}</span>
        </div>

        <p className="text-[#555566] text-[13px]">
          Built by{' '}
          <a
            href="https://alvinquach.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#8a8a9a] hover:text-[#ededf0] transition-colors underline underline-offset-2"
          >
            Alvin Quach
          </a>
        </p>

        <div className="flex items-center gap-5 text-[13px]">
          <a
            href="https://github.com/alvinwquach/dbpeek"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#555566] hover:text-[#ededf0] transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://linkedin.com/in/alvinwquach"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#555566] hover:text-[#ededf0] transition-colors"
          >
            LinkedIn
          </a>
          <a
            href="https://alvinquach.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#555566] hover:text-[#ededf0] transition-colors"
          >
            alvinquach.dev
          </a>
        </div>

      </div>
    </footer>
  )
}
