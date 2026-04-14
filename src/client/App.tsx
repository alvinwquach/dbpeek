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

import { useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { StatusBar } from './components/StatusBar';
import { useAppStore } from './stores/app';

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

function EditorPane() {
  // PSEUDOCODE:
  // 1. Read the full tab list so we can render the tab strip.
  // 2. Read activeTabIndex so we know which tab to underline and which SQL to show.
  // 3. Read the updateTabSql action so the textarea can write back on every keystroke.
  // 4. Derive activeTab from the two values above — it's the tab currently being edited.
  // 5. Render a tab strip: one button per tab, active tab gets an accent underline.
  // 6. Render a textarea bound to activeTab.sql.

  // Pull the full tab list from the store. Every time a tab is added or its
  // SQL changes, this component re-renders with the latest array.
  const tabs = useAppStore((s) => s.tabs);

  // The index (not the id) of the currently focused tab. Using an index rather
  // than an id keeps the "which tab is active" logic simple — no map lookups.
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);

  // The action that writes new SQL into a tab. We use the action from the store
  // rather than local state so every keystroke is persisted globally — if the
  // user switches tabs and comes back, their SQL is still there.
  const updateTabSql = useAppStore((s) => s.updateTabSql);

  // Derive the active tab object from the index. Optional chaining (?.) guards
  // against the brief moment during tab creation where the index could be stale.
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
              // Active tab: solid background + 2px accent underline so it
              // visually "lifts" out of the surface-coloured tab bar.
              index === activeTabIndex
                ? 'bg-base text-primary border-b-2 border-b-accent'
                : 'bg-transparent text-muted border-b-2 border-b-transparent hover:text-primary',
            ].join(' ')}
          >
            {tab.name}
          </button>
        ))}

        {/*
          TooltipProvider must wrap any usage of Tooltip — it manages the shared
          delay timer so multiple tooltips on the same page don't each have their
          own independent timers.
        */}
        <TooltipProvider>
          <Tooltip>
            {/*
              TooltipTrigger wraps the element that triggers the tooltip on hover.
              Base UI's Trigger renders its own focusable element, so we style it
              directly rather than using asChild (which is a Radix-only pattern).
            */}
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

      {/* SQL textarea — font-mono applies JetBrains Mono via the @theme token */}
      <textarea
        value={activeTab?.sql ?? ''}
        onChange={(e) => {
          // Write the new SQL into the store on every keystroke. The store
          // maps over all tabs and replaces only the matching tab's sql field,
          // leaving the other tabs untouched.
          if (activeTab) updateTabSql(activeTab.id, e.target.value);
        }}
        placeholder="-- Write your SQL here…"
        spellCheck={false}
        className="flex-1 resize-none border-none outline-none bg-base text-primary font-mono text-[13px] leading-relaxed px-4 py-3 overflow-y-auto placeholder:text-muted"
      />
    </div>
  );
}

// ── ResultsPane ───────────────────────────────────────────────────────────────

function ResultsPane() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-1.5 border-b border-border text-[11px] font-semibold uppercase tracking-widest text-muted bg-surface shrink-0">
        Results
      </div>
      <ScrollArea className="flex-1">
        <div className="px-4 py-3 text-sm text-muted">
          Results
        </div>
      </ScrollArea>
    </div>
  );
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
  // PSEUDOCODE:
  // 1. Read the initConnectionInfo action from the store.
  // 2. Call it once on mount via useEffect — this fetches GET /api/status and
  //    writes the result into connectionInfo so StatusBar can display it.
  // 3. Render the layout shell: sidebar | (editor / results) stacked vertically,
  //    with the status bar pinned at the bottom.

  // Read only the action, not any state — this component doesn't need to
  // re-render when connectionInfo changes; StatusBar handles that itself.
  const initConnectionInfo = useAppStore((s) => s.initConnectionInfo);

  // useEffect with [] runs once after the first render — the right place for
  // a one-time data fetch that shouldn't block the initial paint. Putting the
  // fetch in the component body would re-run it on every render.
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
          The vertical Separator between sidebar and main content is a shadcn
          component backed by the Base UI Separator primitive. It renders a
          semantic <hr> with the correct ARIA role, styled to our border colour.
        */}
        <Separator orientation="vertical" />

        {/*
          min-w-0: same flex shrink issue in the horizontal axis — without this
          a long SQL line in the textarea pushes the column wider than the
          available space instead of clipping / scrolling inside the textarea.
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
