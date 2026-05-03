import type { FeatureDef } from './featureData'

interface FeatureRowProps {
  feature: FeatureDef
  index: number
}

export function FeatureRow({ feature, index }: FeatureRowProps) {
  const textLeft = index % 2 === 0

  const textBlock = (
    <div className="flex flex-col justify-center">
      <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-4">
        {feature.label}
      </div>
      <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-[-0.03em] leading-snug mb-5 whitespace-pre-line">
        {feature.heading}
      </h3>
      <p className="text-[15px] text-[#8a8a9a] leading-relaxed mb-6">
        {feature.description}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {feature.tags.map(tag => (
          <span
            key={tag}
            className="px-2 py-0.5 rounded bg-white/[0.04] border border-[#1e1e2e] text-[11px] text-[#555566] font-mono"
          >
            {tag}
          </span>
        ))}
      </div>
    </div>
  )

  const mockupBlock = (
    <div className="flex items-center justify-center">
      <div className="w-full max-w-sm">
        {feature.mockup}
      </div>
    </div>
  )

  return (
    <div className="py-[60px] sm:py-[80px] border-b border-[#1e1e2e]/40 last:border-0">
      <div className="mx-auto max-w-[1100px] px-5 sm:px-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-16 items-center">
          {textLeft ? textBlock : mockupBlock}
          {textLeft ? mockupBlock : textBlock}
        </div>
      </div>
    </div>
  )
}
