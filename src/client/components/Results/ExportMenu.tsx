/**
 * src/client/components/Results/ExportMenu.tsx
 *
 * WHAT:
 *   A Radix DropdownMenu that lets users download the current query result
 *   as CSV (RFC 4180) or JSON. The trigger button is disabled when there are
 *   no results to export.
 *
 * WHY a dropdown instead of two separate buttons:
 *   The ResultsHeader bar is already narrow. A single "Export" trigger keeps
 *   the bar uncluttered while still surfacing two format options. More formats
 *   (TSV, SQL INSERT) can be added as items later without changing the layout.
 *
 * CSV SPEC (RFC 4180):
 *   - Fields are separated by commas.
 *   - Records are separated by CRLF (\r\n).
 *   - Fields that contain commas, double-quotes, or newlines are wrapped in
 *     double-quotes.
 *   - Double-quote characters inside a quoted field are escaped by doubling
 *     them: " → "".
 *   - The first record is a header row of column names (also RFC-4180 quoted
 *     if they contain special characters).
 *
 * JSON FORMAT:
 *   An array of objects. Each object uses column names as keys and the raw
 *   cell value as the value. null cells serialize as JSON null. Indented 2
 *   spaces for readability.
 *
 * FILENAME:
 *   dbpeek-export-<ISO timestamp without colons/periods>.csv / .json
 *   e.g. dbpeek-export-2024-01-15T143022Z.csv
 *   Using a timestamp makes re-running the same query produce a new file
 *   instead of silently overwriting the previous one.
 *
 * ARCHITECTURE:
 *   ExportMenu        — Radix Root + Trigger + Portal + Content + Items
 *   buildCsv()        — pure function: QueryResult → CSV string
 *   buildJson()       — pure function: QueryResult → JSON string
 *   triggerDownload() — creates a temporary <a> and clicks it; no server round-trip
 */

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { QueryResult } from "../../types";
import { buildExcel } from "./excelExport";

// ===== TYPES =====

/** Props for the ExportMenu component. */
interface ExportMenuProps {
  /**
   * The query result to export. When null (no query run yet, or after an error)
   * the trigger button is disabled and no items are rendered.
   */
  result: QueryResult | null;
}

// ===== CSV BUILDER =====

/**
 * csvEscapeField — applies RFC 4180 quoting rules to a single CSV field value.
 *
 * WHY this function exists separately:
 *   Both header cells and data cells need the same escaping logic. Extracting
 *   it prevents duplication and makes the rule easy to unit-test in isolation.
 *
 * Rules applied:
 *   1. Convert the value to a string (null/undefined → empty string).
 *   2. If the string contains a comma, double-quote, CR, or LF, wrap it in
 *      double-quotes and escape any embedded double-quotes by doubling them.
 *
 * Returns a plain string (no surrounding quotes) when no special chars are
 * present — the common fast path for clean identifier columns.
 */
