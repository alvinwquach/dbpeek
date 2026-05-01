/**
 * tests/client/export.test.ts
 *
 * WHAT:
 *   Unit tests for the three pure export functions exported from ExportMenu.tsx:
 *     - csvEscapeField  — RFC 4180 per-field quoting
 *     - buildCsv        — full CSV serialization of a QueryResult
 *     - buildJson       — JSON array-of-objects serialization
 *     - buildFilename   — timestamped filename generation
 *
 * WHY test pure functions instead of the React component:
 *   The correctness of the export feature lives entirely in these four
 *   functions. The React component is structural wiring (dropdown open/close,
 *   button disabled state) that is better covered by Playwright e2e tests.
 *   Testing the pure functions gives fast, deterministic coverage of the
 *   logic that matters most: data integrity during serialization.
 *
 * ENVIRONMENT: jsdom (set in vitest.client.config.ts)
 *   jsdom is required because ExportMenu.tsx imports from a module that
 *   references browser globals (Blob, URL). The tests themselves only call
 *   pure functions, but the import chain triggers those references.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  csvEscapeField,
  buildCsv,
  buildJson,
  buildFilename,
} from "../../src/client/components/Results/ExportMenu";
import type { QueryResult } from "../../src/client/types";

// ===== HELPERS =====

/**
 * makeResult — builds a minimal QueryResult for use in tests.
 *
 * WHY a helper instead of inline literals:
 *   executionTime and rowCount are always required by the type but irrelevant
 *   to export correctness. Centralising the defaults keeps test bodies focused
 *   on the columns/rows under test.
 */
function makeResult(
  columns: string[],
  rows: unknown[][]
): QueryResult {
  return { columns, rows, rowCount: rows.length, executionTime: 1 };
}

// ===== csvEscapeField =====

