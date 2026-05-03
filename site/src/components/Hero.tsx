import { useState, useEffect, useRef } from 'react'
import { gsap } from 'gsap'
import { SplitText } from 'gsap/SplitText'

const INSTALL_CMD = `npx dbpeek "postgres://user:pass@localhost:5432/mydb"`

const LINE_NUMBERS = [1, 2, 3, 4, 5, 6, 7]

const COLLAPSED_TABLES: [string, string][] = [
  ['orders',    '1,204'],
  ['products',  '88'],
  ['sessions',  '9,312'],
  ['audit_log', '24,891'],
]

const RESULT_ROWS: [string, string, string][] = [
  ['alice@example.com',   '47', '$12,840.00'],
  ['bob@acme.io',         '31', '$9,203.50'],
  ['carol@startup.dev',   '28', '$7,114.20'],
  ['dan@enterprise.com',  '24', '$6,890.00'],
  ['eve@corp.org',        '19', '$4,522.80'],
  ['frank@example.net',   '15', '$3,301.00'],
]

function HeroMockup({
  mockupRef,
  sidebarRef,
  editorRef,
  resultsRef,
}: {
  mockupRef: React.RefObject<HTMLDivElement | null>
  sidebarRef: React.RefObject<HTMLDivElement | null>
  editorRef: React.RefObject<HTMLDivElement | null>
  resultsRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={mockupRef}
      className="text-left overflow-hidden border border-[#1e1e2e] rounded-[8px] mx-auto min-w-min"
      style={{
        willChange: 'transform',
        clipPath: 'inset(0 0% 0 0 round 8px)',
        minWidth: '600px',
        maxWidth: '1100px',
        background: '#0d0d14',
      }}
    >
      {/* Window chrome — three dots */}
      <div className="flex items-center gap-2 px-4 h-[28px] bg-[#111118] border-b border-[#1e1e2e] shrink-0">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57] shrink-0" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e] shrink-0" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840] shrink-0" />
      </div>

      {/* Main grid: sidebar | center */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: '1fr minmax(120px, 1fr)',
          gridTemplateRows: '24px 32px 1fr 20px',
          height: 'auto',
          minHeight: '300px',
          aspectRatio: '16/10',
        }}
      >
        {/* ── Tab bar (row 1, col 1–2) ── */}
        <div
          className="flex items-end gap-0 bg-[#111118] border-b border-[#1e1e2e] px-3 font-mono overflow-hidden"
          style={{ gridColumn: '1 / 3', gridRow: '1 / 2' }}
        >
          <div className="flex items-center gap-1.5 px-3 h-full border-b-2 border-[#4a8af4]" style={{ paddingBottom: '1px' }}>
            <span className="text-[11px] text-[#ededf0]">users_analysis.sql</span>
          </div>
          <div className="flex items-center px-3 h-full">
            <span className="text-[11px] text-[#555566]">orders_q4.sql</span>
          </div>
          <div className="flex items-center px-3 h-full">
            <span className="text-[11px] text-[#555566]">index_check.sql</span>
          </div>
          <div className="flex items-center px-2 h-full">
            <span className="text-[#555566] text-[14px] leading-none">+</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1 px-2 h-full">
            <button className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#2a2a3a] text-[#555566] text-[10px] font-mono hover:border-[#3a3a4a]">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="6" cy="6" r="4.5" />
                <path d="M6 3.5V6l1.5 1.5" strokeLinecap="round" />
              </svg>
              History
            </button>
          </div>
        </div>

        {/* ── Toolbar (row 2, col 1–2) ── */}
        <div
          className="flex items-center gap-2 px-3 bg-[#111118] border-b border-[#1e1e2e] font-mono overflow-hidden"
          style={{ gridColumn: '1 / 3', gridRow: '2 / 3' }}
        >
          <button className="flex items-center gap-1.5 px-3 py-1 rounded bg-[#4a8af4] text-white text-[11px] font-semibold shrink-0">
            <span>▶</span>
            <span>Run</span>
            <span className="opacity-50 text-[10px] font-normal ml-0.5">Ctrl+Enter</span>
          </button>
          <button className="px-2 py-1 rounded border border-[#2a2a3a] text-[#8a8a9a] text-[11px] hover:border-[#3a3a4a] shrink-0">
            Fmt
          </button>
          <button className="px-2 py-1 rounded border border-[#2a2a3a] text-[#8a8a9a] text-[11px] hover:border-[#3a3a4a] shrink-0">
            EXPLAIN
          </button>
          <div className="mx-2 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold text-[#2dd4a0] shrink-0"
            style={{ background: 'rgba(45,212,160,0.10)' }}>
            READ-ONLY
          </div>
          <div className="flex-1" />
          <div className="flex items-center rounded overflow-hidden border border-[#2a2a3a] shrink-0">
            <button className="px-2.5 py-1 text-[11px] bg-[#4a8af4] text-white font-medium">Table</button>
            <button className="px-2.5 py-1 text-[11px] text-[#555566] border-l border-[#2a2a3a]">Chart</button>
            <button className="px-2.5 py-1 text-[11px] text-[#555566] border-l border-[#2a2a3a]">Plan</button>
          </div>
          <button className="flex items-center gap-1 px-2.5 py-1 rounded border border-[#2a2a3a] text-[#8a8a9a] text-[11px] shrink-0">
            Export
            <span className="text-[#555566]">▾</span>
          </button>
        </div>

        {/* ── Schema sidebar (row 3, col 1) ── */}
        <div
          ref={sidebarRef}
          className="bg-[#0d0d14] border-r border-[#1e1e2e] font-mono overflow-hidden flex flex-col"
          style={{ gridColumn: '1 / 2', gridRow: '3 / 4', willChange: 'opacity' }}
        >
          <div className="px-3 pt-3 pb-2 text-[#555566] uppercase text-[11px] tracking-[0.08em] shrink-0">
            Tables
          </div>
          <div className="px-2 pb-2 shrink-0">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#111118] border border-[#1e1e2e]">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="#555566" strokeWidth="1.5">
                <circle cx="5" cy="5" r="3.5" />
                <path d="M8 8l2 2" strokeLinecap="round" />
              </svg>
              <span className="text-[11px] text-[#555566]">Search tables…</span>
            </div>
          </div>

          <div className="px-2 overflow-y-auto flex-1 pb-2">
            {/* users — expanded, active */}
            <div className="flex items-center gap-1 px-1 py-0.5 rounded">
              <span className="text-[#4a8af4] text-[11px]">▼</span>
              <span className="text-[#4a8af4] text-[11px] flex-1">users</span>
              <span className="text-[#555566] text-[10px]">342</span>
            </div>
            <div className="ml-3 space-y-px">
              <div className="flex items-center gap-1.5 px-1 py-px">
                <span className="px-1 py-px rounded text-[9px] font-bold text-[#ebab40] shrink-0"
                  style={{ background: 'rgba(235,171,64,0.15)' }}>PK</span>
                <span className="text-[#ededf0] text-[11px] flex-1">id</span>
                <span className="text-[#555566] text-[10px]">integer</span>
              </div>
              <div className="flex items-center gap-1.5 px-1 py-px">
                <span className="w-[22px] shrink-0" />
                <span className="text-[#ededf0] text-[11px] flex-1">email</span>
                <span className="text-[#555566] text-[10px]">varchar(255)</span>
              </div>
              <div className="flex items-center gap-1.5 px-1 py-px">
                <span className="w-[22px] shrink-0" />
                <span className="text-[#ededf0] text-[11px] flex-1">role</span>
                <span className="text-[#555566] text-[10px]">varchar(50)</span>
              </div>
              <div className="flex items-center gap-1.5 px-1 py-px">
                <span className="w-[22px] shrink-0" />
                <span className="text-[#ededf0] text-[11px] flex-1">created_at</span>
                <span className="text-[#555566] text-[10px]">timestamp</span>
              </div>
              <div className="flex items-center gap-1.5 px-1 py-px">
                <span className="w-[22px] shrink-0 flex items-center justify-center">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#56b6c2] shrink-0" />
                </span>
                <span className="text-[#ededf0] text-[11px] flex-1">lifetime_value</span>
                <span className="text-[#555566] text-[10px]">decimal</span>
              </div>
            </div>

            {COLLAPSED_TABLES.map(([name, count]) => (
              <div key={name} className="flex items-center gap-1 px-1 py-0.5 mt-0.5">
                <span className="text-[#555566] text-[11px]">▶</span>
                <span className="text-[#555566] text-[11px] flex-1">{name}</span>
                <span className="text-[#555566] text-[10px]">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Center column: editor + results (row 3, col 2) ── */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ gridColumn: '2 / 3', gridRow: '3 / 4' }}
        >
          {/* SQL Editor — ~55% */}
          <div
            ref={editorRef}
            className="bg-[#0d0d14] border-b border-[#1e1e2e] p-4 font-mono text-[13px] overflow-hidden shrink-0"
            style={{ willChange: 'opacity', flex: '0 0 55%' }}
          >
            <div className="flex gap-4">
              <div className="text-[#555566] text-right select-none text-[13px]" style={{ lineHeight: '1.75' }}>
                {LINE_NUMBERS.map(n => <div key={n}>{n}</div>)}
              </div>
              <div style={{ lineHeight: '1.75' }}>
                <div>
                  <span className="text-[#4a8af4]">SELECT</span>
                  <span className="text-[#ededf0]"> u.email,</span>
                </div>
                <div>
                  <span className="text-[#555566]">{'  '}</span>
                  <span className="text-[#56b6c2]">COUNT</span>
                  <span className="text-[#ededf0]">(o.id) </span>
                  <span className="text-[#4a8af4]">AS</span>
                  <span className="text-[#ededf0]"> order_count,</span>
                </div>
                <div>
                  <span className="text-[#555566]">{'  '}</span>
                  <span className="text-[#56b6c2]">SUM</span>
                  <span className="text-[#ededf0]">(o.total) </span>
                  <span className="text-[#4a8af4]">AS</span>
                  <span className="text-[#ededf0]"> revenue</span>
                </div>
                <div>
                  <span className="text-[#4a8af4]">FROM</span>
                  <span className="text-[#ededf0]"> users u</span>
                </div>
                <div>
                  <span className="text-[#4a8af4]">JOIN</span>
                  <span className="text-[#ededf0]"> orders o </span>
                  <span className="text-[#4a8af4]">ON</span>
                  <span className="text-[#ededf0]"> u.id = o.user_id</span>
                </div>
                <div>
                  <span className="text-[#4a8af4]">GROUP BY</span>
                  <span className="text-[#ededf0]"> u.email</span>
                </div>
                <div>
                  <span className="text-[#4a8af4]">ORDER BY</span>
                  <span className="text-[#ededf0]"> revenue </span>
                  <span className="text-[#4a8af4]">DESC</span>
                  <span className="text-[#ededf0]"> </span>
                  <span className="text-[#4a8af4]">LIMIT</span>
                  <span className="text-[#ebab40]"> 10</span>
                  <span className="text-[#ededf0]">;</span>
                </div>
              </div>
            </div>
          </div>

          {/* Results grid — ~45% */}
          <div
            ref={resultsRef}
            className="bg-[#0d0d14] overflow-hidden flex flex-col"
            style={{ willChange: 'opacity', flex: '1 1 45%' }}
          >
            <div className="font-mono text-[13px] flex flex-col h-full">
              <div className="flex border-b border-[#1e1e2e] bg-[#111118] shrink-0">
                <div className="px-3 py-2 text-[#8a8a9a] font-semibold" style={{ flex: '2 1 0' }}>email</div>
                <div className="px-3 py-2 text-[#8a8a9a] font-semibold text-right" style={{ flex: '1 1 0' }}>order_count</div>
                <div className="px-3 py-2 text-[#8a8a9a] font-semibold text-right" style={{ flex: '1 1 0' }}>revenue</div>
              </div>
              <div className="flex-1 overflow-hidden">
                {RESULT_ROWS.map(([email, count, rev]) => (
                  <div key={email} className="flex border-b border-[#1e1e2e]">
                    <div className="px-3 py-1.5 text-[#ededf0] truncate" style={{ flex: '2 1 0' }}>{email}</div>
                    <div className="px-3 py-1.5 text-[#ebab40] text-right" style={{ flex: '1 1 0' }}>{count}</div>
                    <div className="px-3 py-1.5 text-[#ebab40] text-right" style={{ flex: '1 1 0' }}>{rev}</div>
                  </div>
                ))}
              </div>
              <div className="px-3 py-1.5 text-[#555566] text-[11px] border-t border-[#1e1e2e] shrink-0">
                6 rows · 12ms · 1.2 KB
              </div>
            </div>
          </div>
        </div>

        {/* ── Status bar (row 4, col 1–2) ── */}
        <div
          className="flex items-center px-4 bg-[#111118] border-t border-[#1e1e2e] font-mono text-[11px] text-[#555566] gap-3 overflow-hidden"
          style={{ gridColumn: '1 / 3', gridRow: '4 / 5', height: '24px' }}
        >
          <span>postgres</span>
          <span className="text-[#2a2a3a]">|</span>
          <span>localhost:5432</span>
          <span className="text-[#2a2a3a]">|</span>
          <span>mydb</span>
          <span className="text-[#2a2a3a]">|</span>
          <span>read-only</span>
          <span className="text-[#2a2a3a]">|</span>
          <span><span className="text-[#2dd4a0]">●</span> connected</span>
        </div>
      </div>
    </div>
  )
}

