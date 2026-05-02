/**
 * playwright.config.ts — Playwright E2E test configuration.
 *
 * ===== OVERVIEW =====
 *
 * WHAT:
 *   Playwright test runner configuration for dbpeek's end-to-end test suite.
 *   Sets up a test server (Express + SQLite fixture), configures Chromium as
 *   the sole browser, and maps baseURL to the test server port.
 *
 * WHY a dedicated test server instead of mocking:
 *   E2E tests verify the full user journey — React rendering, API calls,
 *   CodeMirror interaction, file downloads. Unit mocks can't cover that surface.
 *   A real Express server driven by a real SQLite fixture database produces
 *   deterministic, testable behavior with zero mocking overhead.
 *
 * HOW it works:
 *   1. `webServer` launches tests/e2e/start-server.cjs before any test runs.
 *      That script creates a fresh SQLite fixture DB (users / posts / tags),
 *      starts Express on port 4747, and serves the built client from dist/client/.
 *   2. Playwright waits for http://localhost:4747 to return a 200-family status.
 *   3. Each test navigates to baseURL and interacts with the live app.
 *
 * ===== PREREQUISITES =====
 *   Run the following before `npm run test:e2e`:
 *     npm run build:all         — compiles server (dist/server/) + client (dist/client/)
 *     npx playwright install chromium   — downloads the Chromium browser binary
 *
 * ===== PORT CHOICE =====
 *   Port 4747 is deliberately chosen to avoid collisions with common dev ports:
 *     3000 — Express server (dbpeek default)
 *     4000 — Vite dev proxy target
 *     5173 — Vite dev server
 */

import { defineConfig, devices } from "@playwright/test";

// ===== CONSTANTS =====

/**
 * Port the test Express server binds to.
 *
 * WHY 4747: avoids the common development ports (3000, 4000, 5173) so the
 * E2E server doesn't collide with a developer's running dev environment.
 */
const TEST_SERVER_PORT = 4747;

// ===== CONFIG =====

export default defineConfig({
  // ── Test discovery ──────────────────────────────────────────────────────────

  /**
   * Where Playwright looks for test files.
   * We keep E2E tests separate from unit tests (tests/server, tests/client)
   * so `vitest run` and `playwright test` never scan each other's directories.
   */
  testDir: "./tests/e2e",

  /**
   * Only match files that end in .spec.ts — avoids accidentally picking up
   * the server bootstrap (start-server.cjs) or fixture helpers.
   */
  testMatch: "**/*.spec.ts",

  // ── Execution ───────────────────────────────────────────────────────────────

  /**
   * Timeout per individual test (30 s).
   * Network requests to a local Express server should complete in < 1 s,
   * but CodeMirror rendering and React Query fetches add a few hundred ms each.
   * 30 s is generous without masking genuinely stuck tests.
   */
  timeout: 30_000,

  /**
   * Retry failed tests twice on CI, zero times locally.
   * Retries compensate for headless timing flakiness in CI environments
   * (shared VMs, lower CPU speed). Locally, instant failure is faster feedback.
   */
  retries: process.env.CI ? 2 : 0,

  /**
   * Parallelism: Playwright runs tests across workers. We limit to 1 worker
   * for E2E to keep the single test server's SQLite state deterministic.
   * Parallel write access to one SQLite file can cause SQLITE_BUSY errors.
   */
  workers: 1,

  // ── Reporter ────────────────────────────────────────────────────────────────

  /**
   * "list" outputs one line per test in the terminal, which is easy to scan.
   * In CI we also emit an HTML report so failures have full trace context.
   */
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  // ── Shared browser options ───────────────────────────────────────────────────

  use: {
    /**
     * All tests navigate relative to this URL so they don't need to hard-code
     * the port number. e.g. `page.goto('/')` becomes http://localhost:4747/.
     */
    baseURL: `http://localhost:${TEST_SERVER_PORT}`,

    /**
     * Collect a trace on the first retry of a failing test.
     * Traces are inspectable with `npx playwright show-trace` and contain
     * screenshots, network requests, and DOM snapshots at every step.
     */
    trace: "on-first-retry",

    /**
     * Grant clipboard-read/write permissions so tests can verify copy
     * operations without a browser permission prompt blocking execution.
     */
    permissions: ["clipboard-read", "clipboard-write"],
  },

  // ── Browser projects ────────────────────────────────────────────────────────

  projects: [
    {
      /**
       * Chromium is the primary browser for dbpeek's E2E suite.
       *
       * WHY Chromium only (not Firefox / WebKit):
       *   dbpeek targets developers who use Chrome/Edge by default when
       *   accessing local tooling. Maintaining multi-browser E2E suites
       *   multiplies CI cost without adding proportionate coverage for a
       *   CLI dev tool. Firefox and WebKit can be added as projects later
       *   if distribution use cases broaden.
       */
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // ── Web server ──────────────────────────────────────────────────────────────

  /**
   * Launches the test Express server before any test file runs.
   *
   * WHAT start-server.cjs does:
   *   1. Checks that dist/server/index.cjs exists (fails fast if build is stale).
   *   2. Creates a fresh SQLite database at tests/e2e/fixtures/test.db
   *      with users / posts / tags tables and seed data.
   *   3. Creates a Knex instance for that file.
   *   4. Calls createApp(config, db) to build the Express application.
   *   5. Binds http.Server to port 4747 and logs a ready message.
   *   6. Serves the built frontend from dist/client/.
   *
   * WHY reuseExistingServer on non-CI:
   *   During development a developer may already have the test server running
   *   from a previous run. Reusing it saves the ~2 s startup time per run.
   *   On CI, we never reuse to guarantee a fresh SQLite fixture each time.
   *
   * WHY stdout/stderr: "pipe":
   *   Piping suppresses the server's console output in the terminal so it
   *   doesn't interfere with Playwright's own output. Playwright captures it
   *   and includes it in HTML reports for debugging failed test runs.
   */
  webServer: {
    command: "node tests/e2e/start-server.cjs",
    url: `http://localhost:${TEST_SERVER_PORT}`,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  },
});
