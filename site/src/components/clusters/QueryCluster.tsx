import { ClusterHeader } from '../ClusterHeader'
import { CenteredHero } from '../featureLayouts/CenteredHero'
import { StandardSplit } from '../featureLayouts/StandardSplit'
import { StackedCode } from '../featureLayouts/StackedCode'
import { MultiTabMockup, MultiStatementMockup, ParamsMockup, CancellationMockup, ShortcutsMockup } from '../features/mockups/QueryMockups'
import { SQLEditorWithAutocompleteMockup } from '../features/mockups/WideMockups'

export function QueryCluster() {
  return (
    <div className="mt-[100px] sm:mt-[200px]">
      <ClusterHeader
        number="02"
        shortLabel="Query"
        heading="Write better queries"
        description="A full-featured SQL editor with autocomplete, multi-tab support, named parameters, and cancellation — in your browser."
      />

      {/* SQL editor + autocomplete — Archetype B (centered hero) */}
      <CenteredHero
        label="SQL Editor + Autocomplete"
        heading={"A real editor.\nNot a textarea."}
        description="Full syntax highlighting, column-aware autocomplete, multi-tab support, and keyboard shortcuts. The editor knows your schema — autocomplete suggests column names as you type."
        tags={['Syntax highlighting', 'Column autocomplete', 'Schema-aware']}
        mockup={<SQLEditorWithAutocompleteMockup />}
        mockupMaxWidth={760}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Multi-tab — Archetype A (text left) */}
      <StandardSplit
        label="Multi-tab"
        heading={"Keep multiple queries\nopen at once."}
        description="Open as many editor tabs as you need. Each tab has its own query, its own results, and its own history. Name them anything. Switch between them instantly."
        tags={['Named tabs', 'Independent results', 'Persistent within session']}
        mockup={<MultiTabMockup />}
        textLeft={true}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Query parameters — Archetype D (stacked code-first) */}
      <StackedCode
        label="Parameters"
        heading={"Named parameters with\na live input panel."}
        description="Write :paramName in your SQL and dbpeek renders a form below the editor. Fill in the values, run the query — no string concatenation, no injection risk."
        mockup={<ParamsMockup />}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Multi-statement — Archetype D (stacked code-first) */}
      <StackedCode
        label="Multi-statement"
        heading={"Run a full migration\nin a single editor."}
        description="Paste multiple SQL statements separated by semicolons. dbpeek executes them in order and shows the status of each — complete, running, or pending — as they run."
        mockup={<MultiStatementMockup />}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Query cancellation — Archetype A (text right) */}
      <StandardSplit
        label="Cancellation"
        heading={"Cancel runaway queries\nbefore they hurt."}
        description="A visible progress indicator runs during long queries. The Cancel button sends pg_cancel_backend() immediately — no waiting for a timeout, no disconnecting."
        tags={['pg_cancel_backend', 'Cancel button', 'Progress indicator']}
        mockup={<CancellationMockup />}
        textLeft={false}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Format & shortcuts — Archetype D (stacked code-first, kbd cheat sheet) */}
      <StackedCode
        label="Shortcuts"
        heading={"Keyboard shortcuts for\nevery action."}
        description="Format SQL on save, run with Ctrl+Enter, toggle comments, open the command palette. The full shortcut reference is always one keypress away."
        mockup={<ShortcutsMockup />}
      />
    </div>
  )
}