export function Hero() {
  const [copied, setCopied] = useState(false)
  const [cmdText, setCmdText] = useState('')
  const [showCopy, setShowCopy] = useState(false)
  const [showCursor, setShowCursor] = useState(true)

  const headlineRef = useRef<HTMLHeadingElement>(null)
  const sublineRef = useRef<HTMLParagraphElement>(null)
  const cmdRef = useRef<HTMLDivElement>(null)
  const mockupRef = useRef<HTMLDivElement>(null)
  const sidebarRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const setCmdTextRef = setCmdText
    const setShowCursorRef = setShowCursor
    const setShowCopyRef = setShowCopy

    let typewriterTween: gsap.core.Tween | null = null

    const ctx = gsap.context(() => {
      if (!headlineRef.current) return

      const split = new SplitText(headlineRef.current, { type: 'chars' })

      gsap.from(split.chars, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: 'power4.out',
        stagger: 0.02,
        delay: 0.1,
      })

      gsap.from(sublineRef.current, {
        y: 16,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
        delay: 0.52,
      })

      gsap.from(cmdRef.current, {
        y: 14,
        opacity: 0,
        duration: 0.5,
        ease: 'power3.out',
        delay: 0.72,
        onComplete: () => {
          const state = { chars: 0 }
          typewriterTween = gsap.to(state, {
            chars: INSTALL_CMD.length,
            duration: INSTALL_CMD.length * 0.033,
            ease: 'none',
            snap: { chars: 1 },
            onUpdate() {
              setCmdTextRef(INSTALL_CMD.slice(0, Math.round(state.chars)))
            },
            onComplete() {
              setShowCursorRef(false)
              setShowCopyRef(true)
            },
          })
        },
      })

      gsap.from(mockupRef.current, {
        clipPath: 'inset(0 100% 0 0 round 8px)',
        duration: 0.9,
        ease: 'power3.out',
        delay: 1.0,
      })

      gsap.from([sidebarRef.current, editorRef.current, resultsRef.current], {
        opacity: 0,
        duration: 0.5,
        stagger: 0.12,
        ease: 'power2.out',
        delay: 1.35,
      })
    })

    return () => {
      typewriterTween?.kill()
      ctx.revert()
    }
  }, [])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_CMD)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <section className="relative pt-32 pb-20 sm:pt-40 sm:pb-28 overflow-hidden">
      <div className="relative mx-auto max-w-4xl px-4 sm:px-8 text-center">

        <h1
          ref={headlineRef}
          className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-[-0.03em] text-white leading-[1.1] mb-5"
        >
          Connect to any database
          <br />
          <span className="text-[#4a8af4]">and explore it in your browser.</span>
        </h1>

        <p
          ref={sublineRef}
          className="text-lg sm:text-xl text-[#8a8a9a] mb-10 max-w-2xl mx-auto leading-relaxed"
        >
          One command. Nothing to install. Nothing stored.
        </p>

        {/* Install command */}
        <div ref={cmdRef} className="flex justify-center">
          <div className="w-full max-w-full overflow-x-auto rounded-xl">
            <div className="inline-flex items-center bg-[#111118] border border-[#1e1e2e] rounded-xl overflow-hidden min-w-max">
              <span className="pl-4 pr-2 font-mono text-[#4a8af4] text-sm font-medium select-none">$</span>
              <code className="px-1 py-3.5 font-mono text-sm text-[#8a8a9a] select-all whitespace-nowrap pr-4 min-w-[24ch]">
                {cmdText}
                {showCursor && (
                  <span className="inline-block w-[2px] h-[1em] bg-[#4a8af4] ml-px align-middle animate-pulse" />
                )}
              </code>
              {showCopy && (
                <button
                  onClick={handleCopy}
                  aria-label="Copy install command"
                  className={[
                    'flex items-center gap-1.5 px-4 py-3.5 border-l border-[#1e1e2e]',
                    'text-[12px] font-mono font-medium transition-all duration-200',
                    copied
                      ? 'text-[#2dd4a0] bg-[#2dd4a0]/10'
                      : 'text-[#555566] hover:text-[#8a8a9a] hover:bg-white/[0.04]',
                  ].join(' ')}
                >
                  {copied ? (
                    <>
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="2,8 6,12 14,4" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="5" y="2" width="9" height="12" rx="1.5" />
                        <path d="M5 4H3a1 1 0 00-1 1v8a1 1 0 001 1h7a1 1 0 001-1v-2" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[13px] text-[#555566] text-center">
          Requires Node.js 18+ — get it at{' '}
          <a
            href="https://nodejs.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#8a8a9a] hover:underline transition-colors"
          >
            nodejs.org
          </a>
        </p>

        <p className="mb-2 text-[13px] text-[#555566] text-center">
          Or use <code className="font-mono text-[12px] text-[#8a8a9a]">pnpm dlx dbpeek</code> / <code className="font-mono text-[12px] text-[#8a8a9a]">bunx dbpeek</code>
        </p>

        <p className="mt-2 text-[12px] text-[#555566] font-mono">
          PostgreSQL · MySQL · SQLite · MSSQL
        </p>
      </div>

      {/* Product mockup — wider than the copy block */}
      <div className="mt-14 px-3 sm:px-8 overflow-x-auto">
        <HeroMockup
          mockupRef={mockupRef}
          sidebarRef={sidebarRef}
          editorRef={editorRef}
          resultsRef={resultsRef}
        />
      </div>
    </section>
  )
}
