import { useState, useEffect, useRef } from 'react'
import { gsap } from 'gsap'

const FAKE_PASSWORD = 'h8Kp$mQr2vXw9Ln!'

const LIFECYCLE_STEPS = [
  { label: 'Parsed in process memory',    color: 'text-[#4a8af4]'  },
  { label: 'Passed to Knex driver pool',  color: 'text-[#4a8af4]'  },
  { label: 'TLS connection established',  color: 'text-[#8a8a9a]'  },
  { label: 'Query executed',              color: 'text-[#8a8a9a]'  },
  { label: 'Process exits',              color: 'text-[#555566]'  },
  { label: 'Password gone',              color: 'text-[#2dd4a0]'  },
]

const SCRAMBLE_CHARS = '!@#$%^&*?><:;[]{}~'

const COMPETITORS = [
  {
    tool: 'DBeaver',
    storage: 'credentials-config.json',
    issue: 'Encrypted with a hardcoded AES key published in the source repository.',
    kind: 'bad',
  },
  {
    tool: 'DataGrip',
    storage: 'OS keychain',
    issue: 'Mandatory telemetry unless you pay for a commercial license.',
    kind: 'warn',
  },
  {
    tool: 'TablePlus',
    storage: 'Claims OS keychain',
    issue: 'Closed-source; the keychain claim is unverifiable.',
    kind: 'warn',
  },
  {
    tool: 'pgAdmin',
    storage: 'OS keystore (since v7.2)',
    issue: 'Older versions stored master key in the same SQLite database as credentials.',
    kind: 'warn',
  },
  {
    tool: 'Beekeeper Studio',
    storage: 'AES in SQLite',
    issue: 'Key is stored on the filesystem alongside the encrypted database.',
    kind: 'bad',
  },
  {
    tool: 'dbpeek',
    storage: 'Nothing stored',
    issue: 'Process memory only. Nothing touches disk.',
    kind: 'good',
  },
]

// ─── Typewriter + lifecycle steps ────────────────────────────────────────────

