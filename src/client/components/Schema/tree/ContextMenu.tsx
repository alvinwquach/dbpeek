/**
 * src/client/components/Schema/tree/ContextMenu.tsx
 *
 * ===== FILE PURPOSE =====
 * The single-item right-click context menu that appears over a table row
 * in the SchemaTree sidebar.
 *
 * ===== DESIGN DECISIONS =====
 *
 * WHY a single-item menu instead of a plain button:
 *   The right-click pattern is the user's learned gesture for "what can I do
 *   with this thing". A context menu meets that expectation and leaves room to
 *   add future actions (e.g. "Copy table name", "Count rows") without adding
 *   icon-button chrome to every row in the sidebar.
 *
 * WHY fixed positioning at (x, y):
 *   The menu should appear exactly where the user right-clicked — not pinned
 *   to the sidebar edge or to the row's bounding box. fixed + clientX/clientY
 *   gives that behavior and also escapes the sidebar's overflow-y-auto clip.
 *
 * DISMISSAL:
 *   - Click outside (mousedown anywhere outside the menu panel)
 *   - Escape key (useEffect that listens on document)
 *   Both paths call onClose.
 *
 * VIEWPORT CLAMPING:
 *   If the cursor is near the right or bottom edge the menu would overflow.
 *   We clamp by applying max-w-[220px] and letting the browser clip naturally —
 *   acceptable for a 1-item menu that's very narrow. A full right-click library
 *   would measure the menu and flip it; that's overkill for one item.
 */

import { useEffect, useRef } from "react";
import { StarFilledIcon } from "./icons";

// ===== COMPONENT =====

/**
 * ContextMenu — the single-item right-click menu that appears over a table row.
 *
 * Rendered as a sibling at the SchemaTree root so it uses fixed viewport
 * positioning and is NOT clipped by the sidebar's overflow-y-auto. Only one
 * context menu can be open at a time — opening a new one via right-click on a
 * different row replaces the previous one.
 *
 * @param table       Table the menu targets — shown in aria-label.
 * @param x           Horizontal viewport position (clientX) in px.
 * @param y           Vertical viewport position (clientY) in px.
 * @param isPinned    Whether the table is currently pinned — controls the label.
 * @param onPinToggle Called when the user clicks the pin/unpin menu item.
 * @param onClose     Called when the menu should close (click-outside or Escape).
 */
export function ContextMenu({
  table,
  x,
  y,
  isPinned,
  onPinToggle,
  onClose,
}: {
  /** Table the menu targets. */
  table: string;
  /** Horizontal viewport position in px. */
  x: number;
  /** Vertical viewport position in px. */
  y: number;
  /** Whether the table is currently pinned — controls the menu item label. */
  isPinned: boolean;
  /** Called when the user clicks the pin/unpin item. */
  onPinToggle: () => void;
  /** Called when the menu should close (click-outside or Escape). */
  onClose: () => void;
}) {
  // Ref for the menu panel — used to detect "click outside" (any mousedown
  // that is NOT inside the panel) so we can close the menu.
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Dismiss on Escape ──────────────────────────────────────────────────────
  useEffect(() => {
    /**
     * Close the menu when the user presses Escape.
     *
     * WHY attach to document (not the menu div):
     *   The menu div may not have focus — the user right-clicked, not tabbed
     *   to the menu. Listening on document ensures we catch the key regardless
     *   of which element has focus.
     */
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Dismiss on click-outside ───────────────────────────────────────────────
  useEffect(() => {
    /**
     * Close the menu when the user mousedowns outside the panel.
     *
     * WHY mousedown (not click):
     *   `click` fires AFTER mouseup. If the user mousedowns outside and then
     *   mouseups on the menu, `click` would fire on the menu — confusing. Using
     *   `mousedown` catches the intent before release.
     */
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  return (
    /*
     * Invisible full-viewport backdrop. Intercepts right-clicks elsewhere so
     * the browser's native context menu doesn't appear while our menu is open.
     * The div itself does NOT close the menu on click — the mousedown handler
     * above handles dismissal so we don't need a click handler here.
     */
    <div
      className="fixed inset-0 z-50"
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Menu panel — anchored at the cursor position. */}
      <div
        ref={menuRef}
        style={{ top: y, left: x }}
        className={[
          "absolute z-50 min-w-[160px] max-w-[220px]",
          "rounded border border-[#1f2033] bg-[#0d0d1a] shadow-xl",
          "py-1",
        ].join(" ")}
        role="menu"
        aria-label={`Actions for ${table}`}
      >
        {/* ── Menu item: Pin / Unpin ── */}
        <button
          onClick={onPinToggle}
          className={[
            "w-full flex items-center gap-2 px-3 h-7 text-left",
            "text-[11px] font-mono text-[#ededf0]",
            "hover:bg-[#14142b] transition-colors duration-75",
          ].join(" ")}
          role="menuitem"
        >
          {/* Star icon signals the pin/favorite action. */}
          <span
            className={isPinned ? "text-[#f59e0b]" : "text-[#4b5563]"}
            aria-hidden="true"
          >
            <StarFilledIcon />
          </span>
          {isPinned ? "Unpin table" : "Pin to top"}
        </button>
      </div>
    </div>
  );
}
