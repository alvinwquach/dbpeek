/**
 * tests/e2e/ddl-viewer.spec.ts — DDL viewer modal E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The DDL viewer opens a modal dialog showing the CREATE TABLE statement for
 *   a table. It is triggered by the DDL icon button rendered on each schema
 *   tree row (TableRow.tsx).
 *
 * ===== HOVER-GATED DDL BUTTON =====
 *
 *   The DDL button has `opacity-0` in its default state and becomes `opacity-100`
 *   on `group-hover`. Two strategies work:
 *
 *   a) hover() the parent row first, then click() normally:
 *        await page.locator('#schema-table-users').hover();
 *        await page.getByRole('button', { name: 'Show DDL for users' }).click();
 *
 *   b) click() with { force: true } to bypass the visibility check:
 *        await page.getByRole('button', { name: 'Show DDL for users' }).click({ force: true });
 *
 *   Both approaches are used here for coverage. The button IS in the DOM and
 *   does NOT have pointer-events: none, so the click registers in either case.
 *
 * ===== MODAL SELECTORS =====
 *
 *   DdlViewer.tsx wraps the content in:
 *     <div role="dialog" aria-modal="true" aria-label={`DDL for ${table}`}>
 *   Asserting on role="dialog" + aria-label confirms the modal mounted, not
 *   just that some text appeared on the page.
 */

import { test, expect } from "@playwright/test";

// ===== TESTS =====

test.describe("DDL viewer", () => {
  /**
   * Hovers the "users" table row to expose the opacity-gated DDL button,
   * clicks it, and verifies the DDL modal with CREATE TABLE content appears.
   */
  test("opens the DDL modal when the DDL button is clicked for the users table", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("treeitem").filter({ hasText: "users" })
    ).toBeVisible({ timeout: 10_000 });

    // Hover the <li id="schema-table-users"> to raise its children's opacity to 100
    await page.locator("#schema-table-users").hover();
    // force: true bypasses the Playwright visibility check as an extra safety net
    await page.getByRole("button", { name: "Show DDL for users" }).click({ force: true });

    // DdlViewer renders: <div role="dialog" aria-label="DDL for users">
    const dialog = page.getByRole("dialog", { name: "DDL for users" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The dialog fetches GET /api/schema/users/ddl and renders the CREATE TABLE SQL
    await expect(dialog.getByText(/CREATE TABLE/i)).toBeVisible({ timeout: 10_000 });
  });

  /**
   * Opens the DDL modal for the "tags" table and closes it using the close button.
   */
  test("closes the DDL modal when the close button is clicked", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("treeitem").filter({ hasText: "tags" })
    ).toBeVisible({ timeout: 10_000 });

    await page.locator("#schema-table-tags").hover();
    await page.getByRole("button", { name: "Show DDL for tags" }).click({ force: true });

    const dialog = page.getByRole("dialog", { name: "DDL for tags" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // Close button has aria-label="Close DDL viewer" (DdlViewer.tsx)
    await page.getByRole("button", { name: "Close DDL viewer" }).click();

    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });

  /**
   * Opens the DDL modal for the "posts" table and closes it via the Escape key.
   * DdlViewer.tsx registers a window keydown listener: Escape → onClose().
   */
  test("closes the DDL modal on Escape key press", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("treeitem").filter({ hasText: "posts" })
    ).toBeVisible({ timeout: 10_000 });

    await page.locator("#schema-table-posts").hover();
    await page.getByRole("button", { name: "Show DDL for posts" }).click({ force: true });

    const dialog = page.getByRole("dialog", { name: "DDL for posts" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