describe("csvEscapeField", () => {
  // ── Passthrough (no escaping needed) ──────────────────────────────────────

  it("returns plain strings unchanged", () => {
    expect(csvEscapeField("hello")).toBe("hello");
  });

  it("converts numbers to strings without quoting", () => {
    expect(csvEscapeField(42)).toBe("42");
    expect(csvEscapeField(3.14)).toBe("3.14");
  });

  it("converts booleans to strings without quoting", () => {
    expect(csvEscapeField(true)).toBe("true");
    expect(csvEscapeField(false)).toBe("false");
  });

  // ── null / undefined → empty cell ─────────────────────────────────────────

  it("returns empty string for null", () => {
    expect(csvEscapeField(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(csvEscapeField(undefined)).toBe("");
  });

  // ── RFC 4180 quoting: comma ────────────────────────────────────────────────

  it("wraps fields containing a comma in double-quotes", () => {
    expect(csvEscapeField("hello, world")).toBe('"hello, world"');
  });

  it("wraps column names containing a comma", () => {
    expect(csvEscapeField("last, first")).toBe('"last, first"');
  });

  // ── RFC 4180 quoting: double-quote escape ──────────────────────────────────

  it('wraps fields containing a double-quote and escapes it by doubling', () => {
    // RFC 4180 §2.7: embedded double-quotes are escaped as ""
    expect(csvEscapeField('say "hello"')).toBe('"say ""hello"""');
  });

  it("handles a field that is only a double-quote character", () => {
    expect(csvEscapeField('"')).toBe('""""');
  });

  it("handles multiple double-quotes in one field", () => {
    // "a""b""c" is the RFC 4180 encoding of: a"b"c
    expect(csvEscapeField('a"b"c')).toBe('"a""b""c"');
  });

  // ── RFC 4180 quoting: newlines ─────────────────────────────────────────────

  it("wraps fields containing a newline (\\n)", () => {
    expect(csvEscapeField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("wraps fields containing a carriage return (\\r)", () => {
    expect(csvEscapeField("line1\rline2")).toBe('"line1\rline2"');
  });

  // ── Objects / arrays → JSON.stringify ────────────────────────────────────

  it("JSON-stringifies objects", () => {
    const val = { a: 1 };
    // The stringified form doesn't contain commas in this case: {"a":1}
    expect(csvEscapeField(val)).toBe('"{""a"":1}"');
  });

  it("JSON-stringifies arrays", () => {
    // [1,2,3] contains a comma, so it must be quoted
    expect(csvEscapeField([1, 2, 3])).toBe('"[1,2,3]"');
  });
});

// ===== buildCsv =====

describe("buildCsv", () => {
  // ── Header row ─────────────────────────────────────────────────────────────

  it("emits a header row as the first line", () => {
    const result = makeResult(["id", "name"], []);
    const csv = buildCsv(result).replace(/^﻿/, ""); // strip BOM before splitting
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("id,name");
  });

  it("produces only a header row (plus trailing CRLF) for zero data rows", () => {
    const result = makeResult(["id"], []);
    // BOM + "id\r\n"
    const csv = buildCsv(result);
    // After stripping BOM the content is "id\r\n"
    const withoutBom = csv.replace(/^﻿/, "");
    expect(withoutBom).toBe("id\r\n");
  });

  // ── Data rows ──────────────────────────────────────────────────────────────

  it("emits one data row per result row", () => {
    const result = makeResult(["x"], [[1], [2], [3]]);
    const csv = buildCsv(result);
    const withoutBom = csv.replace(/^﻿/, "");
    const lines = withoutBom.split("\r\n").filter(Boolean);
    // header + 3 data rows = 4 lines
    expect(lines).toHaveLength(4);
  });

  it("maps each cell to the correct column position", () => {
    const result = makeResult(["a", "b"], [["alpha", "beta"]]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    const lines = withoutBom.split("\r\n").filter(Boolean);
    expect(lines[1]).toBe("alpha,beta");
  });

  // ── CSV special-character escaping ────────────────────────────────────────

  it("quotes cells that contain commas", () => {
    const result = makeResult(["note"], [["hello, world"]]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    const lines = withoutBom.split("\r\n").filter(Boolean);
    expect(lines[1]).toBe('"hello, world"');
  });

  it('doubles embedded double-quotes in cell values', () => {
    const result = makeResult(["q"], [['say "hi"']]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    const lines = withoutBom.split("\r\n").filter(Boolean);
    expect(lines[1]).toBe('"say ""hi"""');
  });

  it("quotes column names that contain commas", () => {
    const result = makeResult(["last, first"], [["Doe, John"]]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    const lines = withoutBom.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe('"last, first"');
    expect(lines[1]).toBe('"Doe, John"');
  });

  it("renders null cells as empty fields (no quotes)", () => {
    const result = makeResult(["val"], [[null]]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    // Don't use .filter(Boolean) here — the data row IS an empty string and
    // would be removed. Split on CRLF and index directly instead.
    const lines = withoutBom.split("\r\n");
    // lines[0] = "val" (header), lines[1] = "" (empty cell), lines[2] = "" (trailing CRLF)
    expect(lines[1]).toBe("");
  });

  // ── Line endings ───────────────────────────────────────────────────────────

  it("uses CRLF line endings throughout (RFC 4180 §2.4)", () => {
    const result = makeResult(["id", "name"], [[1, "Alice"], [2, "Bob"]]);
    const withoutBom = buildCsv(result).replace(/^﻿/, "");
    // Every line break should be CRLF, not bare LF
    // Check: splitting on CRLF then re-joining on LF should match no bare \r
    expect(withoutBom).not.toMatch(/(?<!\r)\n/);
    // And every \r should be followed by \n
    expect(withoutBom).not.toMatch(/\r(?!\n)/);
  });

  // ── BOM ────────────────────────────────────────────────────────────────────

  it("starts with a UTF-8 BOM (U+FEFF) for Excel compatibility", () => {
    const result = makeResult(["x"], [[1]]);
    expect(buildCsv(result).charCodeAt(0)).toBe(0xfeff);
  });
});

// ===== buildJson =====

describe("buildJson", () => {
  // ── Shape ──────────────────────────────────────────────────────────────────

  it("returns a JSON array", () => {
    const result = makeResult(["id"], [[1]]);
    const parsed = JSON.parse(buildJson(result));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("returns an empty array for zero rows", () => {
    const result = makeResult(["id", "name"], []);
    expect(JSON.parse(buildJson(result))).toEqual([]);
  });

  // ── Column names as keys ──────────────────────────────────────────────────

  it("uses column names as object keys", () => {
    const result = makeResult(["id", "name"], [[1, "Alice"]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0]).toHaveProperty("id");
    expect(parsed[0]).toHaveProperty("name");
  });

  it("maps cell values to the correct column name", () => {
    const result = makeResult(["id", "name"], [[42, "Bob"]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0].id).toBe(42);
    expect(parsed[0].name).toBe("Bob");
  });

  it("serializes null cells as JSON null (not empty string)", () => {
    const result = makeResult(["val"], [[null]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0].val).toBeNull();
  });

  it("preserves numeric values without stringifying them", () => {
    const result = makeResult(["price"], [[19.99]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0].price).toBe(19.99);
  });

  it("preserves boolean values", () => {
    const result = makeResult(["active"], [[true]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0].active).toBe(true);
  });

  it("preserves nested objects (e.g. JSONB columns)", () => {
    const obj = { foo: "bar", n: 1 };
    const result = makeResult(["meta"], [[obj]]);
    const parsed = JSON.parse(buildJson(result));
    expect(parsed[0].meta).toEqual(obj);
  });

  // ── Multiple rows ──────────────────────────────────────────────────────────

  it("emits one object per result row in order", () => {
    const result = makeResult(
      ["id", "name"],
      [[1, "Alice"], [2, "Bob"], [3, "Carol"]]
    );
    const parsed = JSON.parse(buildJson(result));
    expect(parsed).toHaveLength(3);
    expect(parsed[0].id).toBe(1);
    expect(parsed[1].id).toBe(2);
    expect(parsed[2].id).toBe(3);
  });

  // ── Pretty-print ──────────────────────────────────────────────────────────

  it("indents the output with 2 spaces", () => {
    const result = makeResult(["x"], [[1]]);
    const json = buildJson(result);
    // JSON.stringify(arr, null, 2) indents array items 2 spaces and object
    // keys a further 2 spaces (4 total). Verify the object key sits at 4 spaces.
    expect(json).toContain('\n    "x"');
  });
});

// ===== buildFilename =====

describe("buildFilename", () => {
  // ── Freeze time so the timestamp is deterministic ──────────────────────────

  beforeEach(() => {
    // Freeze Date to 2024-01-15T14:30:22.000Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T14:30:22.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Prefix ────────────────────────────────────────────────────────────────

  it("starts with 'dbpeek-export-'", () => {
    expect(buildFilename("csv")).toMatch(/^dbpeek-export-/);
    expect(buildFilename("json")).toMatch(/^dbpeek-export-/);
  });

  // ── Extension ─────────────────────────────────────────────────────────────

  it("ends with .csv for the csv format", () => {
    expect(buildFilename("csv")).toMatch(/\.csv$/);
  });

  it("ends with .json for the json format", () => {
    expect(buildFilename("json")).toMatch(/\.json$/);
  });

  // ── Timestamp format ──────────────────────────────────────────────────────

  it("embeds the ISO timestamp without colons or millisecond dots", () => {
    // 2024-01-15T14:30:22.000Z → 20240115T143022Z
    expect(buildFilename("csv")).toBe("dbpeek-export-20240115T143022Z.csv");
  });

  it("produces a different filename for json extension", () => {
    expect(buildFilename("json")).toBe("dbpeek-export-20240115T143022Z.json");
  });

  // ── Filesystem safety ─────────────────────────────────────────────────────

  it("contains no colons (illegal on Windows)", () => {
    // Colons from the ISO timestamp must be stripped
    expect(buildFilename("csv")).not.toContain(":");
  });

  it("contains no spaces", () => {
    expect(buildFilename("csv")).not.toContain(" ");
  });

  // ── Uniqueness across runs ────────────────────────────────────────────────

  it("produces a different filename when the clock advances", () => {
    const first = buildFilename("csv");
    vi.setSystemTime(new Date("2024-01-15T14:30:23.000Z"));
    const second = buildFilename("csv");
    expect(first).not.toBe(second);
  });
});
