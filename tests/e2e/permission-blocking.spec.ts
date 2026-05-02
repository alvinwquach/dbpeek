/**
 * tests/e2e/permission-blocking.spec.ts — Permission mode E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The test server runs in readonly mode (permissionMode: 'readonly'). Any
 *   non-SELECT statement should return a permission error that the DataGrid
 *   renders as a red ✕ error banner.
 *
 * ===== WHY TEST BOTH INSERT AND CREATE TABLE =====
 *
 *   The server's permission check distinguishes DML (INSERT / UPDATE / DELETE)
 *   from DDL (CREATE / DROP / ALTER). Testing both statement classes confirms
 *   neither bypasses the readonly gate.
 *
 * ===== WHY ASSERT ON "✕" (NOT ON AN ERROR MESSAGE STRING) =====
 *
 *   The exact wording of the permission error message may change over time.
 *   Asserting on the DataGrid error UI pattern (the ✕ icon) is more stable
 *   while still verifying the error path executed.
 *
 * ===== DATA GRID ERROR STATE =====
 *
 *   DataGrid.tsx renders in its error state:
 *     <span className="shrink-0 mt-px">✕</span>
 *     <span className="break-all">{error}</span>
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("permission blocking", () => {
  /**
   * Attempts an INSERT statement and expects the DataGrid ✕ error indicator
   * to appear, confirming the readonly gate rejected the statement.
   */
  test("blocks an INSERT statement with a permission error in readonly mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(
      page,
      "INSERT INTO users (id, name, email, age, active) VALUES (99, 'Test', 't@t.com', 20, 1)"
    );

    // DataGrid error state renders a ✕ icon
    await expect(page.locator("text=✕").first()).toBeVisible({ timeout: 8_000 });

    // The INSERT did not produce a result set, so no row count should appear
    await expect(page.getByText("99 rows")).not.toBeVisible();
  });

  /**
   * Attempts a CREATE TABLE DDL statement and expects the DataGrid ✕ error
   * indicator to appear, confirming DDL is also blocked in readonly mode.
   */
  test("blocks a CREATE TABLE statement with a permission error in readonly mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "CREATE TABLE blocked_table (id INTEGER PRIMARY KEY)");

    await expect(page.locator("text=✕").first()).toBeVisible({ timeout: 8_000 });
  });

  /**
   * Verifies that SELECT queries are allowed even in readonly mode — confirms
   * the permission gate only blocks write statements, not reads.
   */
  test("allows SELECT queries in readonly mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM tags");
    await waitForRowCount(page, 3);

    // No error indicator should appear for a successful SELECT
    await expect(page.locator("text=✕").first()).not.toBeVisible();
  });
});
