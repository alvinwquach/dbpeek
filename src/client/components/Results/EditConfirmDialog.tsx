/**
 * src/client/components/Results/EditConfirmDialog.tsx
 *
 * WHAT:
 *   Modal dialog shown immediately before any cell-edit UPDATE fires. Surfaces
 *   the dialect-correct SQL string the server is about to execute, plus a
 *   stat row (table / column / pk identity / new value) so the user can
 *   double-check the target before clicking "Run UPDATE".
 *
 * WHY a confirmation step:
 *   The double-click → type → Enter flow makes destructive edits trivially
 *   easy to fire. A confirmation step is the same safety net DBeaver and
 *   TablePlus add for the same reason — the keystroke that commits the
 *   change should be deliberate, not absent-minded. The dialog also gives
 *   us a place to render the resulting UPDATE so an experienced user can
 *   spot a wrong-row mistake before it lands.
 *
 * WHY a portal-less, plain-React modal (not Radix Dialog or @headlessui):
 *   The rest of the project uses lightweight Tailwind-on-bare-JSX dialogs
 *   for the small handful of modals it needs (SessionReport). Pulling in
 *   another dialog primitive just for this one screen is unnecessary and
 *   would mean two competing patterns. The fixed-position backdrop + a
 *   centred panel + Escape/Enter handlers cover what we need.
 *
 * KEYBOARD:
 *   Enter   → confirm (runs the UPDATE)
 *   Escape  → cancel (no SQL fires)
 *   Tab     → cycles between Cancel and Run buttons normally
 */

import { useEffect, useRef } from "react";

// ===== TYPES =====

export interface EditConfirmDialogProps {
  /** SQL string to display, pre-formatted with dialect-correct quoting. */
  sql: string;
  /** Table being updated. Surfaced as a labelled stat above the SQL. */
  table: string;
  /** Column being updated. */
  column: string;
  /** New value the user typed. Rendered with a NULL/boolean badge as needed. */
  newValue: unknown;
  /**
   * Map of pk-column → pk-value used to identify the target row. Rendered
   * compactly as `id = 42` (or `parent_id = 1, seq = 7` for composite PKs).
   */
  pk: Record<string, unknown>;
  /** Called when the user confirms (Enter or "Run UPDATE" click). */
  onConfirm: () => void;
  /** Called when the user cancels (Escape, ✕, or "Cancel" click). */
  onCancel: () => void;
  /** True while the PUT request is in flight. Disables both buttons. */
  saving: boolean;
}

// ===== HELPERS =====

/**
 * formatDisplayValue — renders a JS value for the "New value" stat line.
 *
 * Distinct from the SQL formatter (buildUpdateSql.ts) because the dialog
 * shows a friendlier representation: NULL is italicised gray, booleans get
 * coloured badges, objects render as compact JSON. The SQL panel below
 * still shows the strict SQL-literal form, so the user sees both the value
 * AS-DATA and the value AS-SQL.
 */
function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// ===== COMPONENT =====

/**
 * EditConfirmDialog — confirmation modal for inline cell edits.
 *
 * RENDERED CONDITIONALLY by ResultsTable when a save is pending. Owns no
 * state of its own; lifts every lifecycle decision (open / confirm / cancel)
 * to the parent.
 */
