/**
 * vitest.client.config.ts
 *
 * WHAT:
 *   Separate Vitest configuration for client-side (React/browser) unit tests.
 *
 * WHY a second config file instead of merging with vitest.config.ts:
 *   The server tests run in the "node" environment — they use real HTTP, Knex,
 *   and Node built-ins. The client tests need a browser-like DOM environment
 *   (jsdom) for APIs like document.createElement and URL.createObjectURL.
 *   Vitest does not support mixing environments in a single config file without
 *   per-file docblock overrides, and mixing concerns makes the config harder to
 *   read. Two focused configs is cleaner.
 *
 * RUNNING CLIENT TESTS:
 *   npx vitest run --config vitest.client.config.ts
 *   npx vitest --config vitest.client.config.ts   (watch mode)
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // ── Environment ────────────────────────────────────────────────────────────
    //
    // "jsdom" provides window, document, Blob, URL.createObjectURL, and other
    // browser globals. Required for testing client-side export logic that calls
    // document.createElement("a") and URL.createObjectURL().
    environment: "jsdom",

    // ── Test file glob ─────────────────────────────────────────────────────────
    //
    // Only pick up files in tests/client/ so this config never accidentally
    // runs server tests (which would fail without the Node environment).
    include: ["tests/client/**/*.{test,spec}.ts"],

    // ── Coverage ───────────────────────────────────────────────────────────────
    //
    // Coverage is scoped to the client source tree to avoid inflating server
    // coverage numbers with browser-only code, or vice versa.
    coverage: {
      provider: "v8",
      include: ["src/client/**/*.ts", "src/client/**/*.tsx"],
      exclude: ["src/client/**/*.d.ts"],
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/client",
    },

    // ── Timeout ────────────────────────────────────────────────────────────────
    //
    // Client unit tests are pure-logic (no I/O, no network), so 5 s is plenty.
    testTimeout: 5_000,
  },
});
