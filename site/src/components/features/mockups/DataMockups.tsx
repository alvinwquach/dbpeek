import { MockupWindow } from '../MockupWindow'

export function ChartMockup() {
  const bars = [
    { label: 'United States',  value: 2847 },
    { label: 'Germany',        value: 1923 },
    { label: 'Japan',          value: 1832 },
    { label: 'France',         value: 1441 },
    { label: 'United Kingdom', value: 1204 },
  ]
  const max = Math.max(...bars.map(b => b.value))
  return (
    <MockupWindow title="users by country">
      <div className="p-3 space-y-2">
        {bars.map(bar => (
          <div key={bar.label} className="flex items-center gap-2">
            <div className="w-20 text-[#8a8a9a] text-right shrink-0 truncate text-[10px]">{bar.label}</div>
            <div className="h-2 rounded-sm bg-[#4a8af4]/75" style={{ width: `${(bar.value / max) * 80}px` }} />
            <div className="text-[#555566] text-[10px] shrink-0">{bar.value.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}

export function ExplainMockup() {
  return (
    <MockupWindow title="EXPLAIN ANALYZE">
      <div className="p-3 space-y-1 leading-relaxed">
        <div>
          <span className="text-[#ededf0]">Seq Scan</span>
          <span className="text-[#555566]"> on orders</span>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="h-1 rounded-sm bg-[#e84c4c]/50" style={{ width: '90px' }} />
            <span className="text-[#e84c4c] text-[10px]">cost=0..24.12</span>
          </div>
        </div>
        <div className="pl-3">
          <span className="text-[#555566] text-[10px]">Filter: (status = 'pending')</span>
        </div>
        <div className="pl-2">
          <span className="text-[#ededf0]">→ Hash Join</span>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="h-1 rounded-sm bg-yellow-500/50" style={{ width: '60px' }} />
            <span className="text-yellow-400/80 text-[10px]">cost=8.17..35.89</span>
          </div>
        </div>
        <div className="pl-4">
          <span className="text-[#ededf0]">→ Index Scan</span>
          <span className="text-[#555566]"> on users</span>
          <div className="mt-0.5 flex items-center gap-1">
            <div className="h-1 rounded-sm bg-[#2dd4a0]/50" style={{ width: '30px' }} />
            <span className="text-[#2dd4a0] text-[10px]">cost=0.15..8.27</span>
          </div>
        </div>
      </div>
    </MockupWindow>
  )
}

export function ValueViewerMockup() {
  return (
    <MockupWindow title="metadata — row 3">
      <div className="p-3 leading-relaxed">
        <div className="text-[#ededf0]">{'{'}</div>
        <div className="pl-3">
          <span className="text-[#4a8af4]">"plan"</span>
          <span className="text-[#8a8a9a]">: </span>
          <span className="text-[#2dd4a0]">"enterprise"</span>
          <span className="text-[#8a8a9a]">,</span>
        </div>
        <div className="pl-3">
          <span className="text-[#4a8af4]">"seats"</span>
          <span className="text-[#8a8a9a]">: </span>
          <span className="text-[#ededf0]">50</span>
          <span className="text-[#8a8a9a]">,</span>
        </div>
        <div className="pl-3">
          <span className="text-[#4a8af4]">"features"</span>
          <span className="text-[#8a8a9a]">: [</span>
          <span className="text-[#2dd4a0]">"sso"</span>
          <span className="text-[#8a8a9a]">, </span>
          <span className="text-[#2dd4a0]">"audit_log"</span>
          <span className="text-[#8a8a9a]">, </span>
          <span className="text-[#2dd4a0]">"custom_roles"</span>
          <span className="text-[#8a8a9a]">],</span>
        </div>
        <div className="pl-3">
          <span className="text-[#4a8af4]">"trial_ends"</span>
          <span className="text-[#8a8a9a]">: </span>
          <span className="text-[#555566]">null</span>
        </div>
        <div className="text-[#ededf0]">{'}'}</div>
      </div>
    </MockupWindow>
  )
}

export function InlineEditingMockup() {
  return (
    <MockupWindow title="users">
      <div>
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18]">
          {['id', 'email', 'role'].map(col => (
            <div key={col} className="px-2.5 py-1.5 text-[#555566] font-semibold first:w-8 last:w-16 flex-1">{col}</div>
          ))}
        </div>
        <div className="flex border-b border-[#1e1e2e]/40">
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-8">1</div>
          <div className="px-2.5 py-1.5 text-[#ededf0] flex-1">alice@example.com</div>
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-16">admin</div>
        </div>
        <div className="flex border-b border-[#1e1e2e]/40 bg-[#4a8af4]/[0.04]">
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-8">2</div>
          <div className="px-1.5 py-1 flex-1 border border-[#4a8af4]/40 rounded bg-[#4a8af4]/10">
            <span className="text-[#4a8af4]">bob@new-domain.com</span>
            <span className="border-r border-[#4a8af4] ml-px animate-pulse" />
          </div>
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-16">user</div>
        </div>
        <div className="flex">
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-8">3</div>
          <div className="px-2.5 py-1.5 text-[#ededf0] flex-1">carol@example.com</div>
          <div className="px-2.5 py-1.5 text-[#8a8a9a] w-16">user</div>
        </div>
        <div className="border-t border-[#1e1e2e] px-2.5 py-2 bg-[#0e0e18]">
          <span className="text-[#4a8af4]">UPDATE</span>
          <span className="text-[#8a8a9a]"> users </span>
          <span className="text-[#4a8af4]">SET</span>
          <span className="text-[#8a8a9a]"> email = </span>
          <span className="text-[#2dd4a0]">'bob@new-domain.com'</span>
          <span className="text-[#4a8af4]"> WHERE</span>
          <span className="text-[#8a8a9a]"> id = 2;</span>
        </div>
      </div>
    </MockupWindow>
  )
}

export function DataDiffMockup() {
  const rows = [
    { id: 1, staging: 'role: admin',  prod: 'role: admin',    status: 'same'    },
    { id: 2, staging: 'email: new@…', prod: '—',              status: 'added'   },
    { id: 3, staging: 'plan: pro',    prod: 'plan: free',     status: 'changed' },
    { id: 4, staging: '—',            prod: 'verified: true', status: 'removed' },
  ]
  const stagingColor = (s: string) =>
    s === 'added'   ? 'text-[#2dd4a0]' :
    s === 'removed' ? 'text-[#555566]' :
    s === 'changed' ? 'text-[#4a8af4]' : 'text-[#8a8a9a]'
  const prodColor = (s: string) =>
    s === 'added'   ? 'text-[#555566]' :
    s === 'removed' ? 'text-[#e84c4c]' :
    s === 'changed' ? 'text-[#4a8af4]' : 'text-[#8a8a9a]'

  return (
    <MockupWindow title="data diff">
      <div className="text-[10px]">
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18]">
          <div className="w-8 px-2 py-1.5 text-[#555566]">id</div>
          <div className="flex-1 px-2 py-1.5 text-[#555566] border-r border-[#1e1e2e]">staging</div>
          <div className="flex-1 px-2 py-1.5 text-[#555566]">production</div>
        </div>
        {rows.map(row => (
          <div key={row.id} className={`flex border-b border-[#1e1e2e]/40 ${
            row.status === 'added'   ? 'bg-[#2dd4a0]/[0.06]' :
            row.status === 'removed' ? 'bg-[#e84c4c]/[0.06]' :
            row.status === 'changed' ? 'bg-[#4a8af4]/[0.04]' : ''
          }`}>
            <div className="w-8 px-2 py-1.5 text-[#555566]">{row.id}</div>
            <div className={`flex-1 px-2 py-1.5 border-r border-[#1e1e2e] ${stagingColor(row.status)}`}>{row.staging}</div>
            <div className={`flex-1 px-2 py-1.5 ${prodColor(row.status)}`}>{row.prod}</div>
          </div>
        ))}
        <div className="px-2 py-1.5 flex gap-3">
          <span className="text-[#2dd4a0]">+ added</span>
          <span className="text-[#e84c4c]">- removed</span>
          <span className="text-[#4a8af4]">~ changed</span>
        </div>
      </div>
    </MockupWindow>
  )
}

export function FilterMockup() {
  return (
    <MockupWindow title="users">
      <div>
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18]">
          <div className="px-2.5 py-1.5 text-[#555566] w-24 shrink-0">name</div>
          <div className="px-2.5 py-1.5 text-[#555566] flex-1">email</div>
          <div className="px-1.5 py-1 w-20 shrink-0">
            <div className="flex items-center gap-1 border border-[#4a8af4]/40 rounded px-1.5 bg-[#4a8af4]/10">
              <span className="text-[#4a8af4] text-[9px]">▼</span>
              <span className="text-[#4a8af4] text-[10px]">admin</span>
            </div>
          </div>
        </div>
        {[['Alice Chen', 'alice@…', 'admin'], ['Dan Park', 'dan@…', 'admin']].map(([n, e, r]) => (
          <div key={n} className="flex border-b border-[#1e1e2e]/40">
            <div className="px-2.5 py-1.5 text-[#ededf0] w-24 shrink-0 truncate">{n}</div>
            <div className="px-2.5 py-1.5 text-[#555566] flex-1 truncate">{e}</div>
            <div className="px-2.5 py-1.5 text-[#4a8af4] w-20 shrink-0">{r}</div>
          </div>
        ))}
        <div className="px-2.5 py-1.5 text-[#555566] text-[10px]">2 of 342 rows</div>
      </div>
    </MockupWindow>
  )
}
