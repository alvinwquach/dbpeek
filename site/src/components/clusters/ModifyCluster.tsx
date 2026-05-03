import { ClusterHeader } from '../ClusterHeader'
import { CenteredHero } from '../featureLayouts/CenteredHero'
import { StandardSplit } from '../featureLayouts/StandardSplit'
import { FullBleed } from '../featureLayouts/FullBleed'
import { InlineEditingMockup } from '../features/mockups/DataMockups'
import { TableEditorMockup } from '../features/mockups/SchemaMockups'
import { ImportMockup } from '../features/mockups/IOMockups'
import { DataDiffWideMockup } from '../features/mockups/WideMockups'

export function ModifyCluster() {
  return (
    <div className="mt-[100px] sm:mt-[200px] pb-[120px]">
      <ClusterHeader
        number="04"
        shortLabel="Modify"
        heading="Modify with confidence"
        description="Edit cells, manage columns, import CSV files, and compare data between environments — all with a preview of the SQL before it runs."
        pill="Requires --write or --full mode"
      />

      {/* Inline editing — Archetype B (centered hero) */}
      <CenteredHero
        label="Inline Editing"
        heading={"Edit cells directly.\ndbpeek writes the SQL."}
        description="Double-click any cell to edit its value inline. dbpeek generates and previews the UPDATE statement below the grid. Confirm to run it, or press Escape to discard. Requires --write."
        tags={['Inline UPDATE', 'Generated SQL preview', 'Requires --write']}
        mockup={<InlineEditingMockup />}
        mockupMaxWidth={600}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Table editor — Archetype A (text left) */}
      <StandardSplit
        label="Table Editor"
        heading={"Add, rename, or drop\ncolumns visually."}
        description="The table editor shows your current columns with type badges and action buttons. Add a new column, pick a type, and dbpeek generates the ALTER TABLE SQL. Requires --write."
        tags={['Add columns', 'Drop columns', 'ALTER TABLE preview']}
        mockup={<TableEditorMockup />}
        textLeft={true}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* CSV import — Archetype A (text right) */}
      <StandardSplit
        label="Import"
        heading={"Drag a CSV or JSON\nfile to insert rows."}
        description="Drop a CSV or JSON file onto a table and dbpeek maps the columns and generates the INSERT statements. Preview before committing. Requires --write."
        tags={['CSV import', 'JSON import', 'Column mapping']}
        mockup={<ImportMockup />}
        textLeft={false}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Data diff — Archetype C (full-bleed widescreen) */}
      <FullBleed
        label="Data Diff"
        heading={"Compare staging and\nproduction side by side."}
        description="Run the same query against two connections and diff the results. Added rows are green, removed rows are red, changed values are blue. Useful before every deploy."
        tags={['Side-by-side diff', 'Row-level changes', 'Multi-connection']}
        mockup={<DataDiffWideMockup />}
      />
    </div>
  )
}
