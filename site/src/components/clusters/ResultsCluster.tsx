import { ClusterHeader } from '../ClusterHeader'
import { CenteredHero } from '../featureLayouts/CenteredHero'
import { StandardSplit } from '../featureLayouts/StandardSplit'
import { FullBleed } from '../featureLayouts/FullBleed'
import { CompactPair } from '../featureLayouts/CompactPair'
import { ExplainMockup, ValueViewerMockup } from '../features/mockups/DataMockups'
import { QueryHistoryMockup } from '../features/mockups/QueryMockups'
import { ExportMockup, CopyMockup } from '../features/mockups/IOMockups'
import { ChartWideMockup, ResultsGridMockup } from '../features/mockups/WideMockups'

export function ResultsCluster() {
  return (
    <div className="mt-[100px] sm:mt-[200px]">
      <ClusterHeader
        number="03"
        shortLabel="Results"
        heading="Understand your results"
        description="Go beyond raw rows — visualize data as charts, inspect query plans, drill into JSON values, and export anything."
      />

      {/* EXPLAIN plans — Archetype B (centered hero) */}
      <CenteredHero
        label="EXPLAIN Plans"
        heading={"Read query plans without\nreading query plans."}
        description="EXPLAIN ANALYZE output rendered as a collapsible tree. Each node is color-coded by cost: green for fast, yellow for attention, red for bottlenecks. The plan that used to require a separate tool is now one click away."
        tags={['EXPLAIN ANALYZE', 'Cost visualization', 'Node tree']}
        mockup={<ExplainMockup />}
        mockupMaxWidth={520}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Chart visualization — Archetype C (full-bleed widescreen) */}
      <FullBleed
        label="Charts"
        heading={"Visualize query results\nas bar charts instantly."}
        description="After running any query, switch to the Chart tab to render the result set as a bar chart. Pick your label and value columns. No chart config required."
        tags={['Bar charts', 'Auto column detection', 'One click']}
        mockup={<ChartWideMockup />}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Results grid — Archetype A (text left) */}
      <StandardSplit
        label="Results Grid"
        heading={"Every column, every row,\nexactly as returned."}
        description="Query results render in a full-featured data grid — sortable columns, horizontal scroll for wide schemas, striped rows for readability, and a row count on every result."
        tags={['Sortable columns', 'Wide schema support', 'Row count']}
        mockup={<ResultsGridMockup />}
        textLeft={true}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Value viewer / JSON — Archetype A (text right) */}
      <StandardSplit
        label="JSON / JSONB"
        heading={"Inspect long values\nwithout squinting."}
        description="Click any cell containing JSON, long text, or a JSONB value to open it in a full-width viewer with syntax highlighting and proper indentation. No more truncated column widths."
        tags={['JSON pretty-print', 'JSONB support', 'Syntax highlighting']}
        mockup={<ValueViewerMockup />}
        textLeft={false}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Copy cell/row + Query history — Archetype E (compact pair) */}
      <CompactPair
        left={{
          label: 'Copy',
          heading: 'Copy any cell or row\nin one click.',
          description: 'Right-click any row to copy the cell value, the full row as JSON, or the row as CSV. Useful for pasting values into other tools without manually formatting.',
          mockup: <CopyMockup />,
        }}
        right={{
          label: 'History',
          heading: 'Every query you ran\nin this session.',
          description: "The history panel shows every statement executed this session, with execution time, success or failure, and a one-click replay button. It doesn't persist between sessions by design.",
          mockup: <QueryHistoryMockup />,
        }}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Export — Archetype A (text left) */}
      <StandardSplit
        label="Export"
        heading={"Export any result set\nwithout leaving the tool."}
        description="Download query results as CSV, JSON, or Excel with one click. The export includes column headers and respects the current sort and filter state."
        tags={['CSV', 'JSON', 'Excel (.xlsx)', 'Filtered exports']}
        mockup={<ExportMockup />}
        textLeft={true}
      />
    </div>
  )
}
