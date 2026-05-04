/**
 * docs/src/App.tsx — Root router for the dbpeek docs site.
 *
 * WHAT: Sets up React Router with all doc page routes and wraps them in the
 * shared layout and MDX component provider.
 *
 * WHY BrowserRouter with basename="/docs": React Router's basename tells the
 * router that all routes are relative to /docs, so <Link to="/getting-started/installation">
 * generates href="/docs/getting-started/installation" automatically. This matches
 * Vite's base: '/docs/' config and how the app is served in production.
 *
 * WHY manual routes (no vite-plugin-pages): File-system routing plugins add
 * complexity and have compatibility issues with MDX + React 19 + Vite 6.
 * Manual routes are explicit, type-safe, and easy to read.
 *
 * Route naming: slugs exactly match sidebar-config.ts so prev/next links and
 * active sidebar highlighting work without any additional mapping.
 *
 * MDXProvider wraps DocsLayout (not the other way around) so the component map
 * is available to all MDX pages rendered as route children.
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import DocsProvider from './components/content/MDXProvider';
import { DocsLayout } from './components/layout/DocsLayout';

// ── Getting started ──────────────────────────────────────────────────────────
import GettingStartedIndex from './content/index.mdx';
import Installation from './content/getting-started/installation.mdx';
import Quickstart from './content/getting-started/quickstart.mdx';
import ConnectionStrings from './content/getting-started/connection-strings.mdx';
import PermissionModes from './content/getting-started/permission-modes.mdx';

// ── Editor ───────────────────────────────────────────────────────────────────
import EditorOverview from './content/editor/overview.mdx';
import Autocomplete from './content/editor/autocomplete.mdx';
import MultiTab from './content/editor/multi-tab.mdx';
import ParameterizedQueries from './content/editor/parameterized-queries.mdx';
import FormatSql from './content/editor/format-sql.mdx';
import QueryCancellation from './content/editor/query-cancellation.mdx';

// ── Schema ───────────────────────────────────────────────────────────────────
import SchemaExplorer from './content/schema/explorer.mdx';
import ColumnStatistics from './content/schema/column-statistics.mdx';
import DdlViewer from './content/schema/ddl-viewer.mdx';
import PinTables from './content/schema/pin-tables.mdx';
import ErdDiagrams from './content/schema/erd-diagrams.mdx';

// ── Results ──────────────────────────────────────────────────────────────────
import ResultsGrid from './content/results/grid.mdx';
import SortingFiltering from './content/results/sorting-filtering.mdx';
import ValueViewer from './content/results/value-viewer.mdx';
import CopyCell from './content/results/copy-cell.mdx';
import ResultsExport from './content/results/export.mdx';
import Charts from './content/results/charts.mdx';

// ── Analysis ─────────────────────────────────────────────────────────────────
import ExplainPlans from './content/analysis/explain-plans.mdx';
import QueryHistory from './content/analysis/query-history.mdx';
import MultiStatement from './content/analysis/multi-statement.mdx';
import SessionReport from './content/analysis/session-report.mdx';
import EmptyState from './content/analysis/empty-state.mdx';

// ── Data modification ────────────────────────────────────────────────────────
import DataModOverview from './content/data-modification/overview.mdx';
import InlineEditing from './content/data-modification/inline-editing.mdx';
import Import from './content/data-modification/import.mdx';
import TableEditor from './content/data-modification/table-editor.mdx';
import DataDiff from './content/data-modification/data-diff.mdx';

// ── Reference ────────────────────────────────────────────────────────────────
import CliFlags from './content/reference/cli-flags.mdx';
import KeyboardShortcuts from './content/reference/keyboard-shortcuts.mdx';
import SupportedDatabases from './content/reference/supported-databases.mdx';
import Troubleshooting from './content/reference/troubleshooting.mdx';
import Faq from './content/reference/faq.mdx';

// ── Advanced ─────────────────────────────────────────────────────────────────
import Architecture from './content/advanced/architecture.mdx';
import PrivacyModel from './content/advanced/privacy-model.mdx';
import CredentialAudit from './content/advanced/credential-audit.mdx';
import Contributing from './content/advanced/contributing.mdx';

export function App() {
  return (
    /**
     * basename="/docs": all <Link to="..."> and navigate() calls are relative
     * to /docs automatically. The router strips /docs from location.pathname
     * so route matching uses paths like "/" and "/getting-started/installation".
     */
    <BrowserRouter basename="/docs">
      {/*
        DocsProvider maps HTML elements to styled components for all MDX pages.
        It must wrap DocsLayout so it's active when MDX route components render.
      */}
      <DocsProvider>
        <DocsLayout>
          <Routes>
            {/* ── Getting started ─────────────────────────────────────── */}
            <Route path="/" element={<GettingStartedIndex />} />
            <Route path="/getting-started/installation" element={<Installation />} />
            <Route path="/getting-started/quickstart" element={<Quickstart />} />
            <Route path="/getting-started/connection-strings" element={<ConnectionStrings />} />
            <Route path="/getting-started/permission-modes" element={<PermissionModes />} />

            {/* ── Editor ──────────────────────────────────────────────── */}
            <Route path="/editor/overview" element={<EditorOverview />} />
            <Route path="/editor/autocomplete" element={<Autocomplete />} />
            <Route path="/editor/multi-tab" element={<MultiTab />} />
            <Route path="/editor/parameterized-queries" element={<ParameterizedQueries />} />
            <Route path="/editor/format-sql" element={<FormatSql />} />
            <Route path="/editor/query-cancellation" element={<QueryCancellation />} />

            {/* ── Schema ──────────────────────────────────────────────── */}
            <Route path="/schema/explorer" element={<SchemaExplorer />} />
            <Route path="/schema/column-statistics" element={<ColumnStatistics />} />
            <Route path="/schema/ddl-viewer" element={<DdlViewer />} />
            <Route path="/schema/pin-tables" element={<PinTables />} />
            <Route path="/schema/erd-diagrams" element={<ErdDiagrams />} />

            {/* ── Results ─────────────────────────────────────────────── */}
            <Route path="/results/grid" element={<ResultsGrid />} />
            <Route path="/results/sorting-filtering" element={<SortingFiltering />} />
            <Route path="/results/value-viewer" element={<ValueViewer />} />
            <Route path="/results/copy-cell" element={<CopyCell />} />
            <Route path="/results/export" element={<ResultsExport />} />
            <Route path="/results/charts" element={<Charts />} />

            {/* ── Analysis ────────────────────────────────────────────── */}
            <Route path="/analysis/explain-plans" element={<ExplainPlans />} />
            <Route path="/analysis/query-history" element={<QueryHistory />} />
            <Route path="/analysis/multi-statement" element={<MultiStatement />} />
            <Route path="/analysis/session-report" element={<SessionReport />} />
            <Route path="/analysis/empty-state" element={<EmptyState />} />

            {/* ── Data modification ────────────────────────────────────── */}
            <Route path="/data-modification/overview" element={<DataModOverview />} />
            <Route path="/data-modification/inline-editing" element={<InlineEditing />} />
            <Route path="/data-modification/import" element={<Import />} />
            <Route path="/data-modification/table-editor" element={<TableEditor />} />
            <Route path="/data-modification/data-diff" element={<DataDiff />} />

            {/* ── Reference ───────────────────────────────────────────── */}
            <Route path="/reference/cli-flags" element={<CliFlags />} />
            <Route path="/reference/keyboard-shortcuts" element={<KeyboardShortcuts />} />
            <Route path="/reference/supported-databases" element={<SupportedDatabases />} />
            <Route path="/reference/troubleshooting" element={<Troubleshooting />} />
            <Route path="/reference/faq" element={<Faq />} />

            {/* ── Advanced ────────────────────────────────────────────── */}
            <Route path="/advanced/architecture" element={<Architecture />} />
            <Route path="/advanced/privacy-model" element={<PrivacyModel />} />
            <Route path="/advanced/credential-audit" element={<CredentialAudit />} />
            <Route path="/advanced/contributing" element={<Contributing />} />
          </Routes>
        </DocsLayout>
      </DocsProvider>
    </BrowserRouter>
  );
}
