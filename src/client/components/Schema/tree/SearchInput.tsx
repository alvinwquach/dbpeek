/**
 * src/client/components/Schema/tree/SearchInput.tsx
 *
 * ===== FILE PURPOSE =====
 * Controlled search input pinned below the SchemaTree header.
 *
 * WHY a dedicated sub-component:
 *   The input bundles three concerns — the magnifying-glass icon, the text
 *   field, and the clear (✕) button — into one renderable unit. Extracting it
 *   keeps SchemaTree's JSX focused on the table-list rendering logic and makes
 *   the input testable in isolation (e.g. verifying that the clear button
 *   resets the value). It also prevents the icon import from cluttering the
 *   parent module.
 *
 * HOW IT WORKS:
 *   Fully controlled: the parent owns `value` (via useState) and passes
 *   `onChange` down. This component never holds local state — it only renders
 *   the current value and calls onChange when the user types or clicks clear.
 */

import { SearchIcon } from "./icons";

// ===== COMPONENT =====

/**
 * SearchInput — icon + text input + optional clear button.
 *
 * Rendered below the "Schema" header in SchemaTree. The value drives the
 * filteredTables and filteredPinnedTables memos in the parent, so any change
 * here immediately updates which tables and columns are visible.
 *
 * @param value    The current search string (controlled by parent).
 * @param onChange Called with the new string on every keystroke or on clear.
 */
export function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="px-2 py-2 border-b border-[#1f2033] shrink-0">
      <div className="flex items-center gap-1.5 px-2 h-6 rounded bg-[#0f0f1a] border border-[#1f2033] focus-within:border-[#3b4070] transition-colors duration-100">
        <SearchIcon />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search tables and columns…"
          className="flex-1 min-w-0 bg-transparent outline-none text-[11px] text-[#ededf0] placeholder:text-[#374151] font-mono"
          aria-label="Search schema"
        />
        {/* Clear button — only visible when there's text to clear. */}
        {value !== "" && (
          <button
            onClick={() => onChange("")}
            className="text-[#4b5563] hover:text-[#9ca3af] transition-colors duration-100 text-[10px]"
            aria-label="Clear search"
            title="Clear search"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
