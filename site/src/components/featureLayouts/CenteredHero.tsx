interface CenteredHeroProps {
  label: string
  heading: string
  description: string
  tags?: string[]
  mockup: React.ReactNode
  mockupMaxWidth?: number
}

export function CenteredHero({ label, heading, description, tags, mockup, mockupMaxWidth = 860 }: CenteredHeroProps) {
  return (
    <div className="py-[80px] sm:py-[100px] bg-[#0c0c12] border-y border-[#1a1a24]">
      <div className="mx-auto px-3 sm:px-8">
        <div className="text-center mb-8">
          <div className="text-[11px] uppercase tracking-[0.12em] font-medium text-[#4a8af4] mb-3">
            {label}
          </div>
        </div>

        <div className="mx-auto w-full" style={{ maxWidth: `${mockupMaxWidth}px` }}>
          {mockup}
        </div>

        <div className="text-center mt-10 mx-auto max-w-[600px]">
          <h3 className="text-[28px] sm:text-[36px] font-bold text-white tracking-[-0.03em] leading-tight mb-4 whitespace-pre-line">
            {heading}
          </h3>
          <p className="text-[16px] text-[#8a8a9a] leading-relaxed mb-5">
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
      </div>
    </div>
  )
}
