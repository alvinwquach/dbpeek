/**
 * src/client/components/Import/parseFile.ts
 *
 * ===== FILE PURPOSE =====
 * Pure file-parsing utilities for the CSV/JSON import workflow.
 * Converts a File object into a { columns, rows } bundle that ImportPreview
 * can map to target table columns and send to POST /api/import.
 *
 * Isolated here (away from the React component) so the parse logic is:
 *   - Testable without a browser DOM or React tree.
 *   - Replaceable independently of the dialog UI.
 *   - Free of React imports (no hooks, no JSX).
 *
 * ===== SUPPORTED FORMATS =====
 *
 *   .csv  — papaparse, header: false (first row = column names).
 *           Empty cells are converted to null (not empty string) because a
 *           blank CSV cell almost never means "the empty string" in a database
 *           context — it means "no value".
 *
 *   .json — JSON.parse. Two shapes are supported:
 *           1. Array of objects: { colA: v, colB: v }[]
 *              Keys of the first object become column names.
 *           2. Array of arrays:  [header, ...rows] where header is a string[].
 *              First inner array becomes column names; "col1", "col2" used as
 *              fallbacks for blank or non-string values.
 *
 * ===== RETURN TYPE =====
 *   Promise<{ columns: string[], rows: unknown[][] }>
 *   Rejects with an Error whose message is user-displayable (shown in the
 *   ImportPreview dialog's error state).
 */

import Papa from "papaparse";

// ===== EXPORTED TYPE =====

/** Normalised parse output, common to both CSV and JSON paths. */
export interface ParseResult {
  /** Column names, in the order they appear in the source file. */
  columns: string[];
  /**
   * Data rows. Each row is a positional array aligned with `columns`.
   * Values are unknown — numbers and booleans from JSON keep their types;
   * CSV cells are strings except blank cells which become null.
   */
  rows: unknown[][];
}

// ===== CSV =====

/**
 * Parses a CSV file into { columns, rows } using papaparse.
 *
 * WHY header: false:
 *   `header: true` discards the raw header row and returns keyed objects.
 *   We need the raw first row so we can run auto-mapping logic (compare source
 *   column names to target table column names). `header: false` preserves it.
 *
 * WHY skipEmptyLines: true:
 *   Trailing newlines in CSV exports (very common) produce empty last rows
 *   that generate all-null INSERT records. Skipping them avoids the surprise.
 *
 * WHY convert "" → null:
 *   A blank cell in a CSV export means "no value", not the empty string.
 *   Sending "" to the database hits NOT NULL constraints and makes nullable
 *   columns contain unexpected empty strings instead of proper NULLs.
 */
async function parseCSV(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data;

        if (data.length === 0) {
          reject(new Error("CSV file is empty."));
          return;
        }
        if (data.length === 1) {
          reject(new Error("CSV has a header row but no data rows to import."));
          return;
        }

        // Non-null assertion safe: data.length >= 2 is verified above.
        const columns = data[0]!.map(String);
        // Blank cell → null; non-blank cells stay as strings.
        const rows: unknown[][] = data
          .slice(1)
          .map((row) => row.map((cell) => (cell === "" ? null : cell)));

        resolve({ columns, rows });
      },
      error: (err) =>
        reject(new Error(`CSV parse error: ${err.message}`)),
    });
  });
}

// ===== JSON =====

/**
 * Parses a JSON file into { columns, rows }.
 *
 * Supports two array shapes:
 *
 *   Array of objects — most common export from databases and spreadsheet tools.
 *     [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
 *     → columns: ["id", "name"]
 *     → rows: [[1, "Alice"], [2, "Bob"]]
 *
 *   Array of arrays — common from Python/pandas CSV-to-JSON exports.
 *     [["id", "name"], [1, "Alice"], [2, "Bob"]]
 *     → columns: ["id", "name"]   (first inner array is the header)
 *     → rows: [[1, "Alice"], [2, "Bob"]]
 *
 * WHY not support a flat single object or nested structures:
 *   Those shapes don't map to tabular data without recursive flattening that
 *   makes column names unpredictable. The two supported shapes cover >99% of
 *   real-world JSON exports. Users with nested data should pre-process it.
 *
 * WHY col-fallback ("col1", "col2"):
 *   An array-of-arrays where the first row contains non-string values (e.g.
 *   numbers) has no usable header. Generating positional names ("col1" etc.)
 *   prevents a crash and lets the user still map or skip columns manually.
 */
async function parseJSON(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        if (typeof text !== "string") {
          reject(new Error("Failed to read file as text."));
          return;
        }

        const parsed: unknown = JSON.parse(text);

        if (!Array.isArray(parsed) || parsed.length === 0) {
          reject(new Error("JSON must be a non-empty array."));
          return;
        }

        const first = parsed[0];

        if (
          typeof first === "object" &&
          first !== null &&
          !Array.isArray(first)
        ) {
          // ── Array of objects ────────────────────────────────────────────────
          // Objects with missing keys produce null for the corresponding column
          // (sparse rows are legal in JSON; the DB default/constraint decides
          //  whether null is acceptable for that column).
          const columns = Object.keys(first as Record<string, unknown>);
          const rows: unknown[][] = (
            parsed as Record<string, unknown>[]
          ).map((obj) => columns.map((col) => obj[col] ?? null));
          resolve({ columns, rows });
        } else if (Array.isArray(first)) {
          // ── Array of arrays ─────────────────────────────────────────────────
          // First array is the header. Non-string / empty values get a
          // positional fallback name so the column is still addressable.
          const columns = (first as unknown[]).map((v, i) =>
            typeof v === "string" && v.trim() !== ""
              ? v.trim()
              : `col${i + 1}`
          );
          const rows: unknown[][] = (parsed as unknown[][]).slice(1);
          resolve({ columns, rows });
        } else {
          reject(
            new Error(
              "JSON must be an array of objects or an array of arrays."
            )
          );
        }
      } catch (err) {
        reject(
          new Error(
            `JSON parse error: ${
              err instanceof Error ? err.message : String(err)
            }`
          )
        );
      }
    };

    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsText(file);
  });
}

// ===== PUBLIC API =====

/**
 * parseFile — dispatches to parseCSV or parseJSON based on the file extension.
 *
 * @param file - The File object from a drag-drop event or an <input type="file">.
 * @returns Promise<ParseResult> — resolves with { columns, rows } on success.
 *   Rejects with an Error whose `.message` is user-displayable.
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") return parseCSV(file);
  if (ext === "json") return parseJSON(file);
  throw new Error(
    `Unsupported file type ".${ext ?? "(unknown)"}". Drop a .csv or .json file.`
  );
}
