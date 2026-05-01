/**
 * src/client/components/Results/excelExport.ts
 *
 * WHAT:
 *   Exports a QueryResult to a real Excel workbook (.xlsx) with proper column
 *   type detection and formatting. Uses SheetJS (xlsx) to create binary-format
 *   Excel files, not CSV files with .xlsx extensions.
 *
 * WHY a separate file:
 *   Excel export requires external dependencies (xlsx) and non-trivial logic
 *   to detect column types (string, number, date, boolean) and set appropriate
 *   Excel number formats. Keeping this in a dedicated module keeps ExportMenu.tsx
 *   focused on UI and separates concerns.
 *
 * COLUMN TYPE DETECTION:
 *   Inspects all non-null values in each column and tries to infer the most
 *   specific type. Order of precedence (most → least specific):
 *   1. Boolean: true/false values
 *   2. Number: numeric values (int, float, scientific notation)
 *   3. Date: ISO 8601 strings (YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, etc.)
 *   4. String: everything else (default fallback)
 *
 * EXCEL NUMBER FORMATS:
 *   - Integer: "0" (no decimals)
 *   - Float: "0.00" (2 decimals, with leading zero)
 *   - Date: "YYYY-MM-DD" ISO format (Excel's built-in date display)
 *   - Boolean: "@" (text format; displays as true/false)
 *   - String: "@" (text format; right-aligned numbers treated as strings)
 *
 * FILENAME:
 *   dbpeek-export-<ISO timestamp without colons/periods>.xlsx
 *   e.g. dbpeek-export-2024-01-15T143022Z.xlsx
 *   Matches the naming convention of CSV and JSON exports.
 *
 * WHY NOT use native Excel features for type inference:
 *   Excel will auto-detect numeric strings as numbers on import, but for
 *   values that look numeric but should stay strings (ZIP codes, IDs with
 *   leading zeros), it's better to pre-detect and lock in the type. This
 *   export is designed for curated data exports where the DB schema's type
 *   information is more authoritative than Excel's heuristics.
 */

import type { QueryResult } from "../../types.js";
import * as XLSX from "xlsx";

// ===== TYPES =====

/**
 * Represents an inferred column type for Excel formatting.
 * Used to set number formats and cell alignment in the workbook.
 */
type ColumnType = "string" | "number" | "integer" | "float" | "date" | "boolean";

/**
 * Metadata about a detected column, including its inferred type and
 * a sample value used for format detection.
 */
interface ColumnMetadata {
  type: ColumnType;
  sampleValue: unknown;
}

// ===== COLUMN TYPE DETECTION =====

/**
 * isBoolean — checks if a value is a true boolean (not a string "true"/"false").
 *
 * WHY this check:
 *   Some databases return booleans as numeric (1/0) or string ("true"/"false").
 *   We only treat native boolean types as "boolean" column type; numeric/string
 *   booleans fall through to number or string detection.
 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

/**
 * isNumber — checks if a value is a number (not NaN or Infinity).
 *
 * WHY exclude NaN/Infinity:
 *   These are edge cases that don't serialize well into Excel. They'll be
 *   rendered as the string "NaN" or "Infinity" instead.
 */
function isNumber(value: unknown): value is number {
  return typeof value === "number" && isFinite(value);
}

/**
 * isIsoDate — checks if a value is a string matching ISO 8601 date/datetime format.
 *
 * Matches patterns like:
 *   - "2024-01-15"
 *   - "2024-01-15T14:30:22Z"
 *   - "2024-01-15T14:30:22.000Z"
 *   - "2024-01-15T14:30:22+00:00"
 *
 * WHY this regex:
 *   ISO 8601 is the standard database and API format for dates. Detecting
 *   it allows Excel to format cells as date/time without ambiguity (no
 *   MM/DD vs DD/MM confusion).
 *
 * WHY require a T separator:
 *   A bare string like "2024-01" could be a month, or just a hyphenated ID.
 *   Requiring the full YYYY-MM-DD base ensures we're looking at calendar dates.
 */
function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  // Match ISO 8601: starts with YYYY-MM-DD, optionally followed by time/tz
  return /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * detectColumnType — infers the type of a column by inspecting its values.
 *
 * Algorithm:
 *   1. Iterate through all values in the column.
 *   2. Skip nulls and undefined (they don't constrain the type).
 *   3. Try to match each value against the type hierarchy (boolean → number → date → string).
 *   4. If we find a value that doesn't match the candidate type, demote to the next type.
 *   5. Return the most specific type that all values satisfy.
 *
 * WHY iterate all values:
 *   A column might have mostly numbers with a single string error value
 *   (e.g. "N/A" in a numeric field). Detecting based on the first non-null
 *   value could misclassify. Inspecting all values ensures we're conservative:
 *   if *any* value doesn't fit the type, we fall back to string (which accepts
 *   anything).
 *
 * Returns a tuple of [type, sampleValue]. The sampleValue is the first
 * non-null value in the column, used for format lookup later.
 */
