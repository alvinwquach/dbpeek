/**
 * src/client/components/Schema/DdlViewer.tsx
 *
 * ===== FILE PURPOSE =====
 * Full-screen modal that displays the CREATE TABLE DDL for one table from the
 * connected database. Opened from the "Show DDL" action on a table row in the
 * schema sidebar; closed by Escape, the close (✕) button, or clicking the
 * dimmed backdrop.
 *
 * The DDL itself is rendered in a read-only CodeMirror 6 editor with SQL
 * syntax highlighting (the same lang-sql extension the main editor uses).
 * A Copy button puts the entire DDL string on the system clipboard.
 *
 * ===== ARCHITECTURE =====
 *
 *   DdlViewer (this file)
 *     ├─ TanStack Query keyed on [table]               — fetches /api/schema/:table/ddl
 *     ├─ CodeMirror 6 EditorView (readonly)            — SQL highlighting
 *     │   recreated whenever the DDL string changes    — simplest correct sync
 *     ├─ Copy-to-clipboard button                      — uses navigator.clipboard
 *     └─ Modal scaffolding (backdrop + dialog)         — fixed-position overlay
 *
 * ===== WHY A MODAL (NOT A POPOVER) =====
 *
 * The ColumnStats popover anchors to a 244 px sidebar row because its content
 * is small and "about" that one row. A CREATE TABLE DDL for a wide table can
 * easily run dozens of lines — pinning it to a sidebar row would either clip
 * it or force a tiny scroll area. A centered modal gives the DDL room to
 * breathe and matches the pattern users expect for "view full document"
 * actions in dev tools.
 *
 * ===== WHY CODEMIRROR DIRECT (NO @uiw/react-codemirror) =====
 *
 * The project already mounts CodeMirror imperatively in SqlEditor.tsx. Pulling
 * in a React wrapper would add weight and a second way of doing things. We
 * use the same `new EditorView({ state, parent })` + `view.destroy()` pattern
 * here on a smaller scale (no autocomplete, no schema, no keymap besides the
 * default).
 *
 * ===== TANSTACK QUERY KEY =====
 *
 *   queryKey: ["tableDdl", table]
 *   staleTime: 60 seconds — DDL changes rarely during a session, but unlike
 *     ColumnStats (5 min) we keep this shorter because a user iterating on a
 *     migration will refresh quickly. 60 s is enough to dedupe the obvious
 *     "open, close, reopen" reflow without lasting beyond an active edit.
 */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { bracketMatching } from "@codemirror/language";

// ===== TYPES =====

/** JSON shape returned by GET /api/schema/:table/ddl. */
interface DdlResponse {
  ddl: string;
}

/** Props for the DdlViewer modal. */
interface DdlViewerProps {
  /** Table whose DDL to fetch and display. */
  table: string;
  /** Called when the user dismisses the modal (Escape, ✕, or backdrop click). */
  onClose: () => void;
}

// ===== THEME =====

/**
 * Tightened-down variant of the dbpeek dark palette for the DDL viewer.
 *
 * WHY a separate theme block (vs. reusing SqlEditor's):
 *   The viewer is read-only and embedded in a modal — it doesn't need the
 *   active-line highlight, gutter accent, or focus outlines that the main
 *   editor uses to communicate "you can type here". A leaner theme reads
 *   as "preview" rather than "editor", which is the right signal for a
 *   read-only view.
 */
const ddlTheme = EditorView.theme({
  // Fill the modal body. The parent .cm-editor sits inside a flex container
  // with a flex-1 child, so height: 100% lets it stretch.
  "&": {
    height: "100%",
    backgroundColor: "#0a0a0f",
    color: "#ededf0",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace",
    fontSize: "12.5px",
    lineHeight: "1.55",
  },
  ".cm-gutters": {
    backgroundColor: "#0c0c14",
    borderRight: "1px solid #1f2033",
    color: "#374151",
  },
  ".cm-content": {
    // Read-only editor: hide the caret entirely. CM still renders one when
    // focused otherwise; suppressing it removes the misleading affordance.
    caretColor: "transparent",
  },
});

// ===== ICONS =====

/**
 * Document icon used in the modal header. Suggests "this is a body of text"
 * (the DDL document) rather than the table icon used elsewhere — readers
 * see at a glance that they're looking at a generated artifact, not the
 * live table.
 */
