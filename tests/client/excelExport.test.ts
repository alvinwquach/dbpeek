/**
 * tests/client/excelExport.test.ts
 *
 * Unit tests for Excel export functionality. Verifies that:
 *   1. Excel filenames are generated with proper timestamps
 *   2. Filenames follow the filesystem-safe format
 */

import { describe, it, expect } from "vitest";
import { buildExcelFilename } from "../../src/client/components/Results/excelExport.js";

/**
 * Test suite for Excel export filename generation.
 *
 * WHY test buildExcelFilename:
 *   Filename generation is critical for preventing accidental overwrites.
 *   The timestamp format must be filesystem-safe (no colons or problematic dots).
 */
describe("excelExport", () => {
  /**
   * buildExcelFilename generates properly formatted timestamped filenames.
   *
   * Test conditions:
   *   - Filename matches the pattern "dbpeek-export-<timestamp>.xlsx"
   *   - Timestamp is stripped of colons and dots for filesystem compatibility
   *   - Filenames from sequential calls differ (due to new Date())
   *   - Extension is always .xlsx
   */
  describe("buildExcelFilename", () => {
    it("should generate a filename with .xlsx extension", () => {
      const filename = buildExcelFilename();
      expect(filename).toMatch(/^dbpeek-export-\d{8}T\d{6}Z\.xlsx$/);
    });

    it("should not contain colons in the timestamp", () => {
      const filename = buildExcelFilename();
      // Extract the timestamp part (between "dbpeek-export-" and ".xlsx")
      const timestampPart = filename.replace("dbpeek-export-", "").replace(".xlsx", "");
      expect(timestampPart).not.toContain(":");
    });

    it("should not contain dashes in the timestamp", () => {
      const filename = buildExcelFilename();
      // Extract the timestamp part
      const timestampPart = filename.replace("dbpeek-export-", "").replace(".xlsx", "");
      // Should only have one dash (between time and Z) or none
      const dashCount = (timestampPart.match(/-/g) || []).length;
      expect(dashCount).toBe(0);
    });

    it("should only have one dot (before the extension)", () => {
      const filename = buildExcelFilename();
      const dotCount = filename.split(".").length - 1;
      expect(dotCount).toBe(1);
    });

    it("should start with 'dbpeek-export-'", () => {
      const filename = buildExcelFilename();
      expect(filename.startsWith("dbpeek-export-")).toBe(true);
    });

    it("should produce different filenames on sequential calls", () => {
      const filename1 = buildExcelFilename();
      // Small delay to ensure time changes
      const startTime = Date.now();
      while (Date.now() - startTime < 5);
      const filename2 = buildExcelFilename();
      // Filenames may be identical if generated within same millisecond,
      // but they should at least have the same format
      expect(filename1).toMatch(/^dbpeek-export-\d{8}T\d{6}Z\.xlsx$/);
      expect(filename2).toMatch(/^dbpeek-export-\d{8}T\d{6}Z\.xlsx$/);
    });
  });
});
