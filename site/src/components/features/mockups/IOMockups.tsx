import { MockupWindow } from '../MockupWindow'

export function SessionReportMockup() {
  const checks = [
    '0 bytes written to disk',
    '0 credentials stored',
    '0 files created',
    '0 network requests logged',
    'Session ends when process exits',
  ]
  return (
    <MockupWindow title="Session report">
      <div className="p-3 space-y-1.5">
        {checks.map(text => (
          <div key={text} className="flex items-center gap-2">
            <span className="text-[#2dd4a0] shrink-0">✓</span>
            <span className="text-[#8a8a9a]">{text}</span>
          </div>
        ))}
        <div className="mt-2 pt-2 border-t border-[#1e1e2e] text-[#555566] text-[10px]">
          Verified at process exit
        </div>
      </div>
    </MockupWindow>
  )
}

export function ExportMockup() {
  const items = [
    { icon: '📄', label: 'Export as CSV',           active: false },
    { icon: '📋', label: 'Export as JSON',          active: true  },
    { icon: '📊', label: 'Export as Excel (.xlsx)', active: false },
  ]
  return (
    <MockupWindow title="Export results">
      <div className="p-2 space-y-0.5">
        {items.map(item => (
          <div
            key={item.label}
            className={`flex items-center gap-2 px-2.5 py-2 rounded text-[11px] ${
              item.active ? 'bg-[#4a8af4]/15 text-[#4a8af4]' : 'text-[#8a8a9a]'
            }`}
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span>{item.label}</span>
            {item.active && <span className="ml-auto text-[#4a8af4]/60 text-[10px]">↩ Enter</span>}
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}

export function CopyMockup() {
  return (
    <MockupWindow title="products">
      <div className="relative">
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18]">
          <div className="px-2.5 py-1.5 text-[#555566] flex-1">name</div>
          <div className="px-2.5 py-1.5 text-[#555566] w-20">price</div>
        </div>
        <div className="flex border-b border-[#1e1e2e]/40 bg-[#4a8af4]/[0.06]">
          <div className="px-2.5 py-1.5 text-[#ededf0] flex-1">Acme Widget Pro</div>
          <div className="px-2.5 py-1.5 text-[#2dd4a0] w-20">$129.00</div>
        </div>
        <div className="flex border-b border-[#1e1e2e]/40">
          <div className="px-2.5 py-1.5 text-[#8a8a9a] flex-1">Basic Pack</div>
          <div className="px-2.5 py-1.5 text-[#2dd4a0] w-20">$49.00</div>
        </div>
        <div className="absolute top-7 left-4 bg-[#111118] border border-[#1e1e2e] rounded-md py-1 w-40 z-10 text-[11px]">
          <div className="px-3 py-1.5 text-[#ededf0]">Copy cell</div>
          <div className="px-3 py-1.5 text-[#ededf0]">Copy row as JSON</div>
          <div className="px-3 py-1.5 text-[#ededf0]">Copy row as CSV</div>
          <div className="border-t border-[#1e1e2e] my-1" />
          <div className="px-3 py-1.5 text-[#555566]">Select row</div>
        </div>
        <div className="h-16" />
      </div>
    </MockupWindow>
  )
}

export function ImportMockup() {
  return (
    <MockupWindow title="Import into users">
      <div className="p-3">
        <div className="border border-dashed border-[#4a8af4]/25 rounded-lg bg-[#4a8af4]/[0.03] px-3 py-4 text-center mb-3">
          <div className="text-[#555566] mb-1">Drop CSV or JSON here</div>
          <div className="text-[#555566]/70 text-[10px]">or click to browse</div>
        </div>
        <div className="flex items-center gap-2 bg-[#0e0e18] border border-[#1e1e2e] rounded px-2.5 py-2">
          <span className="text-[#555566]">📄</span>
          <div className="flex-1">
            <div className="text-[#ededf0]">users_import.csv</div>
            <div className="text-[#555566] text-[10px]">47 rows · 3 columns</div>
          </div>
          <span className="text-[#2dd4a0]">✓</span>
        </div>
      </div>
    </MockupWindow>
  )
}
