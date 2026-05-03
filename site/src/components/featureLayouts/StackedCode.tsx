interface StackedCodeProps {
  label: string
  heading: string
  description: string
  mockup: React.ReactNode
}

export function StackedCode({ label, heading, description, mockup }: StackedCodeProps) {
  return (
    <div className="py-[60px] sm:py-[80px]">
      <div className="mx-auto max-w-[800px] px-5 sm:px-8 text-center">
        <div className="text-[11px] uppercase tracking-[0.08em] font-medium text-[#4a8af4] mb-4">
          {label}
        </div>
        <h3 className="text-2xl sm:text-[32px] font-bold text-white tracking-[-0.03em] leading-snug mb-8 whitespace-pre-line">
          {heading}
        </h3>

        <div className="text-left">
          {mockup}
        </div>

        <p className="text-[15px] text-[#8a8a9a] leading-relaxed mt-7 max-w-[560px] mx-auto">
          {description}
        </p>
      </div>
    </div>
  )
}