function DocumentIcon() {
  return (
    <svg
      className="w-3.5 h-3.5 shrink-0 text-[#7c85d6]"
      viewBox="0 0 14 14"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 1.5h5L11 4.5V12a.5.5 0 01-.5.5h-7A.5.5 0 013 12V2a.5.5 0 01.5-.5z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M8 1.5V4.5h3" stroke="currentColor" strokeWidth="1" />
      <line
        x1="5"
        y1="7.5"
        x2="9"
        y2="7.5"
        stroke="currentColor"
        strokeWidth="0.75"
      />
      <line
        x1="5"
        y1="9.5"
        x2="9"
        y2="9.5"
        stroke="currentColor"
        strokeWidth="0.75"
      />
    </svg>
  );
}

/**
 * Two-rectangle "copy" glyph. The offset second rectangle is the universal
 * dev-tool convention for "duplicate to clipboard".
 */
function CopyIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <rect
        x="3.5"
        y="3.5"
        width="6"
        height="7"
        rx="1"
        stroke="currentColor"
        strokeWidth="1"
      />
      <path
        d="M6 3.5V2a.5.5 0 01.5-.5h4A.5.5 0 0111 2v6a.5.5 0 01-.5.5H9.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Checkmark glyph swapped in after a successful copy for ~1.5 s of feedback. */
