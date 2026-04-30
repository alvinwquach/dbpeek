import { defineConfig } from "tsup";

// tsup bundles CLI + server into dist/ for npm distribution.
// The React frontend is built separately by Vite into dist/client/.
// When a user runs 'npx dbpeek', Node executes dist/cli/index.js.

export default defineConfig({
  // ── Entry points ────────────────────────────────────────────────────────────
  //
  // Each key becomes an independent output file in dist/.
  // We keep the CLI and the server as separate entry points so that:
  //   • Advanced users can `require('dbpeek')` to embed just the server
  //     in their own Node program without pulling in the CLI scaffolding.
  //   • Tree-shaking works per-entry, keeping each bundle minimal.
  entry: {
    // dist/cli/index.js — the file executed by `npx dbpeek`
    "cli/index": "src/cli/index.ts",

    // dist/server/index.js — the programmatic API surface
    "server/index": "src/server/index.ts",
  },

  // ── Output format ───────────────────────────────────────────────────────────
  //
  // "cjs" (CommonJS) is the safest choice for a CLI tool because:
  //   1. Node executes CJS by default when there is no "type": "module" in
  //      package.json, so no file-extension juggling is needed.
  //   2. The knex ecosystem and many database drivers still ship CJS; mixing
  //      CJS packages into a native-ESM bundle causes dynamic-import overhead
  //      and occasional interop bugs.
  //   3. CJS __dirname works without a polyfill, which simplifies path
  //      resolution when the CLI needs to locate dist/client/ at runtime.
  //
  // If we later want to also ship an ESM bundle (e.g. for tree-shaking by
  // application bundlers), we can add "esm" here and tsup will emit both.
  format: ["cjs"],

  // ── TypeScript declarations ──────────────────────────────────────────────────
  //
  // Emitting .d.ts files lets TypeScript consumers of the programmatic API
  // (src/server/index.ts) get full type information without shipping the raw
  // source. The CLI entry does not need declarations because it is never
  // imported as a library.
  dts: true,

  // ── Source maps ──────────────────────────────────────────────────────────────
  //
  // Inline source maps are embedded in the JS file rather than emitted as
  // separate .map files. This keeps the npm tarball simple (no extra files to
  // track) while still allowing Node's --enable-source-maps flag and
  // tools like source-map-support to show original TypeScript line numbers in
  // stack traces.
  sourcemap: true,

  // ── Output directory ─────────────────────────────────────────────────────────
  //
  // dist/ is the root for all Node-side output.
  //   dist/cli/index.js    ← CLI entry point
  //   dist/server/index.js ← server library
  //   dist/client/         ← Vite output (not managed by tsup)
  //
  // npm's "files" allowlist in package.json whitelists only dist/, so nothing
  // outside it ends up in the published tarball.
  outDir: "dist",

  // ── Clean on build ───────────────────────────────────────────────────────────
  //
  // Wipe dist/ before every production build to prevent stale files from a
  // previous build from silently shipping. We intentionally exclude dist/client/
  // here so a `npm run build` (Node side) does not destroy a previously-built
  // Vite output — run `npm run build:all` to rebuild everything from scratch.
  clean: true,

  // ── Splitting ────────────────────────────────────────────────────────────────
  //
  // Code splitting emits shared chunks when multiple entry points import the
  // same module. We disable it here because:
  //   • We only have two entry points and they share very little code.
  //   • Splitting produces additional chunk files that complicate the "files"
  //     allowlist and the runtime require() graph.
  // Re-enable if profiling shows significant duplication between cli/ and
  // server/ bundles.
  splitting: false,

  // ── Shims ────────────────────────────────────────────────────────────────────
  //
  // shims: true tells tsup to inject format-bridging globals so that code
  // written with one module system's idioms compiles cleanly to the other:
  //
  //   CJS output (our case): tsup injects a banner that defines import.meta.url
  //     as `require("url").pathToFileURL(__filename).href`. This makes the
  //     src/server/index.ts __dirname shim (fileURLToPath(import.meta.url))
  //     work correctly at runtime and silences esbuild's "import.meta will be
  //     empty" warning.
  //
  //   ESM output (not used here): tsup would instead inject __dirname,
  //     __filename, and require — the CJS globals that don't exist in native ESM.
  //
  // Without this, esbuild replaces import.meta with {} in CJS output, so
  // import.meta.url is undefined and fileURLToPath(undefined) throws a TypeError
  // the moment the server module is first required.
  shims: true,

  // ── External packages ────────────────────────────────────────────────────────
  //
  // Packages listed here are NOT bundled — they remain as require() calls in
  // the output and are resolved from node_modules at runtime.
  //
  // We mark the native database drivers as external because:
  //   • They contain native .node binaries (better-sqlite3, pg) that cannot
  //     be bundled into a JS file.
  //   • Bundling knex itself is also unnecessary since it's always present in
  //     node_modules; leaving it external keeps the bundle small and avoids
  //     duplicate knex instances (which would break the shared connection pool).
  //
  // Everything in "dependencies" in package.json is automatically external
  // when noExternal is not set; this list makes the intent explicit.
  external: [
    "knex",
    "pg",
    "mysql2",
    "better-sqlite3",
    "tedious",
    "express",
    "cors",
    "open",
    "commander",
  ],

  // ── esbuild options ──────────────────────────────────────────────────────────
  //
  // tsup delegates to esbuild for the actual transform. These options are
  // passed through verbatim.
  esbuildOptions(options) {
    // target must match tsconfig.json so that esbuild and tsc agree on what
    // syntax is valid. "node18" is shorthand for the ES feature set that
    // Node 18 LTS supports natively.
    options.target = "node18";
  },
});
