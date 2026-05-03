# Contributing to dbpeek

Thanks for your interest. Contributions are welcome.

## Before you start

For non-trivial changes, please open an issue first to discuss the approach. This avoids wasted work on PRs that won't be merged.

Bug fixes, documentation improvements, and small refactors don't need prior discussion — just open the PR.

## Development setup

```bash
git clone https://github.com/alvinwquach/dbpeek
cd dbpeek
npm install
```

Run the two watchers in separate terminals:

```bash
npm run dev          # CLI + server (tsup watch → dist/)
npm run build:client # React frontend (vite build)
```

Then in a third terminal, launch dbpeek against any database you have available:

```bash
node dist/cli/index.cjs -d sqlite -D /tmp/test.db
node dist/cli/index.cjs "postgres://user:pass@localhost:5432/dev"
```

## Testing

```bash
npm test           # Run Vitest suite (unit + integration)
npm run test:watch # Watch mode
npx playwright test # Playwright end-to-end tests
npm run typecheck  # TypeScript
npm run lint       # ESLint
npm run format     # Prettier
```

All PRs must pass CI: tests, typecheck, and lint.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(server): add EXPLAIN plan support for MSSQL
fix(client): close history panel on Escape key
docs(readme): clarify SSL connection examples
refactor(cli): extract argument parsing into separate module
```

## Pull requests

- Branch from `main`, named like `feat/...`, `fix/...`, `docs/...`
- Keep PRs focused — one logical change per PR
- Update tests when changing behaviour
- Update README/docs when changing user-facing features

## What gets accepted

✅ Bug fixes  
✅ Performance improvements  
✅ Test coverage improvements  
✅ Documentation  
✅ Dialect-specific fixes (Postgres, MySQL, SQLite, MSSQL)  
✅ Accessibility improvements  

❌ Features that require persisting data to disk (breaks privacy model)  
❌ Features that require external API calls (breaks privacy model)  
❌ NoSQL database support (out of scope)  
❌ Collaborative / multi-user features (out of scope)  
❌ Major architectural changes without prior discussion  

## Architecture & advanced topics

For details on the codebase architecture, security model, and how to add new database dialects, see [docs/architecture.md](docs/architecture.md).

## Code of conduct

Be kind. Be patient. Assume good faith.

## License

By contributing, you agree your contributions will be licensed under MIT.
