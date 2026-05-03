interface FullBleedProps {
  label: string
  heading: string
  description: string
  tags?: string[]
  mockup: React.ReactNode
}

export function FullBleed({ label, heading, description, tags, mockup }: FullBleedProps) {
  return (
    <div className="py-[80px] sm:py-[140px] overflow-hidden">
      <div className="mx-auto max-w-[700px] px-5 sm:px-8 text-center mb-10">
        <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-4">
          {label}
        </div>
        <h3 className="text-2xl sm:text-[32px] font-bold text-white tracking-[-0.03em] leading-snug mb-5 whitespace-pre-line">
          {heading}
        </h3>
        <p className="text-[15px] text-[#8a8a9a] leading-relaxed mb-5">
          {description}
        </p>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 justify-center">
            {tags.map(tag => (
              <span
                key={tag}
                className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#1e1e2e] text-[11px] text-[#555566] font-mono"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-3 sm:px-8">
        <div className="mx-auto w-full">
          {mockup}
        </div>
      </div>
    </div>
  )
}
