import { defineConfig } from "vitest/config";

// Vitest is used exclusively for the Node-side unit tests (tests/server/).
// Playwright handles end-to-end tests (tests/e2e/) through its own runner.
//
// Vitest shares Vite's transform pipeline, so TypeScript files are processed
// by esbuild without any additional configuration.

export default defineConfig({
  test: {
    // ── Environment ────────────────────────────────────────────────────────────
    //
    // "node" runs tests in a Node.js environment (via vm.Module) rather than
    // a browser-like environment (jsdom/happy-dom). Since all server-side code
    // talks to databases and file system, Node is the only correct choice here.
    //
    // The React client tests (once added) will use a separate vitest config
    // with environment: "jsdom" or "happy-dom".
    environment: "node",

    // ── Test file glob ─────────────────────────────────────────────────────────
    //
    // Only pick up files inside tests/server/. This prevents Vitest from
    // accidentally running Playwright spec files (tests/e2e/) which have an
    // incompatible API and would produce confusing errors.
    include: ["tests/server/**/*.{test,spec}.ts"],

    // ── Coverage ───────────────────────────────────────────────────────────────
    //
    // `vitest run --coverage` will emit an lcov report into coverage/.
    // We collect coverage only from src/server/ because the CLI entry point
    // (src/cli/) is integration-tested via e2e tests, not unit tests.
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts"],
      exclude: [
        // Type-only files have no executable code to measure.
        "src/server/**/*.d.ts",
      ],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
    },

    // ── Global setup ───────────────────────────────────────────────────────────
    //
    // setupFiles run once per worker process before any test suite.
    // Add a setup file here when we need to configure the test database
    // connection or load environment variables from a .env.test file.
    // setupFiles: ["tests/server/setup.ts"],

    // ── Timeout ────────────────────────────────────────────────────────────────
    //
    // Default test timeout is 5 s. Database integration tests that spin up
    // a real connection may need longer; override per-test with
    // `test('...', { timeout: 15_000 }, async () => { ... })`.
    testTimeout: 5_000,
  },
});
