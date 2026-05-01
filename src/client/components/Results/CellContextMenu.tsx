/**
 * src/client/components/Results/CellContextMenu.tsx
 *
 * WHAT:
 *   A Radix ContextMenu wrapper that appears on right-click over any data cell.
 *   Provides three copy actions: cell value, row as JSON, and full column.
 *
 * WHY a dedicated component:
 *   ResultsTable already manages virtualizer, sorting, and resize state. Pulling
 *   context-menu logic into its own file keeps each file focused on one concern.
 *
 * HOW it works:
 *   1. Wraps the <td> via ContextMenu.Root + ContextMenu.Trigger (asChild so no
 *      extra DOM nodes break table structure).
 *   2. On right-click Radix opens the portal-rendered Content at the pointer.
 *   3. Each Item calls navigator.clipboard.writeText then calls onCopied() so
 *      the parent can show the shared "Copied!" toast.
 */

import * as ContextMenu from "@radix-ui/react-context-menu";
import type { ReactNode } from "react";

// ===== TYPES =====

export interface CellContextMenuProps {
  /** Raw value of the right-clicked cell. Used for "Copy cell value". */
  cellValue: unknown;
  /** 0-based column index within result.columns (not counting the # column). */
  colIndex: number;
  /** Column names in order, matching result.columns. */
  columns: string[];
  /**
   * All rows in the current sorted order (unknown[][]).
   * Used by "Copy column" to collect every value in the right-clicked column,
   * and by "Copy row as JSON" to locate the full row.
   */
  allRows: unknown[][];
  /**
   * The complete row that was right-clicked (unknown[]).
   * Passed directly so "Copy row as JSON" avoids a scan through allRows.
   */
  rowValues: unknown[];
  /** Called after any successful clipboard write so the parent shows a toast. */
  onCopied: () => void;
  /** The cell content to wrap with the context menu trigger. */
  children: ReactNode;
}

// ===== HELPERS =====

/**
 * rawToString — converts a raw DB value to the clipboard string.
 * Mirrors renderCellValue's semantics so what you see is what you copy.
 */
function rawToString(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

// ===== SHARED ITEM STYLE =====

/** Tailwind classes shared across all three menu items. */
const ITEM_CLASS = [
  "flex items-center px-3 py-1.5 cursor-pointer outline-none select-none",
  "text-[#ededf0] text-xs font-mono",
  "data-[highlighted]:bg-[#1a1a2e] data-[highlighted]:text-[#ededf0]",
  "transition-colors duration-75",
].join(" ");

// ===== COMPONENT =====

/**
 * CellContextMenu — right-click context menu for a single data grid cell.
 *
 * Three actions:
 *   "Copy cell value"  — stringified value of the specific cell
 *   "Copy row as JSON" — { columnName: value, … } for the entire row
 *   "Copy column"      — newline-separated values of every row in this column
 */
export function CellContextMenu({
  cellValue,
  colIndex,
  columns,
  allRows,
  rowValues,
  onCopied,
  children,
}: CellContextMenuProps) {
  // ── Copy cell value ────────────────────────────────────────────────────────

  async function handleCopyCellValue() {
    await copyToClipboard(rawToString(cellValue));
    onCopied();
  }

  // ── Copy row as JSON ───────────────────────────────────────────────────────

  async function handleCopyRowAsJson() {
    // Build { columnName: value } preserving column order.
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col] = rowValues[i];
    });
    await copyToClipboard(JSON.stringify(obj, null, 2));
    onCopied();
  }

  // ── Copy column ────────────────────────────────────────────────────────────

  async function handleCopyColumn() {
    // Collect every value in this column from the current sorted rows.
    const lines = allRows.map((row) => rawToString(row[colIndex]));
    await copyToClipboard(lines.join("\n"));
    onCopied();
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const colName = columns[colIndex] ?? `col_${colIndex}`;

  return (
    <ContextMenu.Root>
      {/*
        asChild merges trigger behaviour onto the <td> element so no extra DOM
        node is inserted inside the table cell (invalid HTML otherwise).
      */}
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>

      <ContextMenu.Portal>
        {/*
          z-50 floats above sticky headers (z-10). collisionPadding prevents the
          menu from being clipped at viewport edges (especially near the bottom).
        */}
        <ContextMenu.Content
          className={[
            "z-50 min-w-[200px] rounded",
            "bg-[#0f0f1a] border border-[#1f2033]",
            "py-1 shadow-xl shadow-black/50",
            "animate-in fade-in-0 zoom-in-95",
          ].join(" ")}
          collisionPadding={8}
        >
          {/* Copy cell value */}
          <ContextMenu.Item
            className={ITEM_CLASS}
            onSelect={(e) => {
              e.preventDefault();
              void handleCopyCellValue();
            }}
          >
            Copy cell value
          </ContextMenu.Item>

          {/* Copy row as JSON */}
          <ContextMenu.Item
            className={ITEM_CLASS}
            onSelect={(e) => {
              e.preventDefault();
              void handleCopyRowAsJson();
            }}
          >
            Copy row as JSON
          </ContextMenu.Item>

          <ContextMenu.Separator className="my-1 border-t border-[#1f2033]" />

          {/* Copy column — shows column name as hint */}
          <ContextMenu.Item
            className={ITEM_CLASS}
            onSelect={(e) => {
              e.preventDefault();
              void handleCopyColumn();
            }}
          >
            Copy column
            <span className="ml-1.5 text-[#4b5563]">({colName})</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