export function csvEscapeField(value: unknown): string {
  // null / undefined → empty cell
  const str =
    value === null || value === undefined
      ? ""
      : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  // RFC 4180 §2.7: fields with commas, double-quotes, or newlines must be quoted
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    // Escape embedded double-quotes by doubling (RFC 4180 §2.7)
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * buildCsv — serializes a QueryResult to an RFC 4180 CSV string.
 *
 * Structure:
 *   Line 1: comma-separated column names (header row)
 *   Lines 2…N: comma-separated cell values, one row per line
 *
 * Line endings: CRLF (\r\n) as required by RFC 4180 §2.4.
 *
 * WHY BOM prefix (U+FEFF):
 *   Excel on Windows silently mangles UTF-8 CSVs that lack a BOM. The BOM
 *   signals UTF-8 encoding and causes Excel to auto-detect the character set
 *   instead of defaulting to the system ANSI code page. Non-Excel consumers
 *   (pandas, psql COPY, etc.) ignore the BOM gracefully.
 */
export function buildCsv(result: QueryResult): string {
  const CRLF = "\r\n";
  const BOM = "﻿";

  // Header row: escape each column name per RFC 4180
  const header = result.columns.map(csvEscapeField).join(",");

  // Data rows: one row per result row, each cell escaped
  const dataRows = result.rows.map((row) =>
    row.map(csvEscapeField).join(",")
  );

  return BOM + [header, ...dataRows].join(CRLF) + CRLF;
}

// ===== JSON BUILDER =====

/**
 * buildJson — serializes a QueryResult to a JSON array-of-objects string.
 *
 * Each row becomes a plain object `{ [columnName]: cellValue }`. Column names
 * are used as keys exactly as returned by the server.
 *
 * WHY array-of-objects (not row-arrays):
 *   The JSON format is meant for human consumption and downstream tooling
 *   (jq, Python dicts, JavaScript fetch). Named keys are far more usable than
 *   positional arrays in those contexts. The raw array-of-arrays form is an
 *   internal wire optimization, not a user-facing format.
 *
 * WHY 2-space indent:
 *   Compact JSON (no indent) is hard to read in a text editor. 2 spaces is the
 *   JS ecosystem standard and keeps file sizes reasonable.
 *
 * NOTE: Duplicate column names (e.g. two "id" columns from a JOIN) will have
 *   the later column's value overwrite the earlier one in the object. This is
 *   a known limitation of the object format. The header row in CSV handles it
 *   correctly because arrays allow duplicate keys.
 */
export function buildJson(result: QueryResult): string {
  const records = result.rows.map((row) => {
    const record: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      record[col] = row[i];
    });
    return record;
  });
  return JSON.stringify(records, null, 2);
}

// ===== FILENAME BUILDER =====

/**
 * buildFilename — generates a timestamped export filename.
 *
 * Format: dbpeek-export-<YYYYMMDDTHHmmssZ>.<ext>
 *
 * WHY strip colons and dots from the ISO timestamp:
 *   Colons are illegal in Windows filenames. Dots before the extension
 *   confuse some file managers into treating the timestamp as a file
 *   extension. Stripping both produces a clean, sortable, filesystem-safe name.
 *
 * Examples:
 *   buildFilename("csv") → "dbpeek-export-20240115T143022Z.csv"
 *   buildFilename("json") → "dbpeek-export-20240115T143022Z.json"
 */
export function buildFilename(ext: "csv" | "json"): string {
  const ts = new Date()
    .toISOString()           // e.g. "2024-01-15T14:30:22.000Z"
    .replace(/[-:.]/g, "")  // strip dashes, colons, and the millisecond dot → "20240115T143022000Z"
    .replace(/\d{3}Z$/, "Z"); // drop the 3-digit milliseconds → "20240115T143022Z"
  return `dbpeek-export-${ts}.${ext}`;
}

// ===== DOWNLOAD HELPER =====

/**
 * triggerDownload — creates a hidden <a> element, sets a blob URL on it, and
 * programmatically clicks it to initiate a file download.
 *
 * WHY a Blob URL instead of a data: URI:
 *   data: URIs embed the full file content in the href attribute. For large
 *   result sets this can be tens of megabytes. The browser must parse the
 *   entire attribute string before starting the download. Blob URLs are
 *   reference-counted handles; the browser streams from memory directly,
 *   with no URL parsing overhead. The URL is revoked synchronously after the
 *   click to prevent a memory leak (the browser keeps the blob alive until
 *   the download starts, then GCs it).
 *
 * WHY create/remove the <a> element:
 *   The download attribute only works on same-origin URLs when the element
 *   is in the document. We append it to document.body, click, then remove.
 */
function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Revoke after a short delay so the browser can start the download
  // before the object URL is invalidated.
  setTimeout(() => URL.revokeObjectURL(url), 100);
}

// ===== MAIN COMPONENT =====

