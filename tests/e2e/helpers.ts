/**
 * tests/e2e/helpers.ts — Shared Playwright test utilities for dbpeek E2E suite.
 *
 * ===== PURPOSE =====
 *
 *   Centralises the three helpers that every spec file needs:
 *     typeInEditor  — replaces CodeMirror editor content via keyboard events
 *     runQuery      — types SQL into CodeMirror and fires Cmd+Enter
 *     waitForRowCount — polls ResultsHeader for a specific row count string
 *
 *   By exporting from a single module, spec files stay terse and any change to
 *   the CodeMirror interaction or row-count rendering only needs one edit here.
 *
 * ===== CODEMIRROR TYPING =====
 *
 *   CodeMirror 6 uses a `contenteditable` div (.cm-content) instead of a
 *   standard <input>. Playwright's fill() fires an "input" event on <input>/
 *   <textarea> elements, which CodeMirror never observes. Keyboard events go
 *   through CodeMirror's own key dispatcher and produce the correct mutations.
 *
 *   Sequence:
 *     1. click()        — focuses the editor and positions the cursor
 *     2. Meta+A         — selects the entire CodeMirror document
 *     3. keyboard.type  — first keystroke replaces the selection with the new SQL
 *
 * ===== ROW COUNT POLLING =====
 *
 *   POST /api/query is async. ResultsHeader updates after the React Query fetch
 *   resolves. waitForRowCount wraps expect().toBeVisible() with a configurable
 *   timeout so callers don't need to reason about network timing themselves.
 */

import { expect, type Page } from "@playwright/test";

// ===== HELPERS =====

/**
 * typeInEditor — clears the CodeMirror editor and types a new SQL string.
 *
 * WHY keyboard events instead of fill():
 *   CodeMirror 6 does not observe the "input" event that Playwright's fill()
 *   dispatches on <input>/<textarea> elements. Keyboard events go through
 *   CodeMirror's own dispatcher and produce the correct document mutations.
 *
 * WHY Meta+A:
 *   The editor may hold multi-line SQL from a previous action. Meta+A maps to
 *   CodeMirror's built-in "selectAll" command, which reliably selects the whole
 *   document regardless of cursor position.
 *
 * @param page - Playwright page object.
 * @param sql  - SQL string to type into the editor.
 */
export async function typeInEditor(page: Page, sql: string): Promise<void> {
  const editor = page.locator(".cm-content");
  await editor.click();
  await page.keyboard.press("Meta+a");
  // delay: 0 keeps tests fast; CodeMirror handles synthetic key events correctly.
  await page.keyboard.type(sql, { delay: 0 });
}

/**
 * runQuery — types SQL into the CodeMirror editor and executes it with Cmd+Enter.
 *
 * WHY this helper:
 *   "type + Cmd+Enter" is the primary interaction pattern across the whole
 *   E2E suite. Centralising it exposes intent ("run this query") rather than
 *   the underlying mechanics ("type chars then press a keyboard shortcut").
 *
 * @param page - Playwright page object.
 * @param sql  - SQL string to execute.
 */
export async function runQuery(page: Page, sql: string): Promise<void> {
  await typeInEditor(page, sql);
  // Mod+Enter = Cmd+Enter on macOS. Playwright sends a synthetic keydown with
  // metaKey: true, which the CodeMirror keymap binding picks up.
  await page.keyboard.press("Meta+Enter");
}

/**
 * waitForRowCount — waits for the ResultsHeader to display a specific row count.
 *
 * WHY a helper:
 *   POST /api/query resolves asynchronously. Multiple spec files assert on row
 *   counts; centralising the wait logic prevents timeout duplication.
 *
 * @param page    - Playwright page object.
 * @param count   - Expected row count (e.g. 3 for the full users table).
 * @param timeout - Max milliseconds to wait (default 10 s).
 */
export async function waitForRowCount(
  page: Page,
  count: number,
  timeout = 10_000
): Promise<void> {
  // ResultsHeader renders "3 rows" (singular when count === 1: "1 row")
  const label = count === 1 ? "1 row" : `${count} rows`;
  await expect(page.getByText(label)).toBeVisible({ timeout });
}