function CheckIcon() {
  return (
    <svg
      className="w-3 h-3 shrink-0"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.5 6.5L5 9L9.5 3.5"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ===== MAIN COMPONENT =====

/**
 * DdlViewer — modal for the CREATE TABLE DDL of one table.
 *
 * RENDER STRATEGY:
 *   1. Mount CodeMirror lazily — only after the DDL string is in hand. There
 *      is no point in rendering an empty editor while the request is in flight;
 *      the loading state is text-only.
 *   2. Re-create the EditorView when the DDL string changes. The viewer is
 *      one-shot per (table, fetch); we don't need the granular dispatch /
 *      compartment dance the main editor uses for live schema swaps.
 *   3. Tear the view down on unmount (and on every re-create) via
 *      view.destroy(). Without this, repeated open/close cycles would leak
 *      EditorView instances and their event listeners.
 */
export function DdlViewer({ table, onClose }: DdlViewerProps) {
  // ── Fetch ────────────────────────────────────────────────────────────────
  // TanStack Query handles the loading / error / cached states. The key is
  // ["tableDdl", table] so two different tables get two different cache
  // entries — closing and reopening the same table within staleTime returns
  // the cached DDL instantly.
  const { data, isLoading, error } = useQuery<DdlResponse>({
    queryKey: ["tableDdl", table],
    queryFn: async () => {
      const res = await fetch(
        `/api/schema/${encodeURIComponent(table)}/ddl`
      );
      if (!res.ok) {
        // Surface the server's { error } message when present — it's typically
        // a database driver string that helps the user diagnose. Falls back
        // to a generic HTTP error if the body isn't JSON.
        let message = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body.error) message = body.error;
        } catch {
          // body wasn't JSON; keep the HTTP-status fallback
        }
        throw new Error(message);
      }
      return (await res.json()) as DdlResponse;
    },
    staleTime: 60_000,
  });

  // ── Container ref + view lifecycle ───────────────────────────────────────
  // The CodeMirror DOM lives in a div managed by React, but the EditorView
  // itself is imperatively mounted into that div. The ref is the bridge.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    // No DDL yet (loading or error) — nothing to mount. The previous view (if
    // any) is destroyed by the cleanup below before this branch runs.
    if (!data?.ddl || !containerRef.current) return;

    // Create a fresh EditorState with the DDL as the document. EditorState.readOnly
    // (a Facet) makes the editor non-editable; selection / scrolling still work.
    // basicSetup-equivalent extensions are intentionally trimmed: line numbers,
    // bracket matching, oneDark, our overlay theme, and SQL highlighting. No
    // history, no autocomplete — those are pure overhead for a viewer.
    const state = EditorState.create({
      doc: data.ddl,
      extensions: [
        lineNumbers(),
        bracketMatching(),
        sql(),
        oneDark,
        ddlTheme,
        EditorState.readOnly.of(true),
      ],
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });
    viewRef.current = view;

    // Cleanup: destroy the view on unmount AND before the next effect run.
    // Strict Mode double-invokes effects in development — destroy() is
    // idempotent and safe to call on an already-destroyed view in practice,
    // but we null the ref to make subsequent reads obvious.
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [data?.ddl]);

  // ── Copy-to-clipboard ────────────────────────────────────────────────────
  // `copied` flips to true on a successful clipboard write and back to false
  // after ~1.5 s. Used to swap the icon and label on the Copy button so the
  // user has a visual "yes, that worked" without a toast system.
  const [copied, setCopied] = useState(false);

  /**
   * Writes the DDL to the system clipboard.
   *
   * WHY navigator.clipboard.writeText (and not document.execCommand):
   *   The Clipboard API is the modern, async-friendly replacement that works
   *   in HTTPS / localhost contexts (which dbpeek always is — the server is
   *   bound to a localhost port). execCommand is deprecated and unreliable
   *   under modern browser security models.
   *
   * WHY a try/catch:
   *   Some browser configurations refuse clipboard writes when the document
   *   does not have user-initiated focus, or when the page is iframed in an
   *   unfriendly context. We swallow the error and skip the success flash —
   *   the user can manually select and copy from the editor as a fallback.
   */
  const handleCopy = async () => {
    if (!data?.ddl) return;
    try {
      await navigator.clipboard.writeText(data.ddl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // intentionally silent — the editor still allows manual selection.
    }
  };

  // ── Escape key + body-scroll lock ────────────────────────────────────────
  // The modal overlays the whole app. Two niceties matter for a dialog:
  //   1. Pressing Escape dismisses the modal.
  //   2. Locking body scroll prevents the page underneath from scrolling
  //      under the user's wheel while the dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    // Save and restore document overflow style on unmount. If two modals were
    // ever stacked, the LIFO save/restore would still produce the right end
    // state because each layer captures the state it sits on top of.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      // Backdrop: full-screen dimmed layer. Clicking it dismisses the modal,
      // mirroring the standard dialog UX.
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        // The dialog itself. stopPropagation on click prevents the backdrop
        // handler above from also dismissing when the user clicks INSIDE the
        // modal (e.g. selecting text).
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`DDL for ${table}`}
        className="flex flex-col w-[min(800px,90vw)] h-[min(640px,80vh)] rounded-md border border-[#1f2033] bg-[#0a0a0f] shadow-2xl overflow-hidden"
      >
        {/* ===== HEADER ===== */}
        <div className="flex items-center gap-2 px-3 h-9 border-b border-[#1f2033] shrink-0">
          <DocumentIcon />
          <span className="text-[11px] uppercase tracking-widest font-semibold text-[#9ca3af]">
            DDL
          </span>
          <span className="text-[#374151]">·</span>
          {/* Table name in the project's monospace stack so it lines up with
              the editor body underneath. truncate guards extremely long names. */}
          <span className="text-[12px] font-mono text-[#ededf0] truncate">
            {table}
          </span>

          {/* Push the action buttons to the right. */}
          <div className="flex-1" />

          {/* Copy button. Disabled until the DDL has loaded so the user
              doesn't see a working button when there's nothing to copy. */}
          <button
            onClick={handleCopy}
            disabled={!data?.ddl}
            className={[
              "flex items-center gap-1.5 px-2 h-6 rounded text-[10.5px] font-mono",
              "border border-[#1f2033] bg-[#0f0f1a]",
              "hover:bg-[#14142b] hover:border-[#3b4070]",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              "transition-colors duration-100",
              copied ? "text-[#34d399]" : "text-[#9ca3af]",
            ].join(" ")}
            aria-label="Copy DDL to clipboard"
            title="Copy DDL to clipboard"
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          {/* Close button — explicit ✕ for users who don't know about Escape. */}
          <button
            onClick={onClose}
            className="ml-1 flex items-center justify-center w-6 h-6 rounded text-[#4b5563] hover:text-[#ededf0] hover:bg-[#14142b] transition-colors duration-100"
            aria-label="Close DDL viewer"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>

        {/* ===== BODY ===== */}
        {/* flex-1 + min-h-0 lets the editor (or status text) fill the rest of
            the modal and scroll independently. */}
        <div className="flex-1 min-h-0 relative">
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] italic text-[#374151] font-mono">
              Loading DDL…
            </div>
          )}

          {!isLoading && error && (
            <div className="absolute inset-0 flex items-start justify-center p-4">
              <div className="w-full p-3 rounded border border-[#3d1f1f] bg-[#130a0a] text-[#f87171] text-[11px] font-mono break-words">
                {error instanceof Error ? error.message : String(error)}
              </div>
            </div>
          )}

          {/* CodeMirror mount point. The view is created in the useEffect
              above once `data.ddl` is non-null. While loading or errored,
              this div renders empty (the absolute-positioned overlay above
              covers it). */}
          {!isLoading && !error && (
            <div ref={containerRef} className="absolute inset-0" />
          )}
        </div>
      </div>
    </div>
  );
}
