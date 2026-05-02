/**
 * src/client/components/Schema/tree/ColumnRow.tsx
 *
 * ===== FILE PURPOSE =====
 * A single column entry rendered under an expanded table in the SchemaTree.
 *
 * WHY a button (not a div) for the row container:
 *   The whole row is a click target that opens the ColumnStats popover.
 *   <button> gives correct keyboard semantics (Enter / Space activate, focus
 *   indicator) without manual ARIA wiring.
 *
 * KEY-INDICATOR BADGES:
 *   PK (amber)  — primary key
 *   FK (blue)   — foreign key reference
 *   IX (purple) — has at least one index (other than PK/FK)
 *
 *   Multiple flags can apply to one column (a PK is usually also IX). We render
 *   each badge independently so readers can identify each role at a glance —
 *   collapsing them into a single "key" badge would lose information.
 */

import type { ColumnInfo } from "../../../hooks/useSchema";

// ===== HELPER: short type label =====

/**
 * Maps a dialect-native type label to a short, scannable badge text.
 *
 * WHY a dedicated helper rather than rendering the raw type:
 *   The raw types are verbose and dialect-specific:
 *     "character varying(255)"     (Postgres)
 *     "int(11) unsigned"           (MySQL)
 *     "TIMESTAMP WITHOUT TIME ZONE" (Postgres)
 *     "nvarchar"                   (MSSQL)
 *   For a 244 px sidebar that's too much chrome. The user wants a glance:
 *   "is this an int? a string? a timestamp?". Short tokens deliver that.
 *
 * STRATEGY:
 *   1. Lowercase + take the head token (prefix up to whitespace or `(`).
 *   2. Map a known set of heads to canonical short labels.
 *   3. Fallback: return the head as-is so unknown types still appear.
 */
function shortTypeBadge(type: string): string {
  const head = type.toLowerCase().trim().split(/[\s(]/)[0] ?? "";

  if (head === "uuid") return "uuid";
  if (head === "json" || head === "jsonb") return "json";
  if (head.startsWith("timestamp")) return "timestamp";
  if (head === "datetime" || head === "datetime2") return "datetime";
  if (head === "date") return "date";
  if (head === "time") return "time";
  if (head === "bool" || head === "boolean" || head === "bit") return "bool";
  if (
    head === "int" ||
    head === "integer" ||
    head === "bigint" ||
    head === "smallint" ||
    head === "tinyint" ||
    head === "mediumint" ||
    head === "int2" ||
    head === "int4" ||
    head === "int8"
  ) {
    return "int";
  }
  if (head === "serial" || head === "bigserial" || head === "smallserial") {
    return "serial";
  }
  if (head === "numeric" || head === "decimal" || head === "dec") {
    return "numeric";
  }
  if (
    head === "real" ||
    head === "double" ||
    head === "float" ||
    head === "float4" ||
    head === "float8"
  ) {
    return "float";
  }
  if (head === "money" || head === "smallmoney") return "money";
  if (head === "text" || head === "longtext" || head === "mediumtext" || head === "tinytext") {
    return "text";
  }
  if (head === "varchar" || head === "nvarchar" || head === "character") {
    return "varchar";
  }
  if (head === "char" || head === "nchar") return "char";
  if (head === "blob" || head === "bytea" || head === "varbinary") return "blob";
  if (head === "enum") return "enum";
  if (head === "interval") return "interval";

  // Fallback: keep the head token. Unknown types are still informative even
  // if they don't match a curated label.
  return head || type;
}

// ===== KEY BADGE =====

/**
 * KeyBadge — a small uppercase pill used for PK / FK / IX flags.
 *
 * WHY a shared component:
 *   The three badges share identical layout and only differ in label, color,
 *   and tooltip. Sharing the wrapper guarantees the visual pill (size,
 *   spacing, border) stays consistent across all three.
 */
function KeyBadge({
  label,
  colorClass,
  title,
}: {
  label: string;
  /** Tailwind classes that set text + border colors. */
  colorClass: string;
  title: string;
}) {
  return (
    <span
      title={title}
      className={[
        "shrink-0 inline-flex items-center justify-center w-5 h-3.5 rounded",
        "text-[8.5px] font-mono font-semibold tracking-wider uppercase",
        "bg-[#0d0d17] border",
        colorClass,
      ].join(" ")}
      aria-label={title}
    >
      {label}
    </span>
  );
}

// ===== COLUMN ROW =====

/**
 * ColumnRow — a single column entry under an expanded table in the SchemaTree.
 *
 * Renders the type badge, column name (with nullable "?" suffix), and any
 * key-indicator badges (PK / FK / IX). The entire row is a <button> so
 * clicking it opens the ColumnStats popover in the parent SchemaTree.
 *
 * @param info        Full column metadata from the schema fetch.
 * @param isSelected  True when this column's stats popover is currently open.
 * @param onClick     Called when the user clicks the row; opens the stats popover.
 */
export function ColumnRow({
  info,
  isSelected,
  onClick,
}: {
  info: ColumnInfo;
  isSelected: boolean;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const typeLabel = shortTypeBadge(info.type);

  return (
    <li>
      <button
        onClick={onClick}
        className={[
          "w-full flex items-center gap-1.5 pl-3 pr-2 h-5 text-left",
          "hover:bg-[#0f0f1a] transition-colors duration-75",
          isSelected ? "bg-[#14142b]" : "",
        ].join(" ")}
        title={`${info.name} : ${info.type}${info.nullable ? "" : " NOT NULL"}${
          info.foreignKey
            ? ` → ${info.foreignKey.table}.${info.foreignKey.column}`
            : ""
        }`}
      >
        {/* Type badge — short label in muted slate. */}
        <span className="shrink-0 px-1 h-3.5 inline-flex items-center rounded text-[8.5px] font-mono uppercase tracking-wider text-[#6b7280] bg-[#0d0d17] border border-[#1f2033]">
          {typeLabel}
        </span>

        {/* Column name — truncates if it overflows. */}
        <span className="flex-1 min-w-0 truncate text-[10.5px] font-mono text-[#9ca3af]">
          {info.name}
          {/* A "?" suffix flags a nullable column at a glance. */}
          {info.nullable && (
            <span className="text-[#374151]" aria-hidden="true">?</span>
          )}
        </span>

        {/* Key badges — order matters: PK | FK | IX. */}
        {info.isPrimaryKey && (
          <KeyBadge label="PK" colorClass="text-[#f59e0b] border-[#3d2c14]" title="Primary key" />
        )}
        {info.foreignKey && (
          <KeyBadge
            label="FK"
            colorClass="text-[#60a5fa] border-[#1e2f4d]"
            title={`Foreign key → ${info.foreignKey.table}.${info.foreignKey.column}`}
          />
        )}
        {/* Show IX only if it's NOT already implied by PK/FK to keep the
            row uncluttered. The autocomplete-first definition of "indexed"
            still includes PK/FK indexes; the badge is for "explicit secondary
            index" which is the more interesting signal in a UI. */}
        {info.isIndexed && !info.isPrimaryKey && !info.foreignKey && (
          <KeyBadge label="IX" colorClass="text-[#a78bfa] border-[#2b1f4d]" title="Indexed" />
        )}
      </button>
    </li>
  );
}
