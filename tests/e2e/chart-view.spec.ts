/**
 * tests/e2e/chart-view.spec.ts — Chart view E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   ChartView renders a Recharts SVG when the query result contains a valid
 *   column pair: a categorical/text x-axis and a numeric y-axis. The view is
 *   activated by clicking the "Chart" button in the results panel header.
 *
 * ===== WHY SELECT name, age FROM users =====
 *
 *   `name` is TEXT (categorical x-axis) and `age` is INTEGER (numeric y-axis).
 *   chartDetect.ts pairs these to produce a bar-chart configuration. Using one
 *   text column and one numeric column gives deterministic chart detection.
 *
 * ===== WHY CHECK FOR <svg> =====
 *
 *   Recharts renders the chart inside an <svg> element. Its presence confirms
 *   that ChartView detected a valid column pair and delegated to the chart
 *   renderer. This assertion is chart-library-agnostic — it would survive a
 *   Recharts → D3 migration without change.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("chart view", () => {
  /**
   * Switches to chart mode and verifies that an SVG element is rendered
   * inside the chart panel.
   */
  test("switches to chart mode and renders an SVG element", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    // Run a query with a categorical text + numeric column for chartDetect.ts
    await runQuery(page, "SELECT name, age FROM users");
    await waitForRowCount(page, 3);

    // Click the "Chart" view-mode button in the results panel header
    await page.getByRole("button", { name: "Chart" }).click();

    // Recharts renders inside an <svg>; its presence confirms the chart mounted
    await expect(page.locator("svg").first()).toBeVisible({ timeout: 8_000 });
  });

  /**
   * Verifies that the chart export button is visible when the chart is rendered.
   * ChartView.tsx renders an export button in the chart header strip.
   */
  test("shows the chart export button when chart is rendered", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT name, age FROM users");
    await waitForRowCount(page, 3);

    await page.getByRole("button", { name: "Chart" }).click();

    // ChartView renders an export-to-PNG button with text/aria matching /export/i
    await expect(page.getByRole("button", { name: /export/i })).toBeVisible({
      timeout: 8_000,
    });
  });
});
