# dbpeek — Architecture

This document is for contributors who want to understand the codebase in depth: how the security model works, how query cancellation is implemented, what lives in the Zustand store, and how to extend dbpeek with a new database dialect.

For setup and contribution workflow, see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Directory structure

```
dbpeek/
├── src/
│   ├── cli/
│   │   ├── index.ts          CLI entry: parse argv, start server, open browser
│   │   └── parseUrl.ts       Parse "postgres://user:pass@host:5432/db" → ConnectionConfig
│   ├── server/
│   │   ├── db.ts             Knex factory, testConnection, destroyConnection
│   │   ├── index.ts          Express app factory (createApp / createServer)
│   │   ├── permissions.ts    *** SECURITY BOUNDARY *** validateQuery + splitStatements
│   │   └── routes/
│   │       ├── index.ts      Mount all routers onto the Express app
│   │       ├── status.ts     GET /api/status — connection metadata
│   │       ├── query/
│   │       │   ├── index.ts  POST /api/query + POST /api/query/cancel
│   │       │   ├── execute.ts  Run a single SQL statement on a pinned connection
│   │       │   ├── normalize.ts  Normalise pg/mysql/sqlite row formats
│   │       │   ├── errors.ts   Map driver errors to HTTP 400 bodies
│   │       │   └── pid.ts    Get backend PID for cancel support (per dialect)
│   │       ├── schema/
│   │       │   ├── index.ts  GET /api/schema + GET /api/schema/:table
│   │       │   ├── types.ts  Shared schema types
│   │       │   ├── utils.ts  Shared helpers (column type normalisation)
│   │       │   └── handlers/ Per-dialect handlers (postgres, mysql, sqlite, mssql)
│   │       ├── explain/
│   │       │   ├── index.ts  POST /api/explain
│   │       │   ├── types.ts  PlanNode tree type
│   │       │   └── parsers/  Per-dialect EXPLAIN output parsers
│   │       ├── data/
│   │       │   └── index.ts  PUT /api/data/:table — inline cell editing
│   │       └── import/
│   │           └── index.ts  POST /api/import — bulk CSV/JSON insert
│   ├── client/
│   │   ├── App.tsx           Root layout: sidebar + editor + results + history panel
│   │   ├── main.tsx          ReactDOM.createRoot entry point
│   │   ├── stores/
│   │   │   ├── app.ts        Zustand store: tabs, history, ERD, schema, history panel
│   │   │   └── theme.ts      Dark/light theme toggle
│   │   ├── hooks/
│   │   │   ├── useQuery.ts   POST /api/query + cancel
│   │   │   ├── useExplain.ts POST /api/explain
│   │   │   ├── useSchema.ts  GET /api/schema (cached by TanStack Query)
│   │   │   └── useCellEdit.ts PUT /api/data/:table
│   │   ├── components/
│   │   │   ├── Editor/       CodeMirror 6 SQL editor + tab bar
│   │   │   ├── Results/      DataGrid, ExplainView, ChartView, ValueViewer, ExportMenu
│   │   │   ├── Schema/       SchemaTree, DdlViewer, ErdView, ColumnStats
│   │   │   ├── History/      QueryHistoryPanel
│   │   │   ├── Import/       ImportPreview + CSV/JSON file parser
│   │   │   ├── Diff/         SchemaDiff + DataDiff modals
│   │   │   ├── StatusBar.tsx Connection info bar at the bottom of the screen
│   │   │   └── SessionReport.tsx Per-session query summary modal
│   │   └── utils/
│   │       ├── formatSql.ts  SQL keyword formatter
│   │       ├── parseSelectTable.ts  Extract table name from SELECT for cell-edit
│   │       └── buildUpdateSql.ts    Build UPDATE statement for cell-edit preview
│   └── types/
│       └── connection.ts     Dialect, PermissionMode, ConnectionConfig, DEFAULT_PORTS
├── tests/
│   ├── server/               Vitest: permissions, query, schema, explain, import
│   ├── client/               Vitest: formatSql, export, parseSelectTable
│   └── e2e/                  Playwright: full-browser feature tests
├── tsconfig.json             TypeScript config for src/ + tests/
├── tsup.config.ts            Bundle CLI + server to dist/ (CJS output)
└── vite.config.ts            Bundle React client to dist/client/
```

---

## Security model

`src/server/permissions.ts` is the most important file in the project. Every SQL string submitted through the browser must pass `validateQuery(sql, mode)` before it ever reaches `knex.raw()`.

### Validation pipeline

1. **Split** — `splitStatements(sql)` tokenizes the input into individual statements using a hand-written SQL-aware lexer. It respects single-quoted strings (`'a;b'`), double-quoted identifiers (`"col;name"`), backtick identifiers (`` `col` ``), line comments (`--`), and block comments (`/* */`). Naïve `split(';')` would mis-classify semicolons inside string literals as statement separators and break the guarantee.

2. **Classify** — `getStatementType(statement)` strips leading whitespace and comments, then extracts the first keyword. Keywords are normalised to uppercase.

3. **Compare** — the keyword is matched against three sets and checked against the current mode:

   | Mode | READ keywords | WRITE keywords | DDL/DCL/procedural |
   |------|:---:|:---:|:---:|
   | `readonly` (default) | ✅ | ❌ | ❌ |
   | `write` | ✅ | ✅ | ❌ |
   | `full` | ✅ | ✅ | ✅ |