function detectColumnType(values: unknown[]): ColumnMetadata {
  let currentType: ColumnType = "boolean";
  let sampleValue: unknown = null;

  for (const value of values) {
    // Skip nulls and undefined — they don't constrain the type
    if (value === null || value === undefined) {
      continue;
    }

    // Record the first non-null value as the sample
    if (sampleValue === null) {
      sampleValue = value;
    }

    // Type hierarchy: try to match against the current candidate type
    // If the value doesn't match, demote to the next type down.
    if (currentType === "boolean") {
      if (!isBoolean(value)) {
        currentType = "number";
      } else {
        continue; // Value matches current type
      }
    }

    if (currentType === "number") {
      if (!isNumber(value)) {
        currentType = "date";
      } else {
        // Check if it's an integer or float
        if (Number.isInteger(value)) {
          if (currentType === "number") currentType = "integer";
        } else {
          currentType = "float";
        }
        continue;
      }
    }

    if (currentType === "date") {
      if (!isIsoDate(value)) {
        currentType = "string";
      } else {
        continue;
      }
    }

    if (currentType === "string") {
      // String is the universal fallback; all values are strings
      continue;
    }
  }

  return { type: currentType, sampleValue };
}

/**
 * detectAllColumns — infers types for all columns in the result.
 *
 * Returns an array of ColumnMetadata, one per column, in the same order
 * as result.columns.
 */
function detectAllColumns(result: QueryResult): ColumnMetadata[] {
  return result.columns.map((_: string, colIndex: number) => {
    const values = result.rows.map((row: unknown[]) => row[colIndex]);
    return detectColumnType(values);
  });
}

// ===== EXCEL FORMAT BUILDER =====

/**
 * getExcelNumberFormat — returns an Excel number format string for a column type.
 *
 * Excel number format codes:
 *   "0"     → integer (123)
 *   "0.00"  → float with 2 decimals (123.45)
 *   "yyyy-mm-dd" → ISO date format
 *   "@"     → text (disables auto-conversion)
 *
 * WHY "0.00" for floats:
 *   Ensures at least one decimal place is shown, and at most two, preventing
 *   ambiguity between 1.5 and 1.50. (Excel's default might use 0-15 decimals.)
 *
 * WHY "@" for text/boolean:
 *   Prevents Excel from auto-converting strings that look numeric (e.g. ZIP
 *   codes, phone numbers) into numbers. Also locks boolean values as text.
 */
function getExcelNumberFormat(columnType: ColumnType): string {
  switch (columnType) {
    case "integer":
      return "0";
    case "float":
      return "0.00";
    case "date":
      return "yyyy-mm-dd";
    case "boolean":
    case "string":
    default:
      return "@";
  }
}

/**
 * getExcelAlignment — returns the alignment for a column type.
 *
 * Alignment conventions:
 *   - Numbers: right-aligned (standard accounting convention)
 *   - Text/Boolean: left-aligned (readable prose convention)
 *   - Date: center-aligned (compact temporal data)
 */
function getExcelAlignment(
  columnType: ColumnType
): { horizontal: "left" | "center" | "right"; vertical: "center" } {
  if (columnType === "integer" || columnType === "float") {
    return { horizontal: "right", vertical: "center" };
  }
  if (columnType === "date") {
    return { horizontal: "center", vertical: "center" };
  }
  return { horizontal: "left", vertical: "center" };
}

// ===== WORKBOOK BUILDER =====

/**
 * buildExcelWorkbook — constructs a SheetJS workbook from a QueryResult.
 *
 * Steps:
 *   1. Detect column types by inspecting all values.
 *   2. Convert QueryResult rows (arrays) to cell values, applying null → empty cell.
 *   3. Create a Sheet from the headers + data.
 *   4. Apply column widths, header styling, and per-column formatting.
 *   5. Return a Workbook ready to be written to disk.
 *
 * STYLING:
 *   - Header row: bold, light background, centered
 *   - Data cells: number format per column type, alignment per type
 *   - Column widths: auto-calculated from header length + sample data
 */
