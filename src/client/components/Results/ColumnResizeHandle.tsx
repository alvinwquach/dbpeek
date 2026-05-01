/**
 * src/client/components/Results/ColumnResizeHandle.tsx
 *
 * WHAT:
 *   The draggable right-edge handle that appears on resizable table header cells.
 *   Renders as a thin vertical line that becomes indigo on hover or while dragging.
 *
 * WHY a separate file:
 *   ColumnResizeHandle has zero dependencies on TanStack Table state — it only
 *   needs three event-handler props. Extracting it makes ResultsTable.tsx easier
 *   to scan and lets the handle be tested or reused independently.
 */

// ===== COMPONENT =====

/** Props for ColumnResizeHandle. */
interface ColumnResizeHandleProps {
  /** TanStack Table's resize mouse-down handler for this column header. */
  onMouseDown: (e: React.MouseEvent) => void;
  /** TanStack Table's resize touch-start handler for this column header. */
  onTouchStart: (e: React.TouchEvent) => void;
  /** True while the user is actively dragging this column's resize handle. */
  isResizing: boolean;
}

/**
 * ColumnResizeHandle — the draggable right-edge handle for column resizing.
 *
 * WHY absolute positioning at right: 0:
 *   The handle must sit at the exact right edge of the <th> without adding to
 *   the column's content width. absolute + right-0 achieves this while keeping
 *   the column header text unaffected.
 *
 * The cursor changes to col-resize on hover to signal that dragging is possible.
 * The thin line gives a visual affordance even without hover.
 */
export function ColumnResizeHandle({
  onMouseDown,
  onTouchStart,
  isResizing,
}: ColumnResizeHandleProps) {
  return (
    <div
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      className={[
        "absolute top-0 right-0 h-full w-[5px] cursor-col-resize select-none touch-none",
        "flex items-center justify-center",
        "group/resizer",
        isResizing ? "opacity-100" : "opacity-0 hover:opacity-100",
      ].join(" ")}
      aria-hidden="true"
    >
      {/* Visual indicator line — turns indigo while resizing or on hover */}
      <div
        className={[
          "w-px h-3/4 rounded-full",
          isResizing ? "bg-[#6366f1]" : "bg-[#3b3d5c] group-hover/resizer:bg-[#6366f1]",
          "transition-colors duration-100",
        ].join(" ")}
      />
    </div>
  );
}
