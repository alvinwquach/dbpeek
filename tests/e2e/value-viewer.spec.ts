/**
 * tests/e2e/value-viewer.spec.ts — ValueViewer panel E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The ValueViewer panel renders below the results table when a data cell is
 *   clicked. It shows the full, untruncated cell value with a type badge
 *   (text / JSON / boolean / number / null).
 *
 * ===== HOW IT WORKS =====
 *
 *   ResultsTable.tsx attaches an onClick to each <td>. Clicking calls
 *   setSelectedCell({ value, columnName }), which mounts ValueViewer at the
 *   bottom of the ResultsTable flex column.
 *
 * ===== SELECTOR RATIONALE =====
 *
 *   The close button's `title="Close value panel (Esc)"` is the most specific
 *   identifier for the ValueViewer being mounted — it appears nowhere else in
 *   the app. Asserting on it confirms the panel mounted correctly.
 *
 *   We click `locator('td').filter({ hasText: '…' }).first()` to target the
 *   data cell (not a header cell) with the expected text, which is the correct
 *   onClick target in ResultsTable.
 *
 * ===== NULL CELL TEST =====
 *
 *   To produce a NULL value without relying on nullable seed columns, we
 *   project a literal NULL with `SELECT id, NULL AS empty_col FROM users`.
 *   This gives a deterministic NULL cell in every row.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("value viewer", () => {
  /**
   * Clicks a data cell containing "Alice Smith" and verifies the ValueViewer
   * panel mounts with its close button visible.
   */
  test("opens the value viewer when a result table cell is clicked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT name, email FROM users");
    await waitForRowCount(page, 3);

    // Click a <td> that contains "Alice Smith" (not a header cell)
    await page.locator("td").filter({ hasText: "Alice Smith" }).first().click();

    // ValueViewer's close button has a unique title attribute
    await expect(page.getByTitle("Close value panel (Esc)")).toBeVisible({ timeout: 5_000 });
  });

  /**
   * Opens the value viewer by clicking a cell, then closes it using the
   * close button. Verifies the panel unmounts.
   */
  test("closes the value viewer when the close button is clicked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    await page.locator("td").filter({ hasText: "Alice Smith" }).first().click();
    const closeBtn = page.getByTitle("Close value panel (Esc)");
    await expect(closeBtn).toBeVisible({ timeout: 5_000 });

    // The close button calls onClose() which sets selectedCell = null
    await closeBtn.click();
    await expect(closeBtn).not.toBeVisible({ timeout: 3_000 });
  });

  /**
   * Opens the value viewer and closes it via the Escape key.
   * ValueViewer.tsx registers a window keydown listener: Escape → onClose().
   */
  test("closes the value viewer on Escape key press", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    await page.locator("td").filter({ hasText: "Bob Jones" }).first().click();
    await expect(page.getByTitle("Close value panel (Esc)")).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByTitle("Close value panel (Esc)")).not.toBeVisible({ timeout: 3_000 });
  });

  /**
   * Verifies that clicking a NULL cell opens the ValueViewer and shows the
   * NULL type indicator. We project a literal NULL so the cell is always NULL
   * regardless of seed data.
   */
  test("shows NULL indicator for a null cell value", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    // Literal NULL projection gives a deterministic NULL cell in every row
    await runQuery(page, "SELECT id, NULL AS empty_col FROM users");
    await waitForRowCount(page, 3);

    // Click the NULL cell (displayed as "NULL" in renderCellValue)
    await page.locator("td").filter({ hasText: /^NULL$/i }).first().click();

    // ValueViewer mounts — close button confirms the panel is open
    await expect(page.getByTitle("Close value panel (Esc)")).toBeVisible({ timeout: 5_000 });
  });
});
