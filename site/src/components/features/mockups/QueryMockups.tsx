import { MockupWindow } from '../MockupWindow'

export function QueryHistoryMockup() {
  const rows = [
    { ok: true,  sql: 'SELECT * FROM users LIMIT 100',         time: '2s ago'  },
    { ok: true,  sql: "UPDATE orders SET status = 'shipped'",  time: '5m ago'  },
    { ok: false, sql: 'SELECT * FROM nonexistent_table',       time: '8m ago'  },
    { ok: true,  sql: 'EXPLAIN ANALYZE SELECT u.email…',       time: '12m ago' },
  ]
  return (
    <MockupWindow title="Query history">
      <div className="divide-y divide-[#1e1e2e]/60">
        {rows.map((row, i) => (
          <div key={i} className="flex items-start gap-2 p-2.5">
            <span className={row.ok ? 'text-[#2dd4a0] shrink-0' : 'text-[#e84c4c] shrink-0'}>
              {row.ok ? '✓' : '✗'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[#8a8a9a] truncate">{row.sql}</div>
              <div className="text-[#555566] text-[10px] mt-0.5">{row.time}</div>
            </div>
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}

export function MultiTabMockup() {
  return (
    <MockupWindow>
      <div className="flex items-end gap-0.5 px-2 pt-2 bg-[#0e0e18] border-b border-[#1e1e2e] -mt-[1px]">
        <div className="flex items-center gap-1 mr-2 mb-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <span className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>
        <div className="px-2.5 py-1.5 bg-[#111118] border border-b-0 border-[#1e1e2e] rounded-t text-[#ededf0] text-[10px]">
          user_analysis.sql
        </div>
        <div className="px-2.5 py-1.5 text-[#555566] text-[10px]">orders_q4.sql</div>
        <div className="px-2.5 py-1.5 text-[#555566] text-[10px]">+ temp</div>
        <div className="px-2 py-1.5 text-[#555566] text-[10px] ml-auto mb-0.5">+</div>
      </div>
      <div className="p-3">
        <span className="text-[#4a8af4]">SELECT</span>
        <span className="text-[#ededf0]"> * </span>
        <span className="text-[#4a8af4]">FROM</span>
        <span className="text-[#ededf0]"> users </span>
        <span className="text-[#4a8af4]">WHERE</span>
        <span className="text-[#ededf0]"> role = </span>
        <span className="text-[#2dd4a0]">'admin'</span>
        <span className="text-[#ededf0]">;</span>
      </div>
    </MockupWindow>
  )
}

export function MultiStatementMockup() {
  const statements = [
    { n: 1, status: 'done',    sql: 'ALTER TABLE users ADD COLUMN verified boolean;' },
    { n: 2, status: 'running', sql: 'UPDATE users SET verified = false WHERE verified IS NULL;' },
    { n: 3, status: 'pending', sql: 'CREATE INDEX ON users (verified);' },
  ]
  return (
    <MockupWindow title="multi_migration.sql">
      <div className="p-3 space-y-3">
        {statements.map(stmt => (
          <div key={stmt.n}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[#555566]">-- Statement {stmt.n}/3</span>
              {stmt.status === 'done'    && <span className="text-[#2dd4a0] text-[10px]">✓ complete</span>}
              {stmt.status === 'running' && <span className="text-[#4a8af4] text-[10px]">⟳ running…</span>}
              {stmt.status === 'pending' && <span className="text-[#555566] text-[10px]">○ pending</span>}
            </div>
            <div className={stmt.status === 'pending' ? 'text-[#555566]' : 'text-[#8a8a9a]'}>
              {stmt.sql}
            </div>
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}

export function ParamsMockup() {
  return (
    <MockupWindow title="orders_by_status.sql">
      <div className="p-3">
        <div className="mb-3 leading-relaxed">
          <span className="text-[#4a8af4]">SELECT</span>
          <span className="text-[#ededf0]"> * </span>
          <span className="text-[#4a8af4]">FROM</span>
          <span className="text-[#ededf0]"> orders</span>
          <br />
          <span className="text-[#4a8af4]">WHERE</span>
          <span className="text-[#ededf0]"> status = </span>
          <span className="text-yellow-400/80">:status</span>
          <br />
          <span className="text-[#4a8af4]">{'  '}AND</span>
          <span className="text-[#ededf0]"> user_id = </span>
          <span className="text-yellow-400/80">:userId</span>
        </div>
        <div className="border-t border-[#1e1e2e] pt-2 space-y-1.5">
          <div className="text-[#555566] text-[9px] uppercase tracking-widest mb-1">Parameters</div>
          {[
            { name: 'status', value: 'shipped', valueClass: 'text-[#2dd4a0]' },
            { name: 'userId', value: '42',      valueClass: 'text-[#ededf0]'  },
          ].map(p => (
            <div key={p.name} className="flex items-center gap-2">
              <span className="text-yellow-400/70 w-14 shrink-0">{p.name}</span>
              <div className={`flex-1 bg-[#0e0e18] border border-[#1e1e2e] rounded px-2 py-0.5 ${p.valueClass}`}>
                {p.value}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockupWindow>
  )
}

export function CancellationMockup() {
  return (
    <MockupWindow title="running query">
      <div className="p-3 space-y-2">
        <div>
          <span className="text-[#4a8af4]">SELECT</span>
          <span className="text-[#ededf0]"> * </span>
          <span className="text-[#4a8af4]">FROM</span>
          <span className="text-[#ededf0]"> large_table…</span>
        </div>
        <div>
          <div className="flex justify-between text-[10px] text-[#555566] mb-1">
            <span>Fetching rows…</span>
            <span>47%</span>
          </div>
          <div className="h-1.5 bg-[#1e1e2e] rounded-full overflow-hidden">
            <div className="h-full bg-[#4a8af4]/50 rounded-full" style={{ width: '47%' }} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[#555566] text-[10px]">pg_cancel_backend(12847)</span>
          <button className="px-2 py-1 bg-[#e84c4c]/15 border border-[#e84c4c]/30 rounded text-[#e84c4c] text-[10px]">
            Cancel
          </button>
        </div>
      </div>
    </MockupWindow>
  )
}

export function ShortcutsMockup() {
  const shortcuts = [
    { keys: ['Ctrl', 'Enter'],      action: 'Run query'       },
    { keys: ['Ctrl', 'Shift', 'F'], action: 'Format SQL'      },
    { keys: ['Ctrl', '/'],          action: 'Toggle comment'  },
    { keys: ['Ctrl', 'K'],          action: 'Command palette' },
  ]
  return (
    <MockupWindow title="Keyboard shortcuts">
      <div className="p-3 space-y-2">
        {shortcuts.map(s => (
          <div key={s.action} className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              {s.keys.map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-[#0e0e18] border border-[#1e1e2e] rounded text-[10px] text-[#ededf0]">
                    {k}
                  </kbd>
                  {i < s.keys.length - 1 && <span className="text-[#555566] text-[9px]">+</span>}
                </span>
              ))}
            </div>
            <span className="text-[#555566] text-[10px]">{s.action}</span>
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}
