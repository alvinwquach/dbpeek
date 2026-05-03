import { ClusterHeader } from '../ClusterHeader'
import { CenteredHero } from '../featureLayouts/CenteredHero'
import { StandardSplit } from '../featureLayouts/StandardSplit'
import { FullBleed } from '../featureLayouts/FullBleed'
import { CompactPair } from '../featureLayouts/CompactPair'
import { SchemaExplorerMockup, DDLViewerMockup, PinMockup } from '../features/mockups/SchemaMockups'
import { FilterMockup } from '../features/mockups/DataMockups'
import { ERDWideMockup } from '../features/mockups/WideMockups'

export function ExploreCluster() {
  return (
    <div>
      <div className="pt-[60px] sm:pt-[100px] pb-[20px]">
        <ClusterHeader
          number="01"
          shortLabel="Explore"
          heading="Explore your schema"
          description="Understand any database the moment you connect — tables, columns, relationships, and constraints, all in one place."
        />
      </div>

      {/* Schema explorer — Archetype B (centered hero) */}
      <CenteredHero
        label="Schema Explorer"
        heading={"Browse every table,\ncolumn, and constraint."}
        description="The schema tree expands tables to show columns with their types, primary and foreign key badges, and live row counts. Everything you need to understand a database you've never seen before."
        tags={['Tables', 'Columns', 'Indexes', 'PK / FK badges', 'Row counts']}
        mockup={<SchemaExplorerMockup />}
        mockupMaxWidth={500}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* DDL viewer — Archetype A (text right) */}
      <StandardSplit
        label="DDL"
        heading={"View the exact CREATE\nstatement for any table."}
        description="The DDL viewer shows the full CREATE TABLE statement for any table, formatted and syntax-highlighted. Copy it to replicate the schema elsewhere or understand what you're working with."
        tags={['CREATE TABLE', 'Formatted output', 'Copy button']}
        mockup={<DDLViewerMockup />}
        textLeft={false}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* ERD — Archetype C (full-bleed widescreen) */}
      <FullBleed
        label="ERD"
        heading={"Auto-generated entity\nrelationship diagrams."}
        description="dbpeek reads your foreign key constraints and renders a live ERD. Table nodes show column lists. Relationship lines show cardinality. No config or plugins needed."
        tags={['FK constraints', 'Auto-layout', 'Cardinality']}
        mockup={<ERDWideMockup />}
      />

      {/* 100px gap */}
      <div className="h-[50px] sm:h-[100px]" />

      {/* Pin tables + Column filtering — Archetype E (compact pair) */}
      <CompactPair
        left={{
          label: 'Pin tables',
          heading: 'Keep your most-used\ntables at the top.',
          description: 'Star any table to pin it to the top of the schema tree. Pinned tables survive tab switches and stay visible no matter how many other tables are in the database.',
          mockup: <PinMockup />,
        }}
        right={{
          label: 'Filter',
          heading: 'Filter any column\nwithout writing WHERE.',
          description: 'Click any column header to type an inline filter. The result count updates live as you type. Stack multiple column filters to narrow down exactly the rows you need.',
          mockup: <FilterMockup />,
        }}
      />
    </div>
  )
}