function TypewriterSection() {
  const [charCount, setCharCount] = useState(0)
  const [stepCount, setStepCount] = useState(0)
  const [started, setStarted] = useState(false)
  const [scrambled, setScrambled] = useState<string | null>(null)

  const ref = useRef<HTMLDivElement>(null)
  const stepsRef = useRef<HTMLDivElement>(null)

  // Kick off when section enters viewport
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.to({}, {
        scrollTrigger: {
          trigger: ref.current,
          start: 'top 75%',
          onEnter: () => setStarted(true),
          once: true,
        },
      })
    }, ref)

    return () => ctx.revert()
  }, [])

  // Typewriter character-by-character
  useEffect(() => {
    if (!started) return
    if (charCount < FAKE_PASSWORD.length) {
      const t = setTimeout(() => setCharCount(n => n + 1), 80)
      return () => clearTimeout(t)
    }
    if (stepCount < LIFECYCLE_STEPS.length) {
      const t = setTimeout(() => setStepCount(n => n + 1), 380)
      return () => clearTimeout(t)
    }
  }, [started, charCount, stepCount])

  // After all steps appear, scramble + dissolve the password
  useEffect(() => {
    if (stepCount < LIFECYCLE_STEPS.length) return
    const password = FAKE_PASSWORD
    let frame = 0
    const totalFrames = password.length * 3
    const interval = setInterval(() => {
      frame++
      const progress = frame / totalFrames
      const newPass = password
        .split('')
        .map((ch, i) => {
          const charProgress = 1 - Math.max(0, (i / password.length - progress * 0.5) * 2)
          if (charProgress <= 0) return ch
          if (charProgress < 0.5) return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
          return ' '
        })
        .join('')
      setScrambled(newPass)
      if (frame >= totalFrames) clearInterval(interval)
    }, 60)
    return () => clearInterval(interval)
  }, [stepCount])

  const visiblePassword = scrambled ?? FAKE_PASSWORD.slice(0, charCount)
  const isTyping = charCount < FAKE_PASSWORD.length

  return (
    <div ref={ref} className="bg-[#111118] rounded-xl border border-[#1e1e2e] p-5 font-mono text-[13px] max-w-lg mx-auto">
      <div className="flex items-center gap-2 mb-4 text-[#555566] text-[12px]">
        <span className="text-[#2dd4a0]">●</span>
        <span>bash — dbpeek process</span>
      </div>

      <div className="mb-4">
        <span className="text-[#4a8af4]">$ </span>
        <span className="text-[#8a8a9a]">npx dbpeek </span>
        <span className="text-[#2dd4a0]">"postgres://alice:</span>
        <span className={`text-[#2dd4a0] ${scrambled ? 'opacity-60' : ''}`}>{visiblePassword}</span>
        {isTyping && (
          <span className="inline-block w-[2px] h-[1em] bg-[#2dd4a0] ml-px align-middle animate-pulse" />
        )}
        {!isTyping && charCount >= FAKE_PASSWORD.length && !scrambled && (
          <span className="text-[#2dd4a0]">@prod.db.internal:5432/app"</span>
        )}
      </div>

      {/* Lifecycle steps with CSS connector line */}
      <div ref={stepsRef} className="relative border-t border-[#1e1e2e] pt-4">
        {/* Vertical connector — grows as steps appear */}
        {stepCount > 1 && (
          <div
            className="absolute left-[5px] top-5 w-px bg-[#1e1e2e]"
            style={{
              height: `${(stepCount - 1) * 28}px`,
              transition: 'height 0.38s ease',
            }}
            aria-hidden="true"
          />
        )}

        <div className="space-y-2">
          {LIFECYCLE_STEPS.slice(0, stepCount).map((step, i) => (
            <div
              key={step.label}
              className="flex items-center gap-3 text-[12px]"
              style={{
                opacity: 0,
                animation: 'fadeSlideIn 0.3s ease forwards',
              }}
            >
              <span
                className={`w-[6px] h-[6px] rounded-full shrink-0 relative z-10 ${
                  i === LIFECYCLE_STEPS.length - 1
                    ? 'bg-[#2dd4a0]'
                    : 'bg-[#1e1e2e] border border-[#555566]'
                }`}
              />
              <span className={step.color}>{step.label}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}

// ─── Competitor table ─────────────────────────────────────────────────────────

function ComparisonTable() {
  const tableRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      const rows = tableRef.current!.querySelectorAll<HTMLElement>('tbody tr')

      gsap.from(rows, {
        x: -30,
        opacity: 0,
        duration: 0.5,
        stagger: 0.07,
        ease: 'power3.out',
        scrollTrigger: {
          trigger: tableRef.current,
          start: 'top 80%',
          once: true,
        },
      })
    }, tableRef)

    return () => ctx.revert()
  }, [])

  return (
    <div ref={tableRef} className="mt-12 overflow-x-auto rounded-xl border border-[#1e1e2e]">
      <table className="w-full text-[13px] border-collapse">
        <thead>
          <tr className="border-b border-[#1e1e2e] bg-[#111118]">
            <th className="text-left px-4 py-3 text-[#555566] font-medium">Tool</th>
            <th className="text-left px-4 py-3 text-[#555566] font-medium">Credential storage</th>
            <th className="text-left px-4 py-3 text-[#555566] font-medium">Issue</th>
          </tr>
        </thead>
        <tbody>
          {COMPETITORS.map((c) => (
            <tr
              key={c.tool}
              className={[
                'border-b border-[#1e1e2e]/60 last:border-0',
                c.kind === 'good' ? 'border-l-2 border-l-[#4a8af4]' : '',
              ].join(' ')}
            >
              <td className={`px-4 py-3 font-mono ${c.kind === 'good' ? 'text-[#ededf0] font-semibold' : 'text-[#8a8a9a]'}`}>
                {c.tool}
              </td>
              <td className={`px-4 py-3 ${
                c.kind === 'bad'  ? 'text-[#e84c4c]' :
                c.kind === 'good' ? 'text-[#4a8af4]' :
                'text-[#8a8a9a]'
              }`}>
                {c.storage}
              </td>
              <td className="px-4 py-3 text-[#555566]">
                {c.issue}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function Privacy() {
  const headingRef = useRef<HTMLDivElement>(null)

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
    }, headingRef)

    return () => ctx.revert()
  }, [])

  return (
    <section className="py-[80px] sm:py-[160px] border-t border-[#1e1e2e]/40">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">

        <div ref={headingRef} className="text-center mb-14">
          <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-5">
            Privacy
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-[-0.03em] mb-4">
            Your password lives in RAM.
            <br />
            <span className="text-[#8a8a9a]">Nowhere else.</span>
          </h2>
          <p className="text-[#8a8a9a] text-lg max-w-xl mx-auto leading-relaxed">
            Every other database tool writes something to disk. dbpeek is a process that
            opens, does its job, and disappears. Nothing persists.
          </p>
        </div>

        <TypewriterSection />

        <div className="mt-16 mb-2">
          <h3 className="text-xl font-bold text-white tracking-[-0.02em] mb-2">How other tools handle credentials</h3>
          <p className="text-[#555566] text-[14px]">We read the source code so you don&apos;t have to.</p>
        </div>

        <ComparisonTable />

      </div>
    </section>
  )
}
