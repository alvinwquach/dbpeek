import { useState, useRef, useEffect } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'

interface FAQItem {
  q: string
  a: string | React.ReactNode
}

const FAQS: FAQItem[] = [
  {
    q: 'Is it free?',
    a: 'Yes. dbpeek is MIT licensed and always will be. There are no plans, no paywalls, and no "community edition" gotchas. Run it as much as you want.',
  },
  {
    q: 'What databases are supported?',
    a: "PostgreSQL, MySQL, SQLite, and Microsoft SQL Server (MSSQL). The connection string format follows each driver's standard URL scheme. CockroachDB and PlanetScale work via the PostgreSQL and MySQL drivers respectively.",
  },
  {
    q: 'What operating systems does dbpeek work on?',
    a: 'macOS, Linux, and Windows. On Windows, both native PowerShell and WSL work. Anywhere Node.js 18+ runs, dbpeek runs.',
  },
  {
    q: 'What keyboard shortcuts are supported?',
    a: 'Cmd/Ctrl+Enter runs the current query. Cmd/Ctrl+Shift+Enter runs only the selected text. Cmd/Ctrl+/ toggles comments. Cmd/Ctrl+Shift+F formats SQL. Cmd/Ctrl+E runs EXPLAIN. Cmd/Ctrl+H opens the history panel. Full list in the README.',
  },
  {
    q: 'Is it safe to use on production?',
    a: 'dbpeek opens a read-only session by default — DML and DDL are blocked unless you pass --write (enables UPDATE/INSERT/DELETE) or --full (enables all DDL). Most users never need either flag.',
  },
  {
    q: 'Where are my credentials stored?',
    a: 'Nowhere. The connection URL you pass on the command line lives in process memory for the lifetime of the session. Nothing is written to disk, no config file is created, and no environment variable is set. When the process exits, the password is gone.',
  },
  {
    q: 'Can I use it with Docker?',
    a: 'Yes. As long as your host machine can reach the database — via published port, host networking, or a tunnel — the connection string will work. For containers that expose postgres on localhost:5432, nothing special is needed.',
  },
  {
    q: 'How is this different from DBeaver or pgAdmin?',
    a: "Those are GUI apps you install, configure, and grant persistent access to your credentials. dbpeek is a temporary process. There's no installer, no saved connections, no telemetry, and no config directory. It disappears when you close the terminal.",
  },
  {
    q: 'How do I report a bug or request a feature?',
    a: (
      <>
        Open an issue at{' '}
        <a
          href="https://github.com/alvinwquach/dbpeek/issues"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#4a8af4] underline hover:text-[#5b9bff] transition-colors"
        >
          github.com/alvinwquach/dbpeek/issues
        </a>
        . Bug reports with a connection string format and dialect are especially appreciated.
      </>
    ),
  },
]

function AccordionItem({ item, index }: { item: FAQItem; index: number }) {
  const [open, setOpen] = useState(false)
  const answerRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)

  // Fade-in on scroll
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(rowRef.current, {
        y: 12,
        opacity: 0,
        duration: 0.4,
        delay: index * 0.04,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: rowRef.current,
          start: 'top 88%',
          once: true,
        },
      })
    }, rowRef)
    return () => ctx.revert()
  }, [index])

  const toggle = () => {
    const el = answerRef.current
    if (!el) return

    if (!open) {
      // Expand
      gsap.set(el, { display: 'block', height: 'auto' })
      const h = el.offsetHeight
      gsap.fromTo(el,
        { height: 0, opacity: 0 },
        { height: h, opacity: 1, duration: 0.3, ease: 'power3.out',
          onComplete: () => gsap.set(el, { height: 'auto' })
        }
      )

      // SplitText stagger on lines
      const p = el.querySelector('p')
      if (p) {
        const split = new SplitText(p, { type: 'lines', linesClass: 'faq-line' })
        gsap.from(split.lines, {
          opacity: 0,
          y: 6,
          duration: 0.35,
          stagger: 0.03,
          ease: 'power2.out',
          delay: 0.08,
          onComplete: () => split.revert(),
        })
      }
    } else {
      // Collapse
      gsap.to(el, {
        height: 0,
        opacity: 0,
        duration: 0.25,
        ease: 'power3.in',
        onComplete: () => gsap.set(el, { display: 'none' }),
      })
    }
    setOpen(v => !v)
  }

  return (
    <div ref={rowRef} className="border-b border-[#1e1e2e]">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between gap-4 py-5 text-left focus-visible:outline-none"
        aria-expanded={open}
      >
        <span className={`text-[15px] font-medium leading-snug transition-colors ${open ? 'text-[#4a8af4]' : 'text-[#8a8a9a]'}`}>
          {item.q}
        </span>
        <svg
          viewBox="0 0 16 16"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          className="shrink-0 text-[#555566] transition-transform duration-200"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}
        >
          <polyline points="6,3 11,8 6,13" />
        </svg>
      </button>

      <div ref={answerRef} style={{ display: 'none', overflow: 'hidden' }}>
        {typeof item.a === 'string' ? (
          <p className="pb-5 text-[14px] text-[#8a8a9a] leading-relaxed max-w-2xl">
            {item.a}
          </p>
        ) : (
          <p className="pb-5 text-[14px] text-[#8a8a9a] leading-relaxed max-w-2xl">
            {item.a}
          </p>
        )}
      </div>
    </div>
  )
}

export function FAQ() {
  return (
    <section className="py-[80px] sm:py-[160px] border-t border-[#1e1e2e]/40">
      <div className="mx-auto max-w-3xl px-5 sm:px-8">

        <div className="mb-10 text-center">
          <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-4">
            FAQ
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-[-0.03em]">
            Frequently asked questions
          </h2>
        </div>

        <div>
          {FAQS.map((item, i) => (
            <AccordionItem key={item.q} item={item} index={i} />
          ))}
        </div>

      </div>
    </section>
  )
}
