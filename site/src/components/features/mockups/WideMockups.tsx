import { MockupWindow } from '../MockupWindow'

type Badge = 'PK' | 'FK' | null

interface ErdCol {
  badge: Badge
  name: string
  type: string
}

interface ErdTable {
  name: string
  active: boolean
  cols: ErdCol[]
}

const ERD_TABLES: ErdTable[] = [
  {
    name: 'users',
    active: true,
    cols: [
      { badge: 'PK', name: 'id',         type: 'SERIAL'      },
      { badge: null, name: 'email',       type: 'VARCHAR(255)' },
      { badge: null, name: 'role',        type: 'VARCHAR(50)' },
      { badge: null, name: 'created_at',  type: 'TIMESTAMP'   },
    ],
  },
  {
    name: 'orders',
    active: false,
    cols: [
      { badge: 'PK', name: 'id',         type: 'SERIAL'        },
      { badge: 'FK', name: 'user_id',    type: 'INTEGER'       },
      { badge: null, name: 'total',      type: 'DECIMAL(10,2)' },
      { badge: null, name: 'status',     type: 'VARCHAR(50)'   },
      { badge: null, name: 'created_at', type: 'TIMESTAMP'     },
    ],
  },
  {
    name: 'products',
    active: false,
    cols: [
      { badge: 'PK', name: 'id',    type: 'SERIAL'        },
      { badge: null, name: 'name',  type: 'VARCHAR(255)'  },
      { badge: null, name: 'price', type: 'DECIMAL(10,2)' },
      { badge: null, name: 'stock', type: 'INTEGER'       },
    ],
  },
  {
    name: 'order_items',
    active: false,
    cols: [
      { badge: 'PK', name: 'id',         type: 'SERIAL'  },
      { badge: 'FK', name: 'order_id',   type: 'INTEGER' },
      { badge: 'FK', name: 'product_id', type: 'INTEGER' },
      { badge: null, name: 'qty',        type: 'INTEGER' },
    ],
  },
  {
    name: 'sessions',
    active: false,
    cols: [
      { badge: 'PK', name: 'id',         type: 'UUID'      },
      { badge: 'FK', name: 'user_id',    type: 'INTEGER'   },
      { badge: null, name: 'token',      type: 'TEXT'      },
      { badge: null, name: 'expires_at', type: 'TIMESTAMP' },
    ],
  },
]

interface ChartBar {
  label: string
  value: number
}

const CHART_BARS: ChartBar[] = [
  { label: 'United States',  value: 2847 },
  { label: 'Germany',        value: 1923 },
  { label: 'Japan',          value: 1832 },
  { label: 'France',         value: 1441 },
  { label: 'United Kingdom', value: 1204 },
  { label: 'Canada',         value: 981  },
  { label: 'Australia',      value: 774  },
  { label: 'Netherlands',    value: 652  },
  { label: 'Brazil',         value: 543  },
  { label: 'Sweden',         value: 421  },
]

type DiffStatus = 'same' | 'added' | 'removed' | 'changed'

interface DiffRow {
  id: number
  key: string
  staging: string
  prod: string
  status: DiffStatus
}

const DIFF_ROWS: DiffRow[] = [
  { id: 1, key: 'alice@example.com',   staging: 'role: admin',          prod: 'role: admin',        status: 'same'    },
  { id: 2, key: 'bob@acme.io',         staging: 'email: bob@new-co.com', prod: '—',                  status: 'added'   },
  { id: 3, key: 'carol@startup.dev',   staging: 'plan: pro',             prod: 'plan: free',         status: 'changed' },
  { id: 4, key: 'dan@enterprise.com',  staging: 'verified: true',        prod: 'verified: false',    status: 'changed' },
  { id: 5, key: 'eve@corp.org',        staging: '—',                     prod: 'verified: true',     status: 'removed' },
  { id: 6, key: 'frank@example.net',   staging: 'role: admin',           prod: 'role: admin',        status: 'same'    },
]

const RESULTS_COLS = ['id', 'email', 'role', 'created_at', 'order_count'] as const

interface ResultRow {
  id: number
  email: string
  role: string
  created_at: string
  order_count: number
}

