import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

const WITHOUT_STEPS = [
  'Download a 150 MB installer',
  'Create an account or accept a license',
  'Configure connection in GUI settings',
  'Save credentials to an encrypted file',
  'Accept telemetry terms (or pay to disable)',
  'Finally run your query',
]

const WITH_STEPS = [
  { mono: true,  text: 'npx dbpeek "postgres://…"' },
  { mono: false, text: 'Done.' },
]

const CLI_LIMITATIONS = [
  'No visual schema browsing',
  'No EXPLAIN plan visualization',
  'No column-level statistics',
  'No multi-tab queries',
  'No CSV/JSON/Excel export',
  'Different syntax for every database',
]

const DBPEEK_FEATURES = [
  'Visual schema tree with PK/FK badges',
  'Color-coded EXPLAIN cost trees',
  'Distinct counts, null %, top values per column',
  'Tabbed queries with independent state',
  'One-click CSV, JSON, and Excel export',
  'Same UI for PostgreSQL, MySQL, SQLite, and MSSQL',
]

const NO_CRUFT_ITEMS = [
  'No installer',
  'No account',
  'No stored credentials',
  'No telemetry',
]

export function Compare() {
  const withoutRef = useRef<HTMLDivElement>(null)
  const withRef    = useRef<HTMLDivElement>(null)
  const headingRef = useRef<HTMLDivElement>(null)
  const psqlHeadingRef = useRef<HTMLDivElement>(null)
  const cliColumnRef = useRef<HTMLDivElement>(null)
  const dbpeekColumnRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headingRef.current, {
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: headingRef.current,
          start: 'top 80%',
          once: true,
        },
      })

      // "Without dbpeek" — steps stack in slowly, one by one
      const withoutItems = withoutRef.current!.querySelectorAll<HTMLElement>('.compare-step')
      gsap.from(withoutItems, {
        x: -30,
        opacity: 0,
        duration: 0.4,
        stagger: 0.15,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: withoutRef.current,
          start: 'top 78%',
          once: true,
        },
      })

      // "With dbpeek" — slams in fast with overshoot, after without steps finish
      const withItems = withRef.current!.querySelectorAll<HTMLElement>('.compare-step')
      gsap.from(withItems, {
        x: 40,
        opacity: 0,
        duration: 0.2,
        ease: 'back.out(1.7)',
        stagger: 0.05,
        scrollTrigger: {
          trigger: withRef.current,
          start: 'top 78%',
          once: true,
        },
        delay: WITHOUT_STEPS.length * 0.15 + 0.2,
      })

      // Psql section heading fades up on scroll
      gsap.from(psqlHeadingRef.current, {
        y: 20,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: psqlHeadingRef.current,
          start: 'top 80%',
          once: true,
        },
      })

      // CLI column slides in from left
      gsap.from(cliColumnRef.current, {
        x: -30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: cliColumnRef.current,
          start: 'top 78%',
          once: true,
        },
      })

      // dbpeek column slides in from right with delay
      gsap.from(dbpeekColumnRef.current, {
        x: 30,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        delay: 0.2,
        scrollTrigger: {
          trigger: dbpeekColumnRef.current,
          start: 'top 78%',
          once: true,
        },
      })
    })

    return () => ctx.revert()
  }, [])

  return (
    <section className="py-[80px] sm:py-[160px] border-t border-[#1e1e2e]/40">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">

        <div ref={headingRef} className="mb-14 text-center">
          <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-4">
            Compare
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-[-0.03em] mb-3">
            Skip the setup entirely
          </h2>
          <p className="text-[#8a8a9a] text-lg max-w-xl mx-auto">
            Other tools ask you to install, configure, and trust them with your credentials. dbpeek asks for nothing.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Without dbpeek */}
          <div ref={withoutRef} className="rounded-2xl bg-[#111118] border border-[#1e1e2e] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#1e1e2e]">
              <div className="flex items-center gap-2">
                <span className="text-[#e84c4c]">✗</span>
                <h3 className="font-semibold text-[#ededf0]">Without dbpeek</h3>
              </div>
              <p className="text-[13px] text-[#555566] mt-0.5">The traditional database tool experience</p>
            </div>
            <div className="px-6 py-5">
              {WITHOUT_STEPS.map((text, i) => (
                <div key={i} className="compare-step flex items-start gap-4 py-3 border-b border-[#1e1e2e]/40 last:border-0">
                  <div className="w-6 h-6 rounded-full bg-[#e84c4c]/[0.08] border border-[#e84c4c]/20 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[#e84c4c]/50 text-[10px] font-mono font-semibold">{i + 1}</span>
                  </div>
                  <p className="text-[14px] text-[#8a8a9a] leading-snug pt-0.5">{text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* With dbpeek */}
          <div ref={withRef} className="rounded-2xl bg-[#111118] border border-[#4a8af4]/20 overflow-hidden">
            <div className="px-6 py-4 border-b border-[#4a8af4]/15">
              <div className="flex items-center gap-2">
                <span className="text-[#2dd4a0]">✓</span>
                <h3 className="font-semibold text-[#ededf0]">With dbpeek</h3>
              </div>
              <p className="text-[13px] text-[#555566] mt-0.5">One command and you're in</p>
            </div>
            <div className="px-6 py-5">
              {WITH_STEPS.map((step, i) => (
                <div key={i} className="compare-step flex items-start gap-4 py-3 border-b border-[#1e1e2e]/40 last:border-0">
                  <div className="w-6 h-6 rounded-full bg-[#2dd4a0]/[0.10] border border-[#2dd4a0]/25 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[#2dd4a0] text-[10px] font-semibold">{i + 1}</span>
                  </div>
                  {step.mono ? (
                    <code className="text-[13px] text-[#2dd4a0] font-mono pt-0.5 leading-snug">{step.text}</code>
                  ) : (
                    <p className="text-[14px] text-[#ededf0] pt-0.5 leading-snug font-semibold">{step.text}</p>
                  )}
                </div>
              ))}

              <div className="pt-5 flex flex-col gap-3 text-[13px] text-[#555566]">
                {NO_CRUFT_ITEMS.map(item => (
                  <div key={item} className="flex items-center gap-2">
                    <span className="text-[#2dd4a0]">✓</span> {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>

        {/* Psql/CLI Comparison Block */}
        <div className="mt-[60px] sm:mt-[120px]">
          <div ref={psqlHeadingRef} className="mb-8 sm:mb-16 text-center">
            <div className="text-[11px] uppercase tracking-[0.12em] font-medium text-[#4a8af4] mb-4">
              Why not just use psql?
            </div>
            <h2 className="text-4xl sm:text-5xl font-bold text-white tracking-[-0.03em] mb-4">
              psql is great. Until you're tired of typing \d+.
            </h2>
            <p className="text-[#8a8a9a] text-lg max-w-2xl mx-auto">
              Terminal SQL clients are fast for one-off queries. They're not built for exploration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-16 max-w-4xl mx-auto">
            {/* Terminal Clients */}
            <div ref={cliColumnRef}>
              <div className="text-[#ededf0] text-sm font-mono font-medium mb-8">
                psql, mysql, sqlite3, sqlcmd
              </div>
              <div className="space-y-3">
                {CLI_LIMITATIONS.map((item, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <span className="text-[#e84c4c] text-lg font-semibold leading-tight mt-0.5 flex-shrink-0">—</span>
                    <p className="text-base text-white leading-snug pt-0.5">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* dbpeek */}
            <div ref={dbpeekColumnRef}>
              <div className="text-[#4a8af4] text-sm font-mono font-semibold mb-8">
                dbpeek
              </div>
              <div className="space-y-3">
                {DBPEEK_FEATURES.map((item, i) => (
                  <div key={i} className="flex items-start gap-4">
                    <span className="text-[#2dd4a0] text-lg font-semibold leading-tight mt-0.5 flex-shrink-0">—</span>
                    <p className="text-base text-white leading-snug pt-0.5">{item}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
