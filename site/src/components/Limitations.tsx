import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'

const LIMITATIONS = [
  {
    title: 'Save queries between sessions',
    description: 'Query history is in-memory only. Use git to version SQL files.',
  },
  {
    title: 'Sync across devices',
    description: 'It\'s a local tool. There is no cloud, no sync, no account.',
  },
  {
    title: 'Manage team permissions',
    description: 'Single-user by design. For team workflows, use a different tool.',
  },
  {
    title: 'Replace your migration tool',
    description: 'For schema changes, use Drizzle, Prisma, Knex, or Flyway.',
  },
  {
    title: 'Generate SQL with AI',
    description: 'The privacy model forbids sending queries to any external service.',
  },
  {
    title: 'Connect to NoSQL databases',
    description: 'MongoDB, Redis, DynamoDB are out of scope. SQL only.',
  },
]

export function Limitations() {
  const headingRef = useRef<HTMLDivElement>(null)
  const itemsRef = useRef<HTMLDivElement>(null)

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

      const items = itemsRef.current!.querySelectorAll<HTMLElement>('.limitation-item')
      gsap.from(items, {
        y: 16,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: itemsRef.current,
          start: 'top 80%',
          once: true,
        },
      })
    })

    return () => ctx.revert()
  }, [])

  return (
    <section className="border-t border-[#1e1e2e]/40 py-[100px] sm:py-[200px]">
      <div className="mx-auto max-w-[900px] px-5 sm:px-8">

        <div ref={headingRef} className="text-center mb-[40px] sm:mb-[80px]">
          <div className="text-[11px] uppercase font-medium text-[#4a8af4] mb-5" style={{ letterSpacing: '0.12em' }}>
            04 — SCOPE
          </div>
          <h2 className="text-[32px] sm:text-[48px] font-bold text-white leading-tight mb-4" style={{ letterSpacing: '-0.03em' }}>
            What dbpeek doesn't do
          </h2>
          <p className="text-[18px] text-[#8a8a9a] mx-auto leading-relaxed" style={{ maxWidth: '540px' }}>
            Knowing what a tool isn't is as important as knowing what it is.
          </p>
        </div>

        <div
          ref={itemsRef}
          className="grid grid-cols-1 sm:grid-cols-2"
          style={{ columnGap: '48px' }}
        >
          {LIMITATIONS.map((item) => (
            <div
              key={item.title}
              className="limitation-item flex gap-3"
              style={{ marginBottom: '24px' }}
            >
              <span className="text-[#4a8af4] text-[18px] leading-none shrink-0 mt-[2px]">—</span>
              <div>
                <p className="text-white text-[16px] font-semibold leading-snug mb-1">{item.title}</p>
                <p className="text-[#8a8a9a] text-[14px] leading-relaxed" style={{ maxWidth: '380px' }}>
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