const RESULTS_ROWS: ResultRow[] = [
  { id: 1, email: 'alice@example.com',  role: 'admin', created_at: '2023-01-15', order_count: 47 },
  { id: 2, email: 'bob@acme.io',        role: 'user',  created_at: '2023-02-03', order_count: 31 },
  { id: 3, email: 'carol@startup.dev',  role: 'user',  created_at: '2023-02-18', order_count: 28 },
  { id: 4, email: 'dan@enterprise.com', role: 'admin', created_at: '2023-03-01', order_count: 24 },
  { id: 5, email: 'eve@corp.org',       role: 'user',  created_at: '2023-03-22', order_count: 19 },
]

// ─── Shared sub-components ────────────────────────────────────────────────────

function ErdBadge({ badge }: { badge: Badge }) {
  if (!badge) return <span className="w-[22px] shrink-0" />
  return (
    <span className={`text-[9px] border px-0.5 rounded shrink-0 ${
      badge === 'PK' ? 'text-yellow-500/70 border-yellow-500/25' : 'text-[#4a8af4]/70 border-[#4a8af4]/25'
    }`}>{badge}</span>
  )
}

function ErdTableCard({
  table,
  active = false,
}: {
  table: ErdTable
  active?: boolean
}) {
  const borderClass = active ? 'border-[#4a8af4]/40 bg-[#4a8af4]/[0.05]' : 'border-[#1e1e2e] bg-[#111118]'
  const headerClass = active ? 'border-[#4a8af4]/20 text-[#4a8af4]' : 'border-[#1e1e2e] text-[#8a8a9a]'
  const nameClass   = active ? 'text-[#ededf0]' : 'text-[#8a8a9a]'

  return (
    <div className={`border rounded-lg min-w-[160px] ${borderClass}`}>
      <div className={`px-3 py-2 border-b text-[11px] font-semibold tracking-wide ${headerClass}`}>
        {table.name}
      </div>
      <div className="px-3 py-1.5 space-y-1">
        {table.cols.map(col => (
          <div key={col.name} className="flex items-center gap-2 text-[10px]">
            <ErdBadge badge={col.badge} />
            <span className={nameClass}>{col.name}</span>
            <span className="text-[#555566] ml-auto pl-2">{col.type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ErdConnector({ count = 1 }: { count?: number }) {
  return (
    <div className={`flex flex-col ${count > 1 ? `justify-center gap-[52px]` : 'items-center'} text-[#555566] text-[10px] shrink-0 select-none`}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col items-center">
          <span>1</span><span className="text-[8px]">──────</span><span>∞</span>
        </div>
      ))}
    </div>
  )
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export function ERDWideMockup() {
  return (
    <MockupWindow title="Entity Relationship Diagram">
      <div className="p-6 overflow-x-auto">
        <div className="flex items-start gap-8 min-w-[700px]">
          <div className="flex flex-col gap-8 mt-8">
            <ErdTableCard table={ERD_TABLES[0]} active />
          </div>

          <ErdConnector count={2} />

          <div className="flex flex-col gap-6">
            {[ERD_TABLES[1], ERD_TABLES[3]].map(tbl => (
              <ErdTableCard key={tbl.name} table={tbl} />
            ))}
          </div>

          <div className="flex flex-col items-center mt-[68px] text-[#555566] text-[10px] shrink-0 select-none">
            <ErdConnector />
          </div>

          <div className="mt-[60px]">
            <ErdTableCard table={ERD_TABLES[2]} />
          </div>

          <div className="mt-4 ml-auto">
            <ErdTableCard table={ERD_TABLES[4]} />
            <div className="mt-1 text-[#555566] text-[10px] text-center">
              <span>1</span> ────── <span>∞</span>
            </div>
            <div className="text-[#555566] text-[9px] text-center">(from users)</div>
          </div>
        </div>
      </div>
    </MockupWindow>
  )
}

export function ChartWideMockup() {
  const max = Math.max(...CHART_BARS.map(b => b.value))

  return (
    <MockupWindow title="users by country — bar chart">
      <div className="px-6 py-5">
        <div className="flex items-end justify-start gap-3 h-[180px] overflow-x-auto pb-1">
          {CHART_BARS.map(bar => {
            const heightPct = (bar.value / max) * 100
            return (
              <div key={bar.label} className="flex flex-col items-center gap-2 shrink-0">
                <div className="text-[#555566] text-[9px]">{bar.value.toLocaleString()}</div>
                <div
                  className="w-10 rounded-t-sm bg-[#4a8af4]/70 transition-all"
                  style={{ height: `${(heightPct / 100) * 140}px` }}
                />
                <div className="text-[#555566] text-[9px] text-center w-12 leading-tight">{bar.label}</div>
              </div>
            )
          })}
        </div>
        <div className="mt-3 pt-3 border-t border-[#1e1e2e] flex items-center justify-between text-[10px] text-[#555566]">
          <span>Label column: <span className="text-[#8a8a9a]">country</span></span>
          <span>Value column: <span className="text-[#8a8a9a]">user_count</span></span>
          <span>10 rows</span>
        </div>
      </div>
    </MockupWindow>
  )
}

export function DataDiffWideMockup() {
  const stagingColor = (s: DiffStatus) =>
    s === 'added'   ? 'text-[#2dd4a0]' :
    s === 'removed' ? 'text-[#555566]' :
    s === 'changed' ? 'text-[#4a8af4]' : 'text-[#8a8a9a]'

  const prodColor = (s: DiffStatus) =>
    s === 'added'   ? 'text-[#555566]' :
    s === 'removed' ? 'text-[#e84c4c]' :
    s === 'changed' ? 'text-[#4a8af4]' : 'text-[#8a8a9a]'

  const rowBg = (s: DiffStatus) =>
    s === 'added'   ? 'bg-[#2dd4a0]/[0.05]' :
    s === 'removed' ? 'bg-[#e84c4c]/[0.05]' :
    s === 'changed' ? 'bg-[#4a8af4]/[0.04]' : ''

  return (
    <MockupWindow title="data diff — users">
      <div className="text-[11px]">
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18]">
          <div className="w-8 px-3 py-2 text-[#555566] shrink-0">#</div>
          <div className="w-44 px-3 py-2 text-[#555566] shrink-0">row key</div>
          <div className="flex-1 px-3 py-2 text-[#555566] border-r border-[#1e1e2e]">
            <span className="text-[#2dd4a0]/70">staging</span>
          </div>
          <div className="flex-1 px-3 py-2 text-[#555566]">
            <span className="text-[#e84c4c]/70">production</span>
          </div>
          <div className="w-24 px-3 py-2 text-[#555566] shrink-0 text-right">status</div>
        </div>
        {DIFF_ROWS.map(row => (
          <div key={row.id} className={`flex border-b border-[#1e1e2e]/40 ${rowBg(row.status)}`}>
            <div className="w-8 px-3 py-2 text-[#555566] shrink-0">{row.id}</div>
            <div className="w-44 px-3 py-2 text-[#555566] shrink-0 truncate font-mono text-[10px]">{row.key}</div>
            <div className={`flex-1 px-3 py-2 border-r border-[#1e1e2e] ${stagingColor(row.status)}`}>{row.staging}</div>
            <div className={`flex-1 px-3 py-2 ${prodColor(row.status)}`}>{row.prod}</div>
            <div className="w-24 px-3 py-2 text-right shrink-0">
              {row.status === 'same'    && <span className="text-[#555566]">same</span>}
              {row.status === 'added'   && <span className="text-[#2dd4a0]">+ added</span>}
              {row.status === 'removed' && <span className="text-[#e84c4c]">- removed</span>}
              {row.status === 'changed' && <span className="text-[#4a8af4]">~ changed</span>}
            </div>
          </div>
        ))}
        <div className="px-3 py-2 flex gap-4 text-[10px]">
          <span className="text-[#2dd4a0]">1 added</span>
          <span className="text-[#e84c4c]">1 removed</span>
          <span className="text-[#4a8af4]">2 changed</span>
          <span className="text-[#555566]">2 same</span>
          <span className="text-[#555566] ml-auto">6 total rows</span>
        </div>
      </div>
    </MockupWindow>
  )
}

export function SQLEditorWithAutocompleteMockup() {
  return (
    <MockupWindow title="query.sql">
      <div className="flex">
        <div className="w-36 shrink-0 border-r border-[#1e1e2e] bg-[#0a0a0f] p-3 text-[10px] font-mono">
          <div className="text-[#555566] uppercase tracking-widest text-[9px] mb-2">Tables</div>
          <div className="text-[#4a8af4] mb-1">▾ users</div>
          <div className="pl-3 space-y-0.5 text-[#555566] mb-2">
            <div>id</div><div>email</div><div>role</div><div>created_at</div>
          </div>
          <div className="text-[#555566]">▸ orders</div>
          <div className="text-[#555566] mt-1">▸ products</div>
          <div className="text-[#555566] mt-1">▸ sessions</div>
        </div>

        <div className="flex-1 p-4 relative">
          <div className="flex gap-4 font-mono text-[11px]">
            <div className="text-[#555566] text-right select-none leading-[1.85]">
              {[1,2,3,4,5,6].map(n => <div key={n}>{n}</div>)}
            </div>
            <div className="leading-[1.85]">
              <div>
                <span className="text-[#4a8af4]">SELECT</span>
                <span className="text-[#ededf0]"> u.email, u.</span>
                <span className="text-[#ededf0] border-r border-[#4a8af4] animate-pulse" />
              </div>
              <div className="text-[#555566]">{/* autocomplete dropdown occupies this space */}</div>
              <div>
                <span className="text-[#4a8af4]">FROM</span>
                <span className="text-[#ededf0]"> users u</span>
              </div>
              <div>
                <span className="text-[#4a8af4]">JOIN</span>
                <span className="text-[#ededf0]"> orders o </span>
                <span className="text-[#4a8af4]">ON</span>
                <span className="text-[#ededf0]"> u.id = o.user_id</span>
              </div>
              <div>
                <span className="text-[#4a8af4]">WHERE</span>
                <span className="text-[#ededf0]"> u.role = </span>
                <span className="text-[#2dd4a0]">'admin'</span>
              </div>
              <div>
                <span className="text-[#4a8af4]">LIMIT</span>
                <span className="text-[#ededf0]"> 50;</span>
              </div>
            </div>
          </div>

          <div className="absolute top-[38px] left-[72px] bg-[#111118] border border-[#1e1e2e] rounded shadow-xl w-44 z-10 text-[10px] font-mono overflow-hidden">
            <div className="px-2.5 py-1 bg-[#4a8af4]/15 text-[#ededf0] flex items-center gap-2">
              <span className="text-[#555566] text-[9px]">col</span>
              <span>role</span>
              <span className="ml-auto text-[#555566]">VARCHAR</span>
            </div>
            <div className="px-2.5 py-1 text-[#8a8a9a] flex items-center gap-2">
              <span className="text-[#555566] text-[9px]">col</span>
              <span>created_at</span>
              <span className="ml-auto text-[#555566]">TS</span>
            </div>
            <div className="px-2.5 py-1 text-[#8a8a9a] flex items-center gap-2">
              <span className="text-[#555566] text-[9px]">col</span>
              <span>email</span>
              <span className="ml-auto text-[#555566]">VARCHAR</span>
            </div>
            <div className="px-2.5 py-1 text-[#8a8a9a] flex items-center gap-2">
              <span className="text-[#555566] text-[9px]">col</span>
              <span>id</span>
              <span className="ml-auto text-[#555566]">INT</span>
            </div>
          </div>
        </div>
      </div>
    </MockupWindow>
  )
}

export function ResultsGridMockup() {
  return (
    <MockupWindow title="users — 342 rows">
      <div className="text-[10px] font-mono overflow-x-auto">
        <div className="flex border-b border-[#1e1e2e] bg-[#0e0e18] min-w-max">
          {RESULTS_COLS.map(c => (
            <div key={c} className={`px-3 py-2 text-[#555566] font-semibold shrink-0 ${
              c === 'email' ? 'w-44' : c === 'created_at' ? 'w-32' : 'w-24'
            }`}>{c}</div>
          ))}
        </div>
        {RESULTS_ROWS.map((row, i) => (
          <div key={row.id} className={`flex border-b border-[#1e1e2e]/40 min-w-max ${i % 2 === 1 ? 'bg-white/[0.015]' : ''}`}>
            <div className="px-3 py-1.5 text-[#555566] w-24 shrink-0">{row.id}</div>
            <div className="px-3 py-1.5 text-[#8a8a9a] w-44 shrink-0 truncate">{row.email}</div>
            <div className={`px-3 py-1.5 w-24 shrink-0 ${row.role === 'admin' ? 'text-[#4a8af4]' : 'text-[#555566]'}`}>{row.role}</div>
            <div className="px-3 py-1.5 text-[#555566] w-32 shrink-0">{row.created_at}</div>
            <div className="px-3 py-1.5 text-[#2dd4a0] w-24 shrink-0">{row.order_count}</div>
          </div>
        ))}
        <div className="px-3 py-2 text-[#555566]">342 rows · 8ms</div>
      </div>
    </MockupWindow>
  )
}