4. **Reject the whole batch** — if *any* statement in a multi-statement input fails, the entire batch is rejected. dbpeek never partially executes a batch.

### Why the mode cannot be changed from the browser

The permission mode is captured as a closure variable inside `registerRoutes()` when the CLI starts. No HTTP endpoint exists to read or write it. A compromised browser tab can only call the routes that already exist — and none of them mutate the mode.

For users who want stronger guarantees, the right defense is read-only database credentials. dbpeek's filter is a usability safety net against accidental destructive queries, not a sandbox against a determined attacker.

---

## Query cancellation

When the user clicks the Cancel button (or presses `Cmd/Ctrl+.`):

1. `POST /api/query` acquires a **pinned** connection from the Knex pool via `acquireConnection`.
2. `getConnectionPid()` (`src/server/routes/query/pid.ts`) runs on that pinned connection to retrieve the backend process / session ID:
   - Postgres: `SELECT pg_backend_pid() AS pid`
   - MySQL: `SELECT CONNECTION_ID() AS pid`
   - MSSQL: `SELECT @@SPID AS pid`
   - SQLite: returns `null` (synchronous in-process; cancellation is not supported)
3. The PID is stored in a closure variable `activePid`.
4. The user's SQL executes on the same pinned connection.
5. Concurrently, the browser sends `POST /api/query/cancel`.
6. The cancel handler reads `activePid` and issues the kill command on a **different** connection picked from the pool:
   - Postgres: `SELECT pg_cancel_backend($pid)`
   - MySQL: `KILL QUERY $pid`
   - MSSQL: `KILL $spid`
7. The database interrupts the running query; the pinned connection rejects with an error.
8. The primary request's `catch` block handles the abort; the `finally` block clears `activePid` and releases the pinned connection.

The critical invariant is that the PID query and the user query run on the **same** pinned connection. If they ran on different connections, the stored PID would point to the wrong backend and the cancel would be a no-op.

---

## Multi-tab state

All tab state lives in Zustand (`src/client/stores/app.ts`). Each tab slot holds:

```ts
{
  id: string
  sql: string
  result: NormalizedResult | null
  error: string | null
  loading: boolean
  viewMode: "grid" | "chart" | "explain"
  explainData: PlanNode | null
  explainError: string | null
  explainLoading: boolean
  title: string
  baseTitle: string
}
```

Switching tabs is zero-latency: the store already holds the previous result — no re-fetch. The CodeMirror editor is a **single persistent instance** that hot-swaps its document via the `tabId` prop. Using React's `key=` would destroy and recreate the CodeMirror `EditorView` on every tab switch, causing a flash and losing font rendering cache. The single-instance approach avoids this entirely.

---

## CORS policy

The Express server only accepts requests from `localhost:*` and `127.0.0.1:*` origins. This prevents a remote webpage from calling the API if the user has dbpeek running locally. The policy is defined in `src/server/index.ts` and uses an allowlist of regex patterns rather than `cors()` with `origin: '*'`, which would permit any page on the internet to query the user's database.

Non-browser clients (curl, Postman) send no `Origin` header and are allowed through — CORS is a browser mechanism and does not protect against non-browser callers anyway.

---

## Adding a new feature

The typical contribution touches these layers:

1. **Server route** — add a handler under `src/server/routes/`, register it in `src/server/routes/index.ts`, and write a Vitest test in `tests/server/`.
2. **Client hook** — add a `use*.ts` file in `src/client/hooks/` using `fetch` or TanStack Query.
3. **UI component** — add a component in the appropriate `src/client/components/` subdirectory using Tailwind CSS only (no inline styles, no CSS modules).
4. **Wire into `App.tsx`** — the root layout manages which panels are open and registers global keyboard shortcuts.
5. **E2E test** — add a Playwright spec in `tests/e2e/` covering the golden path and at least one error/edge case.

---

## Adding a new database dialect

dbpeek currently supports four dialects: `postgres`, `mysql`, `sqlite`, `mssql`. TypeScript's exhaustiveness checking means the compiler will flag every `Record<Dialect, ...>` or exhaustive `switch` that is missing the new value — follow the compile errors as a checklist.

The files to update are:

1. **`src/types/connection.ts`** — add the new string to the `Dialect` union and to `DEFAULT_PORTS`.
2. **`src/server/db.ts`** — add the dialect → knex client mapping to `DIALECT_TO_KNEX_CLIENT`. Add a branch in `buildNetworkConnection` if the driver uses a non-standard connection object shape.
3. **`src/cli/index.ts`** — add the new value to the `valid` array inside `parseDialect`.
4. **`src/server/routes/schema/handlers/<dialect>.ts`** — implement the schema query for the new driver (see `postgres.ts` as the reference).
5. **`src/server/routes/explain/parsers/<dialect>.ts`** — implement the EXPLAIN output parser.
6. **`src/server/routes/query/pid.ts`** — add the PID query (or return `null` if cancellation is unsupported).
7. **`tests/server/`** — add tests for the new dialect's schema handler, explain parser, and PID query.
