interface CompactItem {
  label: string
  heading: string
  description: string
  mockup: React.ReactNode
}

interface CompactPairProps {
  left: CompactItem
  right: CompactItem
}

export function CompactPair({ left, right }: CompactPairProps) {
  return (
    <div className="py-[60px] sm:py-[80px]">
      <div className="mx-auto max-w-[1100px] px-3 sm:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-16">
          {[left, right].map(item => (
            <div key={item.label} className="flex flex-col">
              <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-3">
                {item.label}
              </div>
              <h3 className="text-[22px] sm:text-[24px] font-bold text-white tracking-[-0.03em] leading-snug mb-3 whitespace-pre-line">
                {item.heading}
              </h3>
              <p className="text-[14px] text-[#8a8a9a] leading-relaxed mb-6">
                {item.description}
              </p>
              <div className="mt-auto">
                {item.mockup}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
