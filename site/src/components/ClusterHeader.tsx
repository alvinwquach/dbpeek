interface ClusterHeaderProps {
  number: string
  shortLabel: string
  heading: string
  description: string
  pill?: string
}

export function ClusterHeader({ number, shortLabel, heading, description, pill }: ClusterHeaderProps) {
  return (
    <div className="mx-auto max-w-[700px] px-5 sm:px-8 text-center mb-[40px] sm:mb-[80px]">
      <div className="text-[11px] uppercase tracking-[0.12em] font-medium text-[#4a8af4] mb-4">
        {number} — {shortLabel}
      </div>
      <h2 className="text-[40px] sm:text-[48px] font-bold text-white tracking-[-0.03em] leading-tight mb-4">
        {heading}
      </h2>
      <p className="text-[18px] text-[#8a8a9a] max-w-[540px] mx-auto leading-relaxed">
        {description}
      </p>
      {pill && (
        <div className="mt-5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#1e1e2e] bg-white/[0.03] text-[11px] text-[#555566] font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-[#4a8af4]/60" />
          {pill}
        </div>
      )}
    </div>
  )
}
