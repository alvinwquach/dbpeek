/**
 * tests/e2e/column-sort.spec.ts — Column sort E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   ResultsTable uses TanStack Table's getSortedRowModel for client-side sort.
 *   Clicking a column header toggles through: none → ascending → descending.
 *   The `aria-sort` attribute on the <th> reflects the current sort direction.
 *
 * ===== WHY ARIA-SORT =====
 *
 *   Using the semantic `aria-sort` attribute as the assertion target verifies
 *   both the DOM accessibility state (correct ARIA) and the TanStack sort state
 *   (correct implementation) in one assertion. A "sorted but unlabelled" table
 *   would fail this test, which is the right outcome.
 *
 * ===== SORT CYCLE =====
 *
 *   First click  → ascending
 *   Second click → descending
 *   Third click  → unsorted (no aria-sort attribute)
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("column sort", () => {
  /**
   * Clicks the "name" header once and expects aria-sort="ascending".
   */
  test("sorts a text column ascending on first header click", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    // ResultsTable.tsx sets aria-sort on <th> driven by column.getIsSorted()
    const nameHeader = page.getByRole("columnheader", { name: "name" });
    await nameHeader.click();

    await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  });

  /**
   * Clicks the "name" header twice and expects aria-sort="descending" on the
   * second click (the sort cycle progresses none → asc → desc).
   */
  test("sorts a text column descending on second header click", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    const nameHeader = page.getByRole("columnheader", { name: "name" });

    await nameHeader.click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");

    await nameHeader.click();
    await expect(nameHeader).toHaveAttribute("aria-sort", "descending");
  });

  /**
   * Verifies that a numeric column also receives the aria-sort attribute after
   * a header click, confirming sort works for non-text column types.
   */
  test("sorts a numeric column and updates aria-sort", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT id, age FROM users");
    await waitForRowCount(page, 3);

    const ageHeader = page.getByRole("columnheader", { name: "age" });
    await ageHeader.click();

    await expect(ageHeader).toHaveAttribute("aria-sort", "ascending");
  });
});
