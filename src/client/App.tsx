/**
 * src/client/App.tsx
 *
 * WHAT: Root layout component — the three-panel shell that frames the entire
 * dbpeek UI.
 *
 * WHY: All major UI regions (sidebar, editor, results, status bar) are defined
 * here so there is one authoritative place that controls the top-level layout.
 * Child components are kept small and focused; this component only handles
 * structure, not business logic.
 *
 * HOW: Rendered by src/client/main.tsx. Imports StatusBar from
 * src/client/components/StatusBar.tsx and reads/writes the Zustand store in
 * src/client/stores/app.ts.
 */

import { useEffect } from 'react';
import { StatusBar } from './components/StatusBar';
import { useAppStore } from './stores/app';

function Sidebar() {
  return (
    <aside className="w-[250px] shrink-0 flex flex-col overflow-hidden bg-surface border-r border-border">
      <div className="px-3 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-widest text-muted shrink-0">
        Schema
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs text-muted">
        Schema
      </div>
    </aside>
  );
}

function EditorPane() {
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const updateTabSql = useAppStore((s) => s.updateTabSql);

  const activeTab = tabs[activeTabIndex];

  return (
    <div className="flex-1 flex flex-col border-b border-border overflow-hidden">
      <div className="flex items-stretch bg-surface border-b border-border shrink-0 overflow-x-auto">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            onClick={() => useAppStore.getState().setActiveTab(index)}
            className={[
              'px-4 py-1.5 text-xs border-r border-border whitespace-nowrap cursor-pointer',
              index === activeTabIndex
                ? 'bg-base text-primary border-b-2 border-b-accent'
                : 'bg-transparent text-muted border-b-2 border-b-transparent hover:text-primary',
            ].join(' ')}
          >
            {tab.name}
          </button>
        ))}
        <button
          onClick={() => useAppStore.getState().addTab()}
          title="New tab"
          className="px-3 py-1.5 text-sm bg-transparent text-muted cursor-pointer hover:text-primary"
        >
          +
        </button>
      </div>

      <textarea
        value={activeTab?.sql ?? ''}
        onChange={(e) => {
          if (activeTab) updateTabSql(activeTab.id, e.target.value);
        }}
        placeholder="-- Write your SQL here…"
        spellCheck={false}
        className="flex-1 resize-none border-none outline-none bg-base text-primary font-mono text-[13px] leading-relaxed px-4 py-3 overflow-y-auto placeholder:text-muted"
      />
    </div>
  );
}

function ResultsPane() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-border text-[11px] font-semibold uppercase tracking-widest text-muted bg-surface shrink-0">
        Results
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-muted">
        Results
      </div>
    </div>
  );
}

/**
 * App
 *
 * Root component. Composes the three-panel layout:
 *   ┌─────────────────────────────────────────┐
 *   │  Sidebar (250px)  │  Editor (flex)       │
 *   │                   ├──────────────────────│
 *   │                   │  Results (flex)      │
 *   ├───────────────────┴──────────────────────┤
 *   │  StatusBar (26px)                        │
 *   └──────────────────────────────────────────┘
 */
export function App() {
  const initConnectionInfo = useAppStore((s) => s.initConnectionInfo);

  // useEffect with [] runs once after the first render — the right place for
  // a one-time data fetch that shouldn't block the initial paint. Putting the
  // fetch directly in the component body would re-run it on every render.
  useEffect(() => {
    void initConnectionInfo();
  }, [initConnectionInfo]);

  return (
    <div className="h-screen flex flex-col bg-base text-primary overflow-hidden">
      {/*
        min-h-0: flex children default to min-height: auto, which means they
        refuse to shrink below their content size. Without this the editor +
        results area overflows the viewport instead of fitting inside it.
      */}
      <div className="flex-1 flex flex-row overflow-hidden min-h-0">
        <Sidebar />

        {/*
          min-w-0: same flex shrink issue in the horizontal axis — without this
          a long SQL line in the textarea pushes the main column wider than the
          available space instead of clipping/scrolling.
        */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <EditorPane />
          <ResultsPane />
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
