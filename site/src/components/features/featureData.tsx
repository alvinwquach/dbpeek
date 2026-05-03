import { SchemaExplorerMockup, DDLViewerMockup, ERDMockup, PinMockup, TableEditorMockup } from './mockups/SchemaMockups'
import { QueryHistoryMockup, MultiTabMockup, MultiStatementMockup, ParamsMockup, CancellationMockup, ShortcutsMockup } from './mockups/QueryMockups'
import { ChartMockup, ExplainMockup, ValueViewerMockup, InlineEditingMockup, DataDiffMockup, FilterMockup } from './mockups/DataMockups'
import { SessionReportMockup, ExportMockup, CopyMockup, ImportMockup } from './mockups/IOMockups'

export interface FeatureDef {
  label: string
  heading: string
  description: string
  tags: string[]
  mockup: React.ReactNode
}

export const FEATURES: FeatureDef[] = [
  {
    label: 'Schema',
    heading: 'Browse every table,\ncolumn, and constraint.',
    description: "The schema tree expands tables to show columns with their types, primary and foreign key badges, and live row counts. Everything you need to understand a database you've never seen before.",
    tags: ['Tables', 'Columns', 'Indexes', 'PK / FK badges', 'Row counts'],
    mockup: <SchemaExplorerMockup />,
  },
  {
    label: 'Charts',
    heading: 'Visualize query results\nas bar charts instantly.',
    description: 'After running any query, switch to the Chart tab to render the result set as a bar chart. Pick your label and value columns. No chart config required.',
    tags: ['Bar charts', 'Auto column detection', 'One click'],
    mockup: <ChartMockup />,
  },
  {
    label: 'EXPLAIN',
    heading: 'Read query plans without\nreading query plans.',
    description: 'EXPLAIN ANALYZE output rendered as a collapsible tree. Each node is color-coded by cost: green for fast, yellow for attention, red for bottlenecks. The plan that used to require a separate tool is now one click away.',
    tags: ['EXPLAIN ANALYZE', 'Cost visualization', 'Node tree'],
    mockup: <ExplainMockup />,
  },
  {
    label: 'Privacy',
    heading: 'Every session ends\nwithout a trace.',
    description: 'dbpeek writes nothing to disk. No config file, no connection history, no credential store. The session report at exit shows exactly what happened: zero bytes written.',
    tags: ['No disk writes', 'No config', 'Auditable'],
    mockup: <SessionReportMockup />,
  },
  {
    label: 'History',
    heading: 'Every query you ran\nin this session.',
    description: "The history panel shows every statement executed this session, with execution time, success or failure, and a one-click replay button. It doesn't persist between sessions by design.",
    tags: ['In-session history', 'One-click replay', 'Execution time'],
    mockup: <QueryHistoryMockup />,
  },
  {
    label: 'Multi-tab',
    heading: 'Keep multiple queries\nopen at once.',
    description: 'Open as many editor tabs as you need. Each tab has its own query, its own results, and its own history. Name them anything. Switch between them instantly.',
    tags: ['Named tabs', 'Independent results', 'Persistent within session'],
    mockup: <MultiTabMockup />,
  },
  {
    label: 'Export',
    heading: 'Export any result set\nwithout leaving the tool.',
    description: 'Download query results as CSV, JSON, or Excel with one click. The export includes column headers and respects the current sort and filter state.',
    tags: ['CSV', 'JSON', 'Excel (.xlsx)', 'Filtered exports'],
    mockup: <ExportMockup />,
  },
  {
    label: 'Multi-statement',
    heading: 'Run a full migration\nin a single editor.',
    description: 'Paste multiple SQL statements separated by semicolons. dbpeek executes them in order and shows the status of each — complete, running, or pending — as they run.',
    tags: ['Sequential execution', 'Per-statement status', 'Error halting'],
    mockup: <MultiStatementMockup />,
  },
  {
    label: 'DDL',
    heading: 'View the exact CREATE\nstatement for any table.',
    description: "The DDL viewer shows the full CREATE TABLE statement for any table, formatted and syntax-highlighted. Copy it to replicate the schema elsewhere or understand what you're working with.",
    tags: ['CREATE TABLE', 'Formatted output', 'Copy button'],
    mockup: <DDLViewerMockup />,
  },
  {
    label: 'JSON / JSONB',
    heading: 'Inspect long values\nwithout squinting.',
    description: 'Click any cell containing JSON, long text, or a JSONB value to open it in a full-width viewer with syntax highlighting and proper indentation. No more truncated column widths.',
    tags: ['JSON pretty-print', 'JSONB support', 'Syntax highlighting'],
    mockup: <ValueViewerMockup />,
  },
  {
    label: 'Cancellation',
    heading: 'Cancel runaway queries\nbefore they hurt.',
    description: 'A visible progress indicator runs during long queries. The Cancel button sends pg_cancel_backend() immediately — no waiting for a timeout, no disconnecting.',
    tags: ['pg_cancel_backend', 'Cancel button', 'Progress indicator'],
    mockup: <CancellationMockup />,
  },
  {
    label: 'Inline editing',
    heading: 'Edit cells directly.\ndbpeek writes the SQL.',
    description: 'Double-click any cell to edit its value inline. dbpeek generates and previews the UPDATE statement below the grid. Confirm to run it, or press Escape to discard. Requires --write.',
    tags: ['Inline UPDATE', 'Generated SQL preview', 'Requires --write'],
    mockup: <InlineEditingMockup />,
  },
  {
    label: 'Data diff',
    heading: 'Compare staging and\nproduction side by side.',
    description: 'Run the same query against two connections and diff the results. Added rows are green, removed rows are red, changed values are blue. Useful before every deploy.',
    tags: ['Side-by-side diff', 'Row-level changes', 'Multi-connection'],
    mockup: <DataDiffMockup />,
  },
  {
    label: 'Filter',
    heading: 'Filter any column\nwithout writing WHERE.',
    description: 'Click any column header to type an inline filter. The result count updates live as you type. Stack multiple column filters to narrow down exactly the rows you need.',
    tags: ['Inline filter', 'Live row count', 'Multi-column'],
    mockup: <FilterMockup />,
  },
  {
    label: 'Pin tables',
    heading: 'Keep your most-used\ntables at the top.',
    description: 'Star any table to pin it to the top of the schema tree. Pinned tables survive tab switches and stay visible no matter how many other tables are in the database.',
    tags: ['Pin to top', 'Per-session', 'Fast navigation'],
    mockup: <PinMockup />,
  },
  {
    label: 'Parameters',
    heading: 'Named parameters with\na live input panel.',
    description: 'Write :paramName in your SQL and dbpeek renders a form below the editor. Fill in the values, run the query — no string concatenation, no injection risk.',
    tags: ['Named params', 'Type-safe inputs', 'No concatenation'],
    mockup: <ParamsMockup />,
  },
  {
    label: 'ERD',
    heading: 'Auto-generated entity\nrelationship diagrams.',
    description: 'dbpeek reads your foreign key constraints and renders a live ERD. Table nodes show column lists. Relationship lines show cardinality. No config or plugins needed.',
    tags: ['FK constraints', 'Auto-layout', 'Cardinality'],
    mockup: <ERDMockup />,
  },
  {
    label: 'Copy',
    heading: 'Copy any cell or row\nin one click.',
    description: 'Right-click any row to copy the cell value, the full row as JSON, or the row as CSV. Useful for pasting values into other tools without manually formatting.',
    tags: ['Copy as JSON', 'Copy as CSV', 'Copy cell'],
    mockup: <CopyMockup />,
  },
  {
    label: 'Import',
    heading: 'Drag a CSV or JSON\nfile to insert rows.',
    description: 'Drop a CSV or JSON file onto a table and dbpeek maps the columns and generates the INSERT statements. Preview before committing. Requires --write.',
    tags: ['CSV import', 'JSON import', 'Column mapping'],
    mockup: <ImportMockup />,
  },
  {
    label: 'Table editor',
    heading: 'Add, rename, or drop\ncolumns visually.',
    description: 'The table editor shows your current columns with type badges and action buttons. Add a new column, pick a type, and dbpeek generates the ALTER TABLE SQL. Requires --write.',
    tags: ['Add columns', 'Drop columns', 'ALTER TABLE preview'],
    mockup: <TableEditorMockup />,
  },
  {
    label: 'Shortcuts',
    heading: 'Keyboard shortcuts for\nevery action.',
    description: 'Format SQL on save, run with Ctrl+Enter, toggle comments, open the command palette. The full shortcut reference is always one keypress away.',
    tags: ['Auto-format', 'Command palette', 'Ctrl+Enter to run'],
    mockup: <ShortcutsMockup />,
  },
]
