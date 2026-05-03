interface MockupWindowProps {
  children: React.ReactNode
  title?: React.ReactNode
}

export function MockupWindow({ children, title }: MockupWindowProps) {
  return (
    <div className="rounded-lg overflow-hidden border border-[#1e1e2e] bg-[#111118] text-[11px] font-mono">
      <div className="flex items-center gap-1.5 px-3 py-2.5 bg-[#0e0e18] border-b border-[#1e1e2e]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        {title && <span className="ml-2 text-[#555566] text-[10px]">{title}</span>}
      </div>
      {children}
    </div>
  )
}