export function EditConfirmDialog({
  sql,
  table,
  column,
  newValue,
  pk,
  onConfirm,
  onCancel,
  saving,
}: EditConfirmDialogProps) {
  // Auto-focus the confirm button when the dialog mounts so Enter alone is
  // enough to commit. The cancel button receives focus via Tab if the user
  // wants to reconsider without reaching for the mouse.
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  // ── Global keyboard handlers ─────────────────────────────────────────────
  // Bound to window so they fire regardless of which child element has focus
  // (the SQL <code> block can swallow Enter if focused). Cleanup on unmount
  // keeps the listeners scoped to the dialog's lifetime.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (saving) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        // Only react to bare Enter, not Shift/Alt/Cmd+Enter, so the user can
        // still do other Enter-keyed shortcuts globally if any are bound.
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onConfirm();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onConfirm, onCancel, saving]);

  // ── Render ──────────────────────────────────────────────────────────────

  // Render the pk row compactly: `id = 42` or `a = 1, b = 2`. Using the same
  // formatDisplayValue keeps NULLs / objects readable in the row identity
  // panel (it is unusual but legal for a PK column to be NULL on some
  // dialects when uniqueness is enforced via partial index).
  const pkText = Object.entries(pk)
    .map(([k, v]) => `${k} = ${formatDisplayValue(v)}`)
    .join(", ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0f]/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-confirm-title"
      // Click-on-backdrop cancels (matches macOS sheet conventions). The inner
      // panel stops propagation so clicks INSIDE the panel don't dismiss it.
      onClick={onCancel}
    >
      <div
        className="w-[560px] max-w-[92vw] rounded border border-[#1f2033] bg-[#0d0d17] shadow-2xl shadow-black/70"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 h-9 border-b border-[#1f2033]">
          <h2
            id="edit-confirm-title"
            className="text-[10px] uppercase tracking-widest text-[#4b5563] font-mono"
          >
            Confirm cell update
          </h2>
          <button
            onClick={onCancel}
            disabled={saving}
            aria-label="Cancel"
            className="text-[#4b5563] hover:text-[#ededf0] disabled:opacity-40 transition-colors duration-100 text-sm leading-none"
          >
            ×
          </button>
        </div>

        {/* ── Stats grid ───────────────────────────────────────────────── */}
        <div className="px-4 py-3 space-y-1.5 text-xs font-mono">
          <div className="flex gap-2">
            <span className="text-[#4b5563] w-16 shrink-0">Table</span>
            <span className="text-[#ededf0] truncate">{table}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#4b5563] w-16 shrink-0">Column</span>
            <span className="text-[#ededf0] truncate">{column}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#4b5563] w-16 shrink-0">Row</span>
            <span className="text-[#ededf0] truncate">{pkText}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#4b5563] w-16 shrink-0">New value</span>
            {newValue === null || newValue === undefined ? (
              <span className="italic text-[#4b5563]">NULL</span>
            ) : typeof newValue === "boolean" ? (
              <span className={newValue ? "text-[#34d399]" : "text-[#f87171]"}>
                {String(newValue)}
              </span>
            ) : (
              <span className="text-[#ededf0] break-all">
                {formatDisplayValue(newValue)}
              </span>
            )}
          </div>
        </div>

        {/* ── SQL preview ──────────────────────────────────────────────── */}
        {/* The user is committing to whatever this string represents — render
            it in a code block with horizontal scroll so very long literals
            (long string values, JSON blobs) don't reflow into something
            misleading. */}
        <div className="px-4 pb-3">
          <div className="text-[10px] uppercase tracking-widest text-[#4b5563] font-mono mb-1">
            SQL
          </div>
          <pre className="text-[11px] font-mono text-[#ededf0] bg-[#0a0a0f] border border-[#1f2033] rounded px-3 py-2 overflow-x-auto whitespace-pre">
            {sql}
          </pre>
        </div>

        {/* ── Footer buttons ───────────────────────────────────────────── */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#1f2033]">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-3 h-7 text-[10px] font-semibold uppercase tracking-wider rounded bg-transparent hover:bg-[#1a1a2e] text-[#9ca3af] border border-[#1f2033] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={saving}
            className="px-3 h-7 text-[10px] font-semibold uppercase tracking-wider rounded bg-blue-900/40 hover:bg-blue-800/50 active:bg-blue-800/60 text-blue-300 border border-blue-700/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-100"
          >
            {saving ? "Saving…" : "Run UPDATE"}
          </button>
        </div>
      </div>
    </div>
  );
}
