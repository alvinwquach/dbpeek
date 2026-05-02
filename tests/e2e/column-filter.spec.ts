/**
 * tests/e2e/column-filter.spec.ts — Column filter E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   ResultsTable renders a filter row below the column headers. Each column has
 *   an <input aria-label="Filter {colName}"> that narrows the visible rows.
 *   Filtering is client-side only — no new server request is made.
 *
 * ===== ROW COUNT DISPLAY =====
 *
 *   ResultsHeader shows:
 *     "3 rows"       — no active filters (or all rows match)
 *     "1 of 3 rows"  — filteredRowCount differs from result.rowCount
 *
 *   Tests assert on these strings to confirm the filter is wired to the
 *   virtualiser's filtered row model.
 *
 * ===== CLEAR FILTERS BUTTON =====
 *
 *   ResultsHeader renders a "Clear all column filters" button (aria-label)
 *   when at least one filter is active. Clicking it resets all column filter
 *   values to empty strings, restoring the full row count.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("column filter", () => {
  /**
   * Types "Alice" into the "name" column filter and expects the row count
   * display to update to "1 of 3 rows" (only Alice Smith matches).
   */
  test("filters rows by text value and updates the row count display", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    // Filter input is rendered in the second <thead> row of ResultsTable.tsx
    const filterInput = page.getByLabel("Filter name");
    await filterInput.fill("Alice");

    // Only Alice Smith matches; header updates to "1 of 3 rows"
    await expect(page.getByText("1 of 3 rows")).toBeVisible({ timeout: 5_000 });
  });

  /**
   * Applies a filter to narrow results, then clicks "Clear all column filters"
   * and verifies the full row count is restored.
   */
  test("clear filters button restores the full row count", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    // Apply a filter to reduce visible rows
    await page.getByLabel("Filter name").fill("Bob");
    await expect(page.getByText("1 of 3 rows")).toBeVisible({ timeout: 5_000 });

    // Clear all filters — button appears in ResultsHeader when filters are active
    await page.getByRole("button", { name: "Clear all column filters" }).click();

    // Full row count is restored; the filtered count label disappears
    await expect(page.getByText("3 rows")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("1 of 3 rows")).not.toBeVisible();
  });
});
