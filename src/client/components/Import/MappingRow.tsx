/**
 * src/client/components/Import/MappingRow.tsx
 *
 * ===== FILE PURPOSE =====
 * One row in the column-mapping grid inside ImportPreview.
 *
 * Each row represents one source column (from the uploaded file) and offers a
 * <select> dropdown on the right that lets the user choose which target column
 * in the database table to map it to, or "— Skip —" to exclude it from the
 * import.
 *
 * ===== WHY A SEPARATE COMPONENT =====
 * ImportPreview maps over `sourceColumns` (potentially 50+ entries for wide
 * CSVs). Each row has its own onChange handler. Extracting MappingRow:
 *
 *   1. Keeps ImportPreview's JSX flat — the mapping section is a single
 *      `sourceColumns.map(...)` rather than a large inline block.
 *
 *   2. Enables React.memo later: a row only re-renders when its own `value`
 *      or the shared `tableColumns` list changes — not when any other row
 *      changes its mapping.
 *
 *   3. Makes the select-styling and label-truncation rules local to one file,
 *      so they're easy to find and change.
 *
 * ===== MAPPING SEMANTICS =====
 *
 *   value = ""            → "— Skip —" selected; this source column is excluded.
 *   value = "colName"     → maps the source column to the named target column.
 *
 * The parent (ImportPreview) maintains `mapping: string[]` where each entry
 * corresponds to a source column by index. When the user changes the select,
 * `onChange(newValue)` fires and the parent updates that index.
 */

import type { ColumnInfo } from "../../hooks/useSchema";

// ===== COMPONENT =====

/**
 * MappingRow — one row in the source → target column-mapping grid.
 *
 * @param sourceCol   The column name as it appears in the uploaded file.
 * @param value       Currently selected target column name, or "" for Skip.
 * @param tableColumns All columns in the target table (options for the dropdown).
 * @param onChange    Called with the new target column name (or "") on change.
 */
export function MappingRow({
  sourceCol,
  value,
  tableColumns,
  onChange,
}: {
  sourceCol: string;
  value: string;
  tableColumns: ColumnInfo[];
  onChange: (targetCol: string) => void;
}) {
  // Build a tooltip for the <select> when the current target column is matched:
  // shows the column type and PK flag as a quick reminder without opening the
  // full column-stats popover.
  const matchedCol = tableColumns.find((c) => c.name === value);

  return (
    <div className="flex items-center gap-2 py-[3px]">
      {/* ── Source column name ──────────────────────────────────────────────
          min-w-0 + truncate: source column names can be very long in wide
          CSVs (e.g. Salesforce exports). Truncating with a title tooltip
          prevents the two-column layout from blowing out for long names.
      */}
      <span
        className="flex-1 min-w-0 truncate text-[11px] font-mono text-[#ededf0]"
        title={sourceCol}
      >
        {sourceCol}
      </span>

      {/* ── Directional arrow ──────────────────────────────────────────────
          Purely decorative — reinforces "source maps to target" without
          needing a column header to re-state it on every row.
      */}
      <span className="shrink-0 text-[#374151] text-[10px]" aria-hidden="true">
        →
      </span>

      {/* ── Target column dropdown ──────────────────────────────────────────
          WHY a native <select> (not a Radix dropdown):
            Radix's Select adds ~8 KB and ARIA complexity that is unnecessary
            for a plain list of column names. The native select is keyboard-
            navigable, screen-reader-friendly, and behaves identically on all
            platforms. We style it with a dark background to match the rest of
            the UI; `appearance-none` is intentionally NOT applied so the
            browser's native dropdown arrow signals "there are more options"
            without us needing to render a custom chevron.

          WHY value="" for Skip:
            The empty string is distinct from any real database column name
            (which must be non-empty). Using "" as the sentinel avoids a magic
            string constant and makes the filter `pairs.filter(p => p.target !== "")`
            straightforward to read.
      */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={
          matchedCol
            ? `${matchedCol.type}${matchedCol.isPrimaryKey ? " · PK" : ""}`
            : undefined
        }
        className="w-[160px] shrink-0 h-6 pl-2 pr-1 text-[11px] font-mono rounded border border-[#1f2033] bg-[#0d0d17] text-[#ededf0] focus:outline-none focus:border-[#3b4070] cursor-pointer"
      >
        {/* Skip option — exclude this source column from the import. */}
        <option value="">— Skip —</option>

        {/* One option per target table column. PK/FK labels hint at constraints
            the user should be aware of when deciding whether to map. */}
        {tableColumns.map((col) => (
          <option key={col.name} value={col.name}>
            {col.name}
            {col.isPrimaryKey ? " (PK)" : col.foreignKey ? " (FK)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
