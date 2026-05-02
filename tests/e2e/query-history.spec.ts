/**
 * tests/e2e/query-history.spec.ts — Query history panel E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   QueryHistoryPanel is a push-panel toggled by Cmd+H (Meta+H). It lists all
 *   queries executed in the current session, annotated with success/fail status.
 *   Clicking a history entry reloads its SQL into the CodeMirror editor.
 *
 * ===== HOW THE PANEL TOGGLE WORKS =====
 *
 *   App.tsx registers a window keydown listener. Cmd+H sets historyOpen = true,
 *   which conditionally renders:
 *     <aside aria-label="Query history">…</aside>
 *   adjacent to the center column.
 *
 * ===== WHY role="complementary" =====
 *
 *   The HTML <aside> element has an implicit ARIA role of "complementary".
 *   Playwright's getByRole("complementary") scopes to that element, so
 *   asserting on it confirms the exact JSX branch rendered.
 *
 * ===== HISTORY CLICK PATH =====
 *
 *   Clicking a history item calls loadSqlFromHistory() → updates Zustand store
 *   → increments a nonce → SqlEditor's useEffect fires → CodeMirror dispatch
 *   replaces the document. Testing this round-trip catches regressions in the
 *   most complex state-coordination path in the app.
 */

import { test, expect } from "@playwright/test";
import { runQuery, waitForRowCount } from "./helpers.js";

// ===== TESTS =====

test.describe("query history", () => {
  /**
   * Runs a query, presses Cmd+H, and verifies the history panel appears
   * with the executed SQL visible as a history entry.
   */
  test("opens history panel with Cmd+H after running a query", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    await runQuery(page, "SELECT * FROM users");
    await waitForRowCount(page, 3);

    await page.keyboard.press("Meta+h");

    // App.tsx renders <aside aria-label="Query history"> when historyOpen is true
    const historyPanel = page.getByRole("complementary", { name: "Query history" });
    await expect(historyPanel).toBeVisible({ timeout: 5_000 });

    // The executed SQL should appear in the history list
    await expect(page.getByText("SELECT * FROM users", { exact: false })).toBeVisible({
      timeout: 5_000,
    });
  });

  /**
   * Runs a query against a non-existent table (which fails), then opens
   * history and verifies that the entry has a "Failed" status indicator.
   */
  test("shows failed queries with a red status indicator", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    // A query against a non-existent table produces a server error
    await runQuery(page, "SELECT * FROM nonexistent_table");

    // Wait for the DataGrid to show its error state (the ✕ indicator)
    await expect(page.locator("text=✕").first()).toBeVisible({ timeout: 8_000 });

    await page.keyboard.press("Meta+h");
    await expect(
      page.getByRole("complementary", { name: "Query history" })
    ).toBeVisible({ timeout: 5_000 });

    // HistoryItem.tsx renders a red dot with aria-label="Failed" for failed entries
    await expect(
      page.locator('[aria-label="Failed"]').first()
    ).toBeVisible({ timeout: 5_000 });
  });

  /**
   * Runs a query, opens history, clicks the history entry, and verifies that
   * the SQL is reloaded into the CodeMirror editor.
   */
  test("clicking a history entry loads its SQL back into the editor", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("sqlite")).toBeVisible({ timeout: 8_000 });

    const sql = "SELECT name, email FROM users";
    await runQuery(page, sql);
    await waitForRowCount(page, 3);

    await page.keyboard.press("Meta+h");
    await expect(
      page.getByRole("complementary", { name: "Query history" })
    ).toBeVisible({ timeout: 5_000 });

    // History entries are rendered as <button> elements in HistoryItem.tsx.
    // The ancestor traversal finds the button that wraps the SQL text node.
    const historyEntry = page
      .getByText(sql, { exact: false })
      .locator("xpath=ancestor::button")
      .first();
    await historyEntry.click();

    // After the nonce effect fires, the CodeMirror document contains the loaded SQL
    await expect(page.locator(".cm-content")).toContainText(
      "SELECT name, email FROM users",
      { timeout: 5_000 }
    );
  });
});