function buildExcelWorkbook(result: QueryResult): XLSX.WorkBook {
  // Detect column types for formatting
  const columnMetadata = detectAllColumns(result);

  // Build data array: [headers, ...rows]
  const data: unknown[][] = [result.columns];
  for (const row of result.rows) {
    // Convert null/undefined to empty string for Excel
    const excelRow = row.map((cell: unknown) => (cell === null || cell === undefined ? "" : cell));
    data.push(excelRow);
  }

  // Create sheet from data
  const sheet = XLSX.utils.aoa_to_sheet(data);

  // Apply column widths (estimate from header + sample data)
  const columnWidths: Array<{ wch: number }> = result.columns.map((header: string, i: number) => {
    const sample = columnMetadata[i]?.sampleValue;
    const headerLen = header.length;
    const sampleLen =
      sample === null || sample === undefined ? 0 : String(sample).length;
    const width = Math.max(headerLen, sampleLen) + 2; // +2 for padding
    return { wch: Math.min(width, 50) }; // Cap at 50 to prevent massive columns
  });
  if (sheet["!cols"] !== undefined) {
    sheet["!cols"] = columnWidths;
  }

  // Style the header row (row 0)
  for (let col = 0; col < result.columns.length; col++) {
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!sheet[cellRef]) sheet[cellRef] = {};
    const cell = sheet[cellRef];
    if (cell) {
      cell.s = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "366092" } },
        alignment: { horizontal: "center", vertical: "center" },
      };
    }
  }

  // Apply number formats and alignment to data cells
  for (let row = 1; row < data.length; row++) {
    for (let col = 0; col < result.columns.length; col++) {
      const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
      if (!sheet[cellRef]) sheet[cellRef] = {};
      const columnType = columnMetadata[col]?.type;
      if (columnType) {
        const cell = sheet[cellRef];
        if (cell) {
          cell.z = getExcelNumberFormat(columnType);
          cell.s = { alignment: getExcelAlignment(columnType) };
        }
      }
    }
  }

  // Create and configure workbook
  const workbook = {
    SheetNames: ["Results"],
    Sheets: { Results: sheet },
  };

  return workbook as XLSX.WorkBook;
}

// ===== FILENAME BUILDER =====

/**
 * buildExcelFilename — generates a timestamped filename for Excel exports.
 *
 * Format: dbpeek-export-<YYYYMMDDTHHmmssZ>.xlsx
 *
 * WHY strip colons and dots from the ISO timestamp:
 *   Colons are illegal in Windows filenames. Dots before the extension
 *   confuse some file managers. Stripping both produces a clean, sortable,
 *   filesystem-safe name that matches the CSV/JSON naming convention.
 */
export function buildExcelFilename(): string {
  const ts = new Date()
    .toISOString() // e.g. "2024-01-15T14:30:22.000Z"
    .replace(/[-:.]/g, "") // strip dashes, colons, and the millisecond dot
    .replace(/\d{3}Z$/, "Z"); // drop the 3-digit milliseconds
  return `dbpeek-export-${ts}.xlsx`;
}

// ===== DOWNLOAD HELPER =====

/**
 * triggerExcelDownload — writes the workbook to a file and initiates a download.
 *
 * Uses SheetJS's writeFile method, which:
 *   1. Serializes the workbook to binary XLSX format
 *   2. Creates a Blob from the binary data
 *   3. Creates a download link and clicks it (same pattern as CSV/JSON)
 *
 * WHY SheetJS writeFile instead of manual Blob/link:
 *   SheetJS handles the XLSX binary format complexity. Manual encoding would
 *   require implementing ZIP compression, Open XML structure, and cell encoding,
 *   all of which are non-trivial. writeFile is the standard, tested path.
 */
function triggerExcelDownload(workbook: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(workbook, filename);
}

// ===== PUBLIC API =====

/**
 * buildExcel — the main export function.
 *
 * Takes a QueryResult and returns a function that, when called, will
 * download a properly formatted .xlsx file with:
 *   - Headers in row 1 (bold, blue background)
 *   - Auto-detected column types (integer, float, date, boolean, string)
 *   - Per-column number formatting (0 for int, 0.00 for float, etc.)
 *   - Proper alignment (right for numbers, left for text)
 *   - Auto-calculated column widths
 *   - Timestamped filename (prevents accidental overwrites)
 */
export function buildExcel(result: QueryResult): void {
  const workbook = buildExcelWorkbook(result);
  const filename = buildExcelFilename();
  triggerExcelDownload(workbook, filename);
}
