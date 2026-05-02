/**
 * tests/e2e/export.spec.ts — Data export E2E tests (CSV and JSON).
 *
 * ===== WHAT IS TESTED =====
 *
 *   ExportMenu wraps a Radix DropdownMenu with "Download CSV", "Download JSON",
 *   and "Download Excel" items. Each item calls triggerDownload() which creates
 *   a Blob URL, appends a hidden <a download=…> to the DOM, and clicks it.
 *
 * ===== WHY page.waitForEvent('download') =====
 *
 *   Blob URL downloads are intercepted by Playwright as download events.
 *   The promise must be created BEFORE the click that triggers it, otherwise
 *   the download may fire and resolve before the await has been set up.
 *
 * ===== WHY CHECK suggestedFilename =====
 *
 *   buildFilename() in ExportMenu.tsx generates "dbpeek-export-<ts>.<ext>".
 *   Matching the pattern confirms the correct handler fired (e.g. CSV handler
 *   rather than the JSON or XLSX handler by mistake).
 *
 * ===== EXPORT TRIGGER =====
 *
 *   The dropdown trigger has aria-label="Export results" (ExportMenu.tsx).
 *   It is disabled when no query result is loaded, so tests always run a query
 *   first to enable the button.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("csv export", () => {
  /**
   * Opens the export dropdown and selects "Download CSV", then asserts
   * that the downloaded file name matches the expected timestamp pattern.
   */
  test("triggers a CSV download with the correct filename pattern", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    // Open the export dropdown — trigger has aria-label="Export results"
    await page.getByRole("button", { name: "Export results" }).click();

    // Create the download promise BEFORE clicking the menu item to avoid a race
    const downloadPromise = page.waitForEvent("download");

    await page.getByText("Download CSV").click();

    const download = await downloadPromise;

    // buildFilename("csv") → "dbpeek-export-YYYYMMDDTHHmmssZ.csv"
    expect(download.suggestedFilename()).toMatch(/^dbpeek-export-\d{8}T\d{6}Z\.csv$/);
  });

  /**
   * Opens the export dropdown and selects "Download JSON", then asserts
   * that the downloaded file name matches the expected timestamp pattern.
   */
  test("triggers a JSON download with the correct filename pattern", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM tags");
    await waitForRowCount(page, 3);

    await page.getByRole("button", { name: "Export results" }).click();

    const downloadPromise = page.waitForEvent("download");
    await page.getByText("Download JSON").click();

    const download = await downloadPromise;

    // buildFilename("json") → "dbpeek-export-YYYYMMDDTHHmmssZ.json"
    expect(download.suggestedFilename()).toMatch(/^dbpeek-export-\d{8}T\d{6}Z\.json$/);
  });
});
