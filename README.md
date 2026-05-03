# dbpeek

**Privacy-first SQL client in your browser. One `npx` command, zero installs, nothing stored.**

[![npm version](https://img.shields.io/npm/v/dbpeek.svg)](https://www.npmjs.com/package/dbpeek)
[![npm downloads](https://img.shields.io/npm/dw/dbpeek.svg)](https://www.npmjs.com/package/dbpeek)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/dbpeek.svg)](https://nodejs.org)

dbpeek is a database explorer that runs locally from a single `npx` command. It opens a browser-based SQL editor with schema-aware autocomplete, EXPLAIN plan visualization, ERD diagrams, and inline cell editing — supporting PostgreSQL, MySQL, SQLite, and MSSQL through a single unified interface.

Database credentials live only in process memory and are freed when the process exits. Nothing is written to disk. Nothing is transmitted off your machine.

```bash
npx dbpeek "postgres://user:pass@localhost:5432/mydb"
```

---

<!--
Replace with a 30-second screen recording showing:
1. npx dbpeek command in terminal
2. Browser opens automatically
3. Click a table in the sidebar (schema preview)
4. Type a query with autocomplete suggesting columns
5. Cmd+Enter to run, results appear
6. Toggle to chart view
Recommended: 1200×750, 30fps, <4 MB
-->

![dbpeek demo](docs/demo.gif)

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/editor.png" alt="SQL editor with schema sidebar and query results" width="360"/><br/><sub>Editor + results</sub></td>
    <td align="center"><img src="docs/screenshots/explain.png" alt="EXPLAIN plan tree with cost-coloured nodes" width="360"/><br/><sub>EXPLAIN plan tree</sub></td>
    <td align="center"><img src="docs/screenshots/erd.png" alt="Entity-relationship diagram with FK edges" width="360"/><br/><sub>ERD diagram</sub></td>
  </tr>
</table>

---

## Why dbpeek?

Most database GUIs require installation, account creation, and persist your credentials to disk in encrypted-but-decryptable formats. They send telemetry, require account verification, or sync your queries to cloud services.

dbpeek does none of that. Run one command, explore your data, close the terminal — done. Credentials never leave RAM. Query history dies with the process. There is no account, no sync, no telemetry.

It's built for the moment when you need to look at a database — not for the team workflow, not for the admin tooling, not for the production dashboard. Just for the look.

---

## Quickstart

Requires **Node 18+**. No global install needed.

```bash
# PostgreSQL
npx dbpeek "postgres://user:pass@localhost:5432/mydb"

# MySQL
npx dbpeek "mysql://root:password@127.0.0.1:3306/shop"

# SQLite
npx dbpeek -d sqlite -D /path/to/database.db

# MSSQL
npx dbpeek "mssql://sa:password@localhost:1433/mydb"
```

Browser opens to `http://localhost:3000` automatically. Start querying.

---

## Features

### Editor

SQL editor with schema-aware autocomplete, multi-tab queries, parameterized query bindings, and a keyboard-driven workflow. Format, comment, and run selections with familiar shortcuts. Cancel long-running queries with one keystroke — dbpeek issues `pg_cancel_backend` (or the dialect equivalent) on a separate connection so the UI stays responsive.

`CodeMirror 6` · `Multi-tab` · `Autocomplete` · `Parameter binding` · `Query cancel`

### Schema browsing

Live schema tree with primary keys, foreign keys, and indexes. Click any column for distinct counts, null percentages, min/max, and top values. Right-click any table for the full `CREATE TABLE` statement. Switch to ERD view for an auto-laid-out diagram of all foreign-key relationships.

`Live introspection` · `Column stats` · `DDL viewer` · `ERD canvas`

### Results

Virtualized data grid handling millions of rows at native scroll speed. Per-column sorting, filtering, and resizing. Click any cell for a full-screen value viewer with JSON pretty-printing and binary hex display. Export to CSV or Excel with one click.

`TanStack Table` · `Column filtering` · `Value viewer` · `CSV / Excel export`

### Query analysis

EXPLAIN plan visualization with color-coded cost trees across all four dialects. Bar and line charts auto-detected from result columns. Query history panel showing every query you ran with timestamps and execution time — searchable and clickable, in-memory only.

`EXPLAIN trees` · `Charts` · `History panel` · `Session reports`

### Data modification *(opt-in)*

Inline cell editing with a live `UPDATE` preview before execution. CSV and JSON bulk import in a single transaction with column mapping. Schema diff and data diff for comparing two tables or two query results side-by-side.

Requires `--write` or `--full` mode at launch. **Read-only by default.**

`Inline editing` · `Bulk import` · `Schema diff` · `Data diff`

### Privacy & distribution

No installation, no account, no telemetry. Database credentials exist only in server process memory and are freed when the process exits. Read-only by default; write and full modes are opt-in via CLI flag. Runs via `npx`, `pnpm dlx`, or `bunx` — one command anywhere Node is installed.

`Zero install` · `Zero persistence` · `Permission gating` · `MIT licensed`

---

## Privacy comparison

| Tool | Runs locally | Sends queries off-machine | Persists query history | Requires account |
|------|:------------:|:-------------------------:|:----------------------:|:----------------:|
| **dbpeek** | ✅ | ❌ | ❌ memory only | ❌ |
| DBeaver | ✅ | ❌ | ✅ disk | ❌ |
| TablePlus | ✅ | ❌ | ✅ disk | ❌ |
| DataGrip | ✅ | ❌ telemetry only | ✅ disk | ✅ |
| pgAdmin 4 | ✅ | ❌ | ✅ disk | ❌ |
| Retool | ❌ | ✅ | ✅ cloud | ✅ |

dbpeek keeps everything in process memory for the duration of the session. When you close the terminal, no credentials, queries, or results are persisted anywhere.

For a detailed audit of how DBeaver, DataGrip, TablePlus, and pgAdmin store credentials, see [docs/credential-audit.md](docs/credential-audit.md).

---

## What dbpeek doesn't do

Knowing what a tool *isn't* is as important as knowing what it is.

- **Save queries between sessions** — query history is in-memory only. Use git for persistence.
- **Sync across devices** — it's a local tool. There is no cloud, no sync, no account.
- **Manage team permissions** — single-user by design. Use a purpose-built tool for team workflows.
- **Replace your migration tool** — for schema changes, use Drizzle, Prisma, Knex, or Flyway.
- **Generate SQL with AI** — the privacy model forbids sending queries to any external service.
- **Connect to NoSQL databases** — MongoDB, Redis, DynamoDB are out of scope. SQL only.

---

## Usage

### Connection strings

```bash
npx dbpeek "postgres://alice:secret@localhost:5432/myapp"
npx dbpeek "mysql://root:password@127.0.0.1:3306/shop"
npx dbpeek "sqlite:///absolute/path/to/database.db"
npx dbpeek "mssql://sa:password@localhost:1433/northwind"
```

### Individual flags

Use flags when the connection string is inconvenient (e.g. passwords with special characters):

```bash
npx dbpeek -d postgres -h db.example.com -P 5432 -D myapp -u alice -p secret
npx dbpeek -d sqlite   -D /home/user/data.db
npx dbpeek -d mysql    -h 127.0.0.1       -D shop  -u root
```

### Permission modes

| Flag | Allows | Use case |
|------|--------|----------|
| *(default)* | `SELECT`, `SHOW`, `EXPLAIN`, `WITH`, `PRAGMA`, `DESCRIBE` | Safe read-only exploration |
| `--write` | + `INSERT`, `UPDATE`, `DELETE`, `REPLACE`, `MERGE`, `UPSERT` | Fixing data |
| `--full` | Everything: `CREATE`, `DROP`, `ALTER`, `TRUNCATE`, `GRANT`, `EXEC`, … | Schema migrations |

The permission mode is set **once at CLI launch** and cannot be changed from the browser. No API endpoint exists to escalate it at runtime.

```bash
npx dbpeek "postgres://..." --write   # allow DML
npx dbpeek "postgres://..." --full    # allow DDL/DCL
```

### All CLI flags

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--dialect` | `-d` | — | `postgres` \| `mysql` \| `sqlite` \| `mssql` |
| `--host` | `-h` | `localhost` | Hostname or IP |
| `--port` | `-P` | dialect default | TCP port |
| `--database` | `-D` | — | Database name or SQLite file path |
| `--user` | `-u` | `""` | Login username |
| `--password` | `-p` | `""` | Login password |
| `--write` | — | off | Enable DML (INSERT, UPDATE, DELETE, …) |
| `--full` | — | off | Enable all SQL, including DDL/DCL |

### Supported databases

| Database | Dialect flag | Default port | Driver |
|----------|-------------|:------------:|--------|
| PostgreSQL ≥ 12 | `postgres` | 5432 | [pg](https://github.com/brianc/node-postgres) |
| MySQL ≥ 5.7 / MariaDB | `mysql` | 3306 | [mysql2](https://github.com/sidorares/node-mysql2) |
| SQLite 3 | `sqlite` | — | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) |
| SQL Server 2017+ | `mssql` | 1433 | [tedious](https://github.com/tediousjs/tedious) |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Enter` | Run query |
| `Cmd/Ctrl+Shift+Enter` | Run selected text |
| `Cmd/Ctrl+Shift+F` | Format SQL |
| `Cmd/Ctrl+/` | Toggle line comment |
| `Cmd/Ctrl+E` | Show EXPLAIN plan |
| `Cmd/Ctrl+H` | Toggle query history panel |
| `Cmd/Ctrl+D` | Open session report |
| `Cmd/Ctrl+.` | Cancel in-flight query |
| `Cmd/Ctrl+T` | New query tab |
| `Cmd/Ctrl+W` | Close active tab |

---

## Troubleshooting

**`Cannot find module 'better-sqlite3'`**
better-sqlite3 is a native module that compiles against your Node version. If install fails, ensure you have Python and a C++ toolchain installed (`xcode-select --install` on macOS, `build-essential` on Ubuntu).

**`EADDRINUSE: address already in use :::3000`**
dbpeek tries ports 3000–3010 automatically. If all are taken, kill the conflicting process or restart your machine.

**`Connection refused` with localhost Postgres**
Try `127.0.0.1` instead of `localhost`. Some Postgres configurations don't listen on the IPv6 loopback (`::1`) that `localhost` resolves to on newer systems.

**SSL/TLS errors with Supabase, Neon, or hosted Postgres**
Add `?sslmode=require` to your connection string.

**Browser doesn't open automatically**
Navigate to the URL printed in the terminal manually. Auto-open relies on the `open` package, which sometimes fails silently on Linux desktops without a display server.

---

## FAQ

**Is it free?**
Yes. MIT licensed. Always free.

**What operating systems are supported?**
macOS, Linux, and Windows (including WSL). Anywhere Node.js 18+ runs.

**Can I use it with Docker?**
Yes. Connect to any host accessible from your machine — including Docker containers via their published ports.

**Where are my credentials stored?**
Nowhere. They exist in the server process memory only and are freed when the process exits. Nothing is written to disk.

**How is this different from `psql` or the `mysql` CLI?**
Terminal SQL clients are great for one-off queries. dbpeek adds visual schema browsing, EXPLAIN plan trees, column statistics, multi-tab queries, and one-click exports — without losing the "open and close" workflow.

**Can a non-developer use this?**
If they can run a terminal command, yes. The browser UI is the same as any database GUI once it opens.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  npx dbpeek "postgres://..."                                    │
│                                                                 │
│  src/cli/index.ts                                               │
│    1. Parse argv → ConnectionConfig                             │
│    2. createKnexInstance(config)   ← src/server/db.ts           │
│    3. testConnection(db)           ← validates credentials      │
│    4. createServer(config, db)     ← src/server/index.ts        │
│    5. http.listen(3000–3010)       ← port fallback              │
│    6. open browser                                              │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP (localhost only)
          ┌───────────────▼──────────────────────────┐
          │  Express (src/server/routes/)            │
          │  POST /api/query      ← SQL execution    │
          │  POST /api/query/cancel ← kill backend   │
          │  GET  /api/schema     ← table + column   │
          │  GET  /api/schema/:t  ←   metadata       │
          │  POST /api/explain    ← EXPLAIN tree      │
          │  PUT  /api/data/:t    ← cell editing      │
          │  POST /api/import     ← CSV/JSON import   │
          │  GET  /api/status     ← connection info   │
          │  GET  /api/health     ← uptime probe      │
          └───────────────┬──────────────────────────┘
                          │
          ┌───────────────▼──────────────────────────┐
          │  React SPA (src/client/)                  │
          │  Zustand store  ← tabs, history, schema  │
          │  TanStack Table ← virtualized data grid  │
          │  CodeMirror 6   ← SQL editor             │
          │  ReactFlow      ← ERD canvas             │
          │  Recharts       ← bar / line charts      │
          └──────────────────────────────────────────┘
```

**Security boundary:** `src/server/permissions.ts` validates every SQL string before it reaches the database driver. The permission mode is an immutable closure set at startup — no browser request can change it.

For implementation details — security model, query cancellation internals, multi-tab state, and how to add new dialects — see [docs/architecture.md](docs/architecture.md).

---

## Status

dbpeek is **v1.0 stable**. Used by individual developers for exploring databases. Not designed for shared/team workflows or as a DBA-grade tool.

Active development areas:
- DuckDB support (planned)
- Improved EXPLAIN plan visualization
- Additional dialect-specific introspection refinements

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, testing conventions, and what kinds of changes are in scope.

---

## Built with

- [CodeMirror 6](https://codemirror.net/) — SQL editor
- [TanStack Table](https://tanstack.com/table) — virtualized data grid
- [TanStack Virtual](https://tanstack.com/virtual) — row virtualization
- [TanStack Query](https://tanstack.com/query) — data fetching
- [ReactFlow](https://reactflow.dev/) — ERD canvas
- [Recharts](https://recharts.org/) — chart visualization
- [Knex](https://knexjs.org/) — multi-dialect connection management
- [Express](https://expressjs.com/) — HTTP server
- [Zustand](https://zustand-demo.pmnd.rs/) — client state
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [tsup](https://tsup.egoist.dev/) — CLI bundling
- [Vite](https://vitejs.dev/) — frontend bundling
- [Vitest](https://vitest.dev/) — unit and integration testing
- [Playwright](https://playwright.dev/) — end-to-end testing

---

## License

[MIT](LICENSE) — © 2026 Alvin Quach
