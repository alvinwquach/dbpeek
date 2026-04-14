/**
 * src/client/App.tsx
 *
 * WHAT: Root layout component — the three-panel shell that frames the entire
 * dbpeek UI.
 *
 * WHY: All major UI regions (sidebar, editor, results, status bar) are composed
 * here so there is one authoritative place that controls the top-level layout.
 * Child components are kept small and focused; this file only handles structure.
 *
 * HOW: Rendered by src/client/main.tsx. Imports shadcn primitives from
 * @/components/ui/*, StatusBar from ./components/StatusBar, and the Zustand
 * store from ./stores/app.
 */

import { useCallback, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { StatusBar } from './components/StatusBar';
import { SqlEditor } from './components/Editor/SqlEditor';
import { DataGrid } from './components/Results/DataGrid';
import { useAppStore } from './stores/app';
import { useQuery } from './hooks/useQuery';
import type { QueryResult } from './hooks/useQuery';

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  return (
    <aside className="w-[250px] shrink-0 flex flex-col bg-surface border-r border-border">
      <div className="px-3 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-widest text-muted shrink-0">
        Schema
      </div>

      {/*
        ScrollArea is a shadcn wrapper around the Base UI ScrollArea primitive.
        It renders a custom scrollbar that matches our theme, rather than the
        native OS scrollbar which ignores our ::-webkit-scrollbar styles in
        some browsers.
      */}
      <ScrollArea className="flex-1">
        <div className="p-2 text-xs text-muted">
          Schema
        </div>
      </ScrollArea>
    </aside>
  );
}

// ── EditorPane ────────────────────────────────────────────────────────────────

function EditorPane({ onRun }: { onRun: (sql: string) => void }) {
  // Pull the full tab list from the store — needed to render the tab strip.
  const tabs = useAppStore((s) => s.tabs);

  // The index (not the id) of the currently focused tab.
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);

  // Derive the active tab object from the index.
  const activeTab = tabs[activeTabIndex];

  return (
    <div className="flex-1 flex flex-col border-b border-border overflow-hidden">
      {/* Tab strip */}
      <div className="flex items-stretch bg-surface border-b border-border shrink-0 overflow-x-auto">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            onClick={() => useAppStore.getState().setActiveTab(index)}
            className={[
              'px-4 py-1.5 text-xs border-r border-border whitespace-nowrap cursor-pointer transition-colors',
              index === activeTabIndex
                ? 'bg-base text-primary border-b-2 border-b-accent'
                : 'bg-transparent text-muted border-b-2 border-b-transparent hover:text-primary',
            ].join(' ')}
          >
            {tab.name}
          </button>
        ))}

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              onClick={() => useAppStore.getState().addTab()}
              className="px-3 py-1.5 text-sm bg-transparent text-muted cursor-pointer hover:text-primary transition-colors"
            >
              +
            </TooltipTrigger>
            <TooltipContent>New tab</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/*
        key={activeTab?.id} remounts SqlEditor when the active tab changes,
        initialising CodeMirror with the new tab's SQL. The editor owns its
        content between remounts — no per-keystroke React state updates.
      */}
      <SqlEditor
        key={activeTab?.id}
        initialValue={activeTab?.sql ?? ''}
        onRun={onRun}
      />
    </div>
  );
}

// ── ResultsPane ───────────────────────────────────────────────────────────────

function ResultsPane({
  result,
  error,
  loading,
}: {
  result: QueryResult | null;
  error: string | null;
  loading: boolean;
}) {
  return <DataGrid result={result} error={error} loading={loading} />;
}

// ── App ───────────────────────────────────────────────────────────────────────

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
  const { execute, loading, result, error } = useQuery();

  useEffect(() => {
    void initConnectionInfo();
  }, [initConnectionInfo]);

  // NOTE: useCallback memoizes handleRun so it has a stable identity across
  // renders of App.
  //
  // Why wrap execute at all? execute() returns a Promise, but the onRun prop
  // signature is (sql: string) => void — components that call it (SqlEditor's
  // keymap) don't await the result. The `void` keyword here explicitly discards
  // the promise rather than letting it float unhandled (which would trigger
  // ESLint's @typescript-eslint/no-floating-promises rule).
  //
  // Why useCallback? handleRun is passed as the `onRun` prop to EditorPane,
  // which passes it to SqlEditor. Inside SqlEditor there is a useEffect that
  // keeps onRunRef current:
  //   useEffect(() => { onRunRef.current = onRun; }, [onRun]);
  // If handleRun were recreated on every App render, that effect would fire on
  // every render — not catastrophic, but a needless re-run. Because execute
  // itself is already stable (see useQuery's useCallback), [execute] never
  // changes, so handleRun is computed exactly once per App mount.
  const handleRun = useCallback(
    (sql: string) => {
      void execute(sql);
    },
    [execute]
  );

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
          The vertical Separator between sidebar and main content is a shadcn
          component backed by the Base UI Separator primitive. It renders a
          semantic <hr> with the correct ARIA role, styled to our border colour.
        */}
        <Separator orientation="vertical" />

        {/*
          min-w-0: same flex shrink issue in the horizontal axis — without this
          a long SQL line in the editor pushes the column wider than the
          available space instead of clipping / scrolling inside the editor.
        */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <EditorPane onRun={handleRun} />
          <ResultsPane result={result} error={error} loading={loading} />
        </main>
      </div>

      <StatusBar />
    </div>
  );
}
