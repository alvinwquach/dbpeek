import { MockupWindow } from '../MockupWindow'

export function SchemaExplorerMockup() {
  return (
    <MockupWindow title="Schema Explorer">
      <div className="p-3 space-y-0.5">
        <div className="text-[#555566] text-[9px] uppercase tracking-widest mb-2">Tables (4)</div>
        <div className="text-[#4a8af4]">▾ users <span className="text-[#555566] ml-1">342 rows</span></div>
        <div className="pl-3 space-y-0.5 text-[#8a8a9a]">
          <div><span className="text-yellow-500/70 text-[10px] border border-yellow-500/25 px-0.5 rounded">PK</span> id integer</div>
          <div>email varchar(255)</div>
          <div>role varchar(50)</div>
          <div>created_at timestamp</div>
        </div>
        <div className="text-[#555566] mt-1.5">▸ orders <span className="ml-1">1,204 rows</span></div>
        <div className="text-[#555566]">▸ products <span className="ml-1">88 rows</span></div>
        <div className="text-[#555566]">▸ sessions <span className="ml-1">9,312 rows</span></div>
      </div>
    </MockupWindow>
  )
}

export function DDLViewerMockup() {
  return (
    <MockupWindow title="DDL — users">
      <div className="p-3">
        <div className="flex justify-end mb-1">
          <span className="text-[#4a8af4] text-[10px] border border-[#4a8af4]/30 px-1.5 py-0.5 rounded cursor-pointer">
            Copy
          </span>
        </div>
        <div className="space-y-0.5">
          <div><span className="text-[#4a8af4]">CREATE TABLE</span><span className="text-[#ededf0]"> users (</span></div>
          <div className="pl-4 text-[#8a8a9a]">id         <span className="text-[#4a8af4]">SERIAL PRIMARY KEY</span>,</div>
          <div className="pl-4 text-[#8a8a9a]">email      <span className="text-[#4a8af4]">VARCHAR(255) NOT NULL UNIQUE</span>,</div>
          <div className="pl-4 text-[#8a8a9a]">role       <span className="text-[#4a8af4]">VARCHAR(50)</span>  DEFAULT <span className="text-[#2dd4a0]">'user'</span>,</div>
          <div className="pl-4 text-[#8a8a9a]">created_at <span className="text-[#4a8af4]">TIMESTAMP</span>   DEFAULT NOW()</div>
          <div className="text-[#ededf0]">);</div>
        </div>
      </div>
    </MockupWindow>
  )
}

export function ERDMockup() {
  return (
    <MockupWindow title="Entity Relationship">
      <div className="p-3">
        <div className="flex items-start gap-3">
          <div className="border border-[#4a8af4]/30 rounded bg-[#4a8af4]/[0.05] px-2 py-1.5 text-[10px]">
            <div className="text-[#4a8af4] font-semibold mb-1">users</div>
            <div className="text-[#555566]"><span className="text-yellow-500/70">PK</span> id</div>
            <div className="text-[#555566]">email</div>
            <div className="text-[#555566]">role</div>
          </div>
          <div className="flex flex-col items-center justify-center mt-5 gap-0 text-[#555566] text-[10px] shrink-0">
            <span>1</span>
            <span>──</span>
            <span>∞</span>
          </div>
          <div className="border border-[#1e1e2e] rounded bg-[#111118] px-2 py-1.5 text-[10px]">
            <div className="text-[#8a8a9a] font-semibold mb-1">orders</div>
            <div className="text-[#555566]"><span className="text-yellow-500/70">PK</span> id</div>
            <div className="text-[#555566]"><span className="text-[#4a8af4]/70">FK</span> user_id</div>
            <div className="text-[#555566]">total</div>
          </div>
        </div>
      </div>
    </MockupWindow>
  )
}

export function PinMockup() {
  return (
    <MockupWindow title="Schema">
      <div className="p-3 space-y-1">
        <div className="text-[#555566] text-[9px] uppercase tracking-widest mb-1.5">Pinned</div>
        {[['users', '342'], ['orders', '1,204']].map(([name, count]) => (
          <div key={name} className="flex items-center gap-1.5 text-[#4a8af4]">
            <span className="text-[9px]">★</span>
            <span>{name}</span>
            <span className="ml-auto text-[#555566]">{count}</span>
          </div>
        ))}
        <div className="border-t border-[#1e1e2e] my-2" />
        <div className="text-[#555566] text-[9px] uppercase tracking-widest mb-1.5">All tables</div>
        {['products', 'sessions', 'audit_log'].map(t => (
          <div key={t} className="text-[#555566] flex items-center gap-1.5">
            <span>▸</span><span>{t}</span>
          </div>
        ))}
      </div>
    </MockupWindow>
  )
}

export function TableEditorMockup() {
  return (
    <MockupWindow title="Edit table — users">
      <div className="p-3">
        {[
          { name: 'id',         type: 'SERIAL',      drop: false },
          { name: 'email',      type: 'VARCHAR(255)', drop: false },
          { name: 'temp_field', type: 'TEXT',         drop: true  },
        ].map(col => (
          <div key={col.name} className="flex items-center gap-2 py-1.5 border-b border-[#1e1e2e]/40">
            <span className="text-[#ededf0] w-20 shrink-0">{col.name}</span>
            <span className="text-[#4a8af4] flex-1">{col.type}</span>
            {col.drop && (
              <span className="text-[#e84c4c]/70 text-[10px] border border-[#e84c4c]/20 px-1.5 py-0.5 rounded">Drop</span>
            )}
          </div>
        ))}
        <div className="flex items-center gap-2 pt-2">
          <div className="flex-1 bg-[#0e0e18] border border-[#4a8af4]/30 rounded px-1.5 py-1 text-[#8a8a9a]">verified</div>
          <div className="w-20 bg-[#0e0e18] border border-[#1e1e2e] rounded px-1.5 py-1 text-[#4a8af4]">BOOLEAN</div>
          <span className="text-[#2dd4a0] text-[10px]">+ Add</span>
        </div>
        <div className="mt-2 pt-2 border-t border-[#1e1e2e] text-[#555566]">
          <span className="text-[#4a8af4]">ALTER TABLE</span>
          <span className="text-[#8a8a9a]"> users </span>
          <span className="text-[#4a8af4]">ADD</span>
          <span className="text-[#ededf0]"> verified </span>
          <span className="text-[#4a8af4]">BOOLEAN</span>
          <span className="text-[#8a8a9a]">;</span>
        </div>
      </div>
    </MockupWindow>
  )
}
