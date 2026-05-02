/**
 * tests/e2e/schema-sidebar.spec.ts — Schema sidebar E2E tests.
 *
 * ===== WHAT IS TESTED =====
 *
 *   The SchemaTree fetches GET /api/schema on mount and renders one
 *   role="treeitem" per table. Clicking a table row expands it to reveal
 *   a nested list of column names.
 *
 * ===== TEST DATABASE =====
 *
 *   The fixture database (seeded by start-server.cjs) has three tables:
 *     users  — id, name, email, age, active
 *     posts  — id, user_id, title, body, published
 *     tags   — id, name, color
 *
 *   Verifying all three tables ensures the schema fetch is complete and
 *   the tree renders without truncation or stale-data artifacts.
 *
 * ===== SELECTORS =====
 *
 *   TableRow.tsx sets role="treeitem" on the <li id="schema-table-{name}">.
 *   Column rows render inside a role="group" child element once the table
 *   is expanded.
 */

import { test, expect } from "@playwright/test";

// ===== TESTS =====

test.describe("schema sidebar", () => {
  /**
   * Confirms all three fixture tables appear in the schema tree after
   * the /api/schema fetch resolves.
   */
  test("lists all three fixture tables in the schema tree", async ({ page }) => {
    await page.goto("/");

    // Tables render as list items with role="treeitem" (TableRow.tsx)
    await expect(page.getByRole("treeitem").filter({ hasText: "users" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("treeitem").filter({ hasText: "posts" })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("treeitem").filter({ hasText: "tags" })).toBeVisible({
      timeout: 10_000,
    });
  });

  /**
   * Clicks the "users" table row to expand it, then verifies that column
   * names become visible in the expanded column list.
   */
  test("expands a table row to reveal its columns", async ({ page }) => {
    await page.goto("/");

    const usersTreeItem = page.getByRole("treeitem").filter({ hasText: "users" });
    await expect(usersTreeItem).toBeVisible({ timeout: 10_000 });

    // Clicking the treeitem triggers onToggleExpand in TableRow.tsx
    await usersTreeItem.click();

    // After expanding, the nested column list becomes visible
    await expect(page.getByText("name", { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("email")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("age")).toBeVisible({ timeout: 5_000 });
  });
});
