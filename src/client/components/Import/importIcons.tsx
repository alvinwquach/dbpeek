/**
 * src/client/components/Import/importIcons.tsx
 *
 * ===== FILE PURPOSE =====
 * Small icon components used exclusively inside the ImportPreview dialog.
 * Kept here (not in Schema/tree/icons.tsx) because they are dialog-specific
 * and not needed anywhere else in the schema sidebar.
 *
 * WHY separate from the sidebar icons file:
 *   Schema/tree/icons.tsx is imported by every sub-module of the schema tree
 *   (TableRow, ContextMenu, etc.). Adding import-dialog-specific icons there
 *   would pull them into those components' bundles even though they are never
 *   used outside ImportPreview.
 */

// ===== ICONS =====

/**
 * Green circle-check icon shown in the ImportPreview header after a successful
 * import, replacing the upload arrow to signal "done".
 *
 * WHY a circle around the check (not a bare checkmark):
 *   The circle provides visual weight equivalent to the ImportIcon (an upload
 *   arrow inside a tray) so the header doesn't shift when the icon swaps.
 *   The green fill also scans instantly as "success" without reading the text.
 */
export function CheckCircleIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-[#34d399]"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M4.5 7L6.5 9L9.5 5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Three-dot animated bounce indicator shown while parsing or importing.
 *
 * WHY dots instead of a spinning ring:
 *   A ring spinner requires a full CSS animation keyframe and looks heavy at
 *   the 10–11 px size used in the dialog footer and status line. Three bouncing
 *   dots are lighter visually and communicate "working, please wait" without
 *   implying a determinate amount of progress.
 *
 * WHY inline animationDelay style (not a Tailwind variant):
 *   Tailwind's `animation-delay` utilities require @tailwindcss/animate or
 *   arbitrary value syntax (e.g. `[animation-delay:0.12s]`). The arbitrary
 *   variant produces longer class names with no readability benefit for a
 *   3-item stagger. A direct style prop is clearer here.
 */
export function Spinner() {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-[3px] h-[3px] rounded-full bg-current animate-bounce"
          style={{ animationDelay: `${i * 0.12}s` }}
        />
      ))}
    </span>
  );
}