/**
 * ExportMenu — the Radix DropdownMenu with CSV and JSON export items.
 *
 * RADIX STRUCTURE:
 *   DropdownMenu.Root        — manages open/closed state and keyboard nav
 *   DropdownMenu.Trigger     — the visible "Export ▾" button; disabled when no result
 *   DropdownMenu.Portal      — renders Content outside the stacking context of the
 *                              stats bar so it isn't clipped by overflow:hidden
 *   DropdownMenu.Content     — the floating panel; sideOffset=4 gives a small gap
 *   DropdownMenu.Item ×2     — CSV and JSON options
 *
 * WHY modal={false}:
 *   The default modal=true traps pointer events outside the menu (blocks the
 *   rest of the UI). For a simple utility menu in a dev tool, non-modal is
 *   friendlier — clicking outside just closes the menu.
 */
export function ExportMenu({ result }: ExportMenuProps) {
  // Export is only possible when there is tabular data (columns + rows).
  // Non-SELECT results (result.columns.length === 0) produce an empty export,
  // so we gate on both conditions.
  const hasData = result !== null && result.columns.length > 0;

  // ── Handlers ────────────────────────────────────────────────────────────────

  /**
   * handleExportCsv — builds the CSV string from the current result and
   * triggers a browser download. The Radix Item's onSelect fires after the
   * menu closes, so the UI is already clean when the download dialog appears.
   */
  function handleExportCsv() {
    if (!result) return;
    triggerDownload(
      buildCsv(result),
      buildFilename("csv"),
      "text/csv;charset=utf-8;"
    );
  }

  /**
   * handleExportJson — same as handleExportCsv but produces a JSON file.
   */
  function handleExportJson() {
    if (!result) return;
    triggerDownload(
      buildJson(result),
      buildFilename("json"),
      "application/json;charset=utf-8;"
    );
  }

  /**
   * handleExportExcel — builds an Excel workbook from the current result,
   * detects column types, applies formatting, and triggers a download.
   * Produces a real .xlsx binary file, not a CSV renamed to .xlsx.
   */
  function handleExportExcel() {
    if (!result) return;
    buildExcel(result);
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <DropdownMenu.Root modal={false}>
      {/*
        Trigger — the button the user clicks to open the menu.

        WHY asChild={false} (default):
          We want a plain <button> with Radix's accessibility attributes
          (aria-haspopup, aria-expanded, data-state) applied automatically.
          asChild would merge those onto our own element, requiring more
          boilerplate without any benefit here.

        Disabled state: Radix sets [data-disabled] on the trigger and prevents
        the menu from opening. We also apply opacity/cursor styles manually
        because Tailwind's disabled: variant only targets :disabled, not
        [data-disabled] (which Radix uses instead of the HTML disabled attr
        for its custom components).
      */}
      <DropdownMenu.Trigger
        disabled={!hasData}
        className={[
          "flex items-center gap-1 px-2 h-5 rounded text-[10px] font-mono",
          "border border-[#1f2033] bg-[#0d0d17]",
          "transition-colors duration-100",
          hasData
            ? "text-[#6b7280] hover:text-[#ededf0] hover:border-[#2d3047] cursor-pointer"
            : "text-[#2d3047] border-[#161624] cursor-not-allowed opacity-50",
        ].join(" ")}
        aria-label="Export results"
      >
        {/* Down-arrow icon — signals this is a dropdown */}
        <svg
          className="w-2.5 h-2.5 shrink-0"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
        >
          {/* Download tray icon: arrow pointing into a tray */}
          <path
            d="M5 1v5M2.5 4l2.5 2.5L7.5 4M1.5 8h7"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Export
        {/* Chevron — visually indicates a dropdown */}
        <svg
          className="w-2 h-2 shrink-0 text-[#4b5563]"
          viewBox="0 0 8 8"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M1.5 3L4 5.5L6.5 3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </DropdownMenu.Trigger>

      {/*
        Portal — lifts the Content out of the current DOM subtree.

        WHY Portal is necessary here:
          ResultsHeader lives inside a div with overflow:hidden (the stats bar).
          Without Portal, the dropdown content would be clipped by that
          overflow boundary. Portal renders the content as a child of
          document.body, outside any clipping ancestor.
      */}
      <DropdownMenu.Portal>
        {/*
          Content — the floating panel containing menu items.

          sideOffset=4: 4px gap between the trigger bottom edge and the panel
          top edge. Matches the visual rhythm of the rest of the UI.

          align="end": align the right edge of the panel with the right edge
          of the trigger so the menu doesn't hang off to the right into empty
          space when the trigger is at the far right of the header bar.

          collisionPadding=8: keep 8px away from viewport edges.
        */}
        <DropdownMenu.Content
          sideOffset={4}
          align="end"
          collisionPadding={8}
          className={[
            "z-50 min-w-[120px] rounded border border-[#1f2033]",
            "bg-[#0d0d17] shadow-[0_4px_24px_rgba(0,0,0,0.6)]",
            "py-1",
            // Radix data-state animations: fade + slight slide
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
            "data-[side=top]:slide-in-from-bottom-2",
            "data-[side=bottom]:slide-in-from-top-2",
          ].join(" ")}
        >
          {/*
            CSV Item — triggers RFC 4180 CSV download on select.

            onSelect fires when the user clicks or presses Enter on the item.
            Radix closes the menu automatically after onSelect unless
            event.preventDefault() is called.
          */}
          <DropdownMenu.Item
            onSelect={handleExportCsv}
            className={[
              "flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono",
              "text-[#9ca3af] cursor-pointer outline-none select-none",
              "hover:bg-[#1a1a2e] hover:text-[#ededf0]",
              "focus:bg-[#1a1a2e] focus:text-[#ededf0]",
              "transition-colors duration-75 rounded-[2px] mx-1",
            ].join(" ")}
          >
            {/* CSV file type badge */}
            <span className="text-[9px] font-bold tracking-wider text-[#6366f1] bg-[#1e1f3a] px-1 py-0.5 rounded">
              CSV
            </span>
            Download CSV
          </DropdownMenu.Item>

          {/* Visual separator between format options */}
          <DropdownMenu.Separator className="my-1 border-t border-[#1f2033]" />

          {/*
            JSON Item — triggers JSON array-of-objects download on select.
          */}
          <DropdownMenu.Item
            onSelect={handleExportJson}
            className={[
              "flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono",
              "text-[#9ca3af] cursor-pointer outline-none select-none",
              "hover:bg-[#1a1a2e] hover:text-[#ededf0]",
              "focus:bg-[#1a1a2e] focus:text-[#ededf0]",
              "transition-colors duration-75 rounded-[2px] mx-1",
            ].join(" ")}
          >
            {/* JSON file type badge */}
            <span className="text-[9px] font-bold tracking-wider text-[#f59e0b] bg-[#261f0a] px-1 py-0.5 rounded">
              JSON
            </span>
            Download JSON
          </DropdownMenu.Item>

          {/* Visual separator before Excel option */}
          <DropdownMenu.Separator className="my-1 border-t border-[#1f2033]" />

          {/*
            Excel Item — triggers Excel (.xlsx) workbook download on select.
            Uses SheetJS to create a real binary Excel file with proper column
            type detection, number formatting, and styling.
          */}
          <DropdownMenu.Item
            onSelect={handleExportExcel}
            className={[
              "flex items-center gap-2 px-3 py-1.5 text-[11px] font-mono",
              "text-[#9ca3af] cursor-pointer outline-none select-none",
              "hover:bg-[#1a1a2e] hover:text-[#ededf0]",
              "focus:bg-[#1a1a2e] focus:text-[#ededf0]",
              "transition-colors duration-75 rounded-[2px] mx-1",
            ].join(" ")}
          >
            {/* Excel file type badge */}
            <span className="text-[9px] font-bold tracking-wider text-[#10b981] bg-[#064e3b] px-1 py-0.5 rounded">
              XLSX
            </span>
            Download Excel
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
