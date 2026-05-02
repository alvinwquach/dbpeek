/**
 * tests/e2e/query-execution.spec.ts — Core query execution E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The main query flow: type SQL into CodeMirror, press Cmd+Enter, wait for
 *   POST /api/query to resolve, and verify the results header shows the correct
 *   row count.
 *
 * ===== WHY CMD+ENTER (NOT THE RUN BUTTON) =====
 *
 *   Cmd+Enter is the primary power-user interaction for dbpeek. Testing it
 *   exercises the CodeMirror keymap binding, the execute() hook, and the
 *   result-to-store write all at once. The Run button is covered implicitly
 *   by other spec files that use runQuery().
 *
 * ===== CODEMIRROR TYPING =====
 *
 *   See helpers.ts for the explanation of why we use keyboard events instead
 *   of Playwright's fill() on the CodeMirror editor.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("query execution", () => {
  /**
   * The baseline smoke test: SELECT all users and expect 3 rows — one per
   * seed row in the fixture database.
   */
  test("runs SELECT * FROM users on Cmd+Enter and shows 3 rows", async ({ page }) => {
    await page.goto("/");

    // Wait for the app to be ready (status bar resolved = /api/status complete)
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");

    // ResultsHeader renders "3 rows" after the query succeeds
    await waitForRowCount(page, 3);
  });

  /**
   * Verifies that the result set data (not just the row count) appears in
   * the results table after a projection query.
   */
  test("shows query result data in the results table", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT name, email FROM users");
    await waitForRowCount(page, 3);

    // The fixture seeds "Alice Smith" and "Bob Jones" — both should be visible
    await expect(page.getByText("Alice Smith")).toBeVisible();
    await expect(page.getByText("Bob Jones")).toBeVisible();
  });

  /**
   * Verifies that a WHERE clause produces the correct reduced row count.
   * Carol White has active=0 in the fixture; the other two users have active=1.
   */
  test("displays correct row count for a filtered query", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users WHERE active = 0");
    await waitForRowCount(page, 1);
  });
});
