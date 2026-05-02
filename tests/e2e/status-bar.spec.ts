/**
 * tests/e2e/status-bar.spec.ts — StatusBar component E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The StatusBar sits at the bottom of the layout and renders metadata fetched
 *   from GET /api/status:
 *     - dialect     ("sqlite" in the test environment)
 *     - permission mode ("readonly" — the test server's setting)
 *     - connection indicator ("connected" when the SQLite file opened cleanly)
 *
 *   Also tests the light/dark theme toggle button that lives in the status bar.
 *
 * ===== WHY THESE ASSERTIONS =====
 *
 *   - "sqlite"     confirms the server's ConnectionConfig.dialect is read correctly.
 *   - "readonly"   confirms permissionMode flows from config → /api/status → UI.
 *   - "connected"  confirms the SQLite file was opened without errors.
 *   - theme toggle confirms the button is rendered with the expected aria-label.
 *
 * ===== TIMING =====
 *
 *   Each assertion uses { timeout: 8000 } because the React Query fetch for
 *   /api/status is asynchronous; the DOM starts in a loading state.
 */

import { test, expect } from "@playwright/test";

// ===== TESTS =====

test.describe("status bar", () => {
  /**
   * Verifies that the status bar shows the correct dialect, permission mode,
   * and connection indicator after the /api/status fetch resolves.
   */
  test("shows dialect, permission mode, and connected indicator", async ({ page }) => {
    await page.goto("/");

    // StatusBar renders: <StatusItem label="dialect" value={info.dialect} />
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    // permissionMode: 'readonly' is passed in the test server config
    await expect(page.getByText("readonly")).toBeVisible({ timeout: 8_000 });

    // ConnectionDot renders "connected" text when info.connected is true
    await expect(page.getByText("connected")).toBeVisible({ timeout: 8_000 });
  });

  /**
   * Verifies the theme toggle button is present in the status bar.
   * The exact label depends on the initial theme so we match both variants.
   */
  test("shows light/dark theme toggle button", async ({ page }) => {
    await page.goto("/");

    // The toggle's aria-label is "Switch to light mode" (when dark) or
    // "Switch to dark mode" (when light). We match both with a regex.
    const toggle = page.getByRole("button", {
      name: /switch to (light|dark) mode/i,
    });
    await expect(toggle).toBeVisible({ timeout: 8_000 });
  });
});
