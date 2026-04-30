/**
 * src/client/components/Editor/SqlEditor.tsx
 *
 * WHAT:
 *   A React component that mounts a CodeMirror 6 SQL editor into the DOM.
 *
 * WHY CodeMirror 6 instead of Monaco:
 *   Monaco ships ~5–10 MB of JS. CodeMirror 6 is ~300 KB. dbpeek is distributed
 *   via `npx`, so every KB counts. CodeMirror also has a cleaner extension model
 *   that lets us compose exactly the features we need and nothing else.
 *
 * HOW — CodeMirror 6 core concepts:
 *   EditorState  — an IMMUTABLE snapshot of the document, selection, and all
 *                  extension state. You never mutate it; every edit produces a
 *                  new state via a transaction.
 *   EditorView   — the live DOM widget that owns the <div> rendered to the page.
 *                  It subscribes to state changes and keeps the DOM in sync.
 *                  Must be destroyed on component unmount (view.destroy()).
 *   Extensions   — composable units that bolt on behavior: syntax highlighting,
 *                  keymaps, themes, line numbers, autocomplete, etc.
 *
 * REACT / CODEMIRROR BRIDGE:
 *   The EditorView is an imperative widget, not a React component. We bridge
 *   them via two refs:
 *     containerRef — the <div> element that becomes the CM parent.
 *     viewRef      — holds the live EditorView so callbacks can read its state.
 *   The useEffect creates the view exactly once and returns view.destroy() as
 *   its cleanup. React Strict Mode double-invokes effects in development, so the
 *   cleanup must be idempotent — view.destroy() is.
 *
 * CALLBACK STABILITY (the ref trick):
 *   The keymap closure and updateListener both capture callbacks (onRun, onChange).
 *   If those callbacks changed reference on every render, we'd have to recreate
 *   the entire EditorView to give it the latest version — losing cursor position,
 *   undo history, and causing a visible flash. Instead we store them in refs and
 *   update the refs on every render. The closure always calls ref.current, so it
 *   always reaches the latest version without any CM teardown.
 */

import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  type ViewUpdate,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  dropCursor,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { sql } from "@codemirror/lang-sql";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { bracketMatching, indentOnInput } from "@codemirror/language";

// ===== THEME =====

/**
 * dbpeekTheme overrides the oneDark theme's background and gutter colors to
 * match the app-wide dark palette (bg-[#0a0a0f], sidebar bg-[#0c0c14]).
 *
 * WHY placed AFTER oneDark in the extensions array:
 *   CodeMirror 6 themes are applied in extension order. A later theme wins on
 *   conflicting selectors. Placing dbpeekTheme after oneDark ensures our
 *   background overrides land without needing `!important` everywhere.
 *
 * Selector reference:
 *   "&"                    — the .cm-editor root element
 *   "&.cm-focused"         — root when the editor has keyboard focus
 *   ".cm-scroller"         — the scrollable wrapper inside .cm-editor
 *   ".cm-gutters"          — the gutter region (line numbers)
 *   ".cm-activeLineGutter" — gutter cell on the cursor's current line
 *   ".cm-activeLine"       — the cursor's current line in the content area
 *   ".cm-selectionBackground" — selection highlight
 *   ".cm-placeholder"      — the placeholder text (from the placeholder() ext)
 */
const dbpeekTheme = EditorView.theme({
  // Root element must fill its container so the editor panel stretches to 100%.
  "&": {
    height: "100%",
    backgroundColor: "#0a0a0f",
    color: "#ededf0",
  },
  // Remove the default blue browser outline on focus; the activeLine highlight
  // already provides a clear visual indicator of focus.
  "&.cm-focused": {
    outline: "none",
  },
  // Scroller is the actual scrollable content area. We configure the font stack
  // here because CM renders code text inside .cm-scroller > .cm-content.
  ".cm-scroller": {
    overflow: "auto",
    fontFamily:
      "'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  // Gutter: slightly darker than the editor background, matches the sidebar.
  ".cm-gutters": {
    backgroundColor: "#0c0c14",
    borderRight: "1px solid #1f2033",
    color: "#374151",
  },
  // Active line gutter cell is a touch brighter than the inactive gutter.
  ".cm-activeLineGutter": {
    backgroundColor: "#0f0f1a",
    color: "#6b7280",
  },
  // Active line background: subtle, just enough to locate the cursor at a glance.
  ".cm-activeLine": {
    backgroundColor: "#0f0f1a",
  },
  // Text cursor.
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "#ededf0",
  },
  // Selection highlight. !important because oneDark's specificity wins otherwise.
  ".cm-selectionBackground, ::selection": {
    backgroundColor: "#2a2a4a !important",
  },
  // Placeholder italic text shown when the editor is empty.
  ".cm-placeholder": {
    color: "#2d3047",
    fontStyle: "italic",
  },
});

// ===== TYPES =====

/** Props for the SqlEditor component. */
interface SqlEditorProps {
  /** Called with the full SQL string when Cmd/Ctrl+Enter is pressed. */
  onRun: (sql: string) => void;
  /**
   * Called on every keystroke with the current editor content.
   * Use this to keep the Zustand tab store (tab.sql) in sync with the editor.
   */
  onChange?: (sql: string) => void;
  /**
   * The SQL content to populate on first mount.
   * Changes to this prop after mount are intentionally ignored — CodeMirror
   * owns the editor state. To programmatically reset the document, expose an
   * imperative handle via useImperativeHandle (out of scope for Phase 1).
   */
  initialDoc?: string;
}

// ===== COMPONENT =====

/**
 * SqlEditor — mounts a CodeMirror 6 editor into a ref-attached div.
 *
 * WHY useEffect with an empty dep array:
 *   The editor must be created once and destroyed once. Re-creating it on every
 *   render would lose cursor position and undo history. All prop changes flow
 *   through refs (onRunRef, onChangeRef) instead of causing a recreation.
 *
 * WHY the container div has role="textbox" / aria-multiline:
 *   CodeMirror renders its own accessible textarea internally, but screen
 *   readers need the wrapper to be identifiable as an editable region too.
 */
export function SqlEditor({
  onRun,
  onChange,
  initialDoc = "",
}: SqlEditorProps) {
  // The <div> that CM will mount its DOM tree into.
  const containerRef = useRef<HTMLDivElement>(null);

  // Holds the live EditorView after mount so it can be destroyed on cleanup.
  const viewRef = useRef<EditorView | null>(null);

  // ── Callback refs (the "always-current" pattern) ─────────────────────────
  // These are assigned synchronously on every render, before any effects fire.
  // The closures inside useEffect always call .current, so they always get the
  // latest version of the callback without needing to close over it directly.
  const onRunRef = useRef<(sql: string) => void>(onRun);
  const onChangeRef = useRef<((sql: string) => void) | undefined>(onChange);
  onRunRef.current = onRun;
  onChangeRef.current = onChange;

  // ── Editor setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDoc,
        extensions: [
          // ── Visual aids ───────────────────────────────────────────────────
          // Line numbers in the left gutter.
          lineNumbers(),
          // Highlight the line the cursor is on (background + gutter number).
          highlightActiveLine(),
          highlightActiveLineGutter(),
          // Native text-selection rendering (needed on some browsers for CM6).
          drawSelection(),
          // Show a cursor at the position where a drag-and-drop would insert.
          dropCursor(),

          // ── Language support ──────────────────────────────────────────────
          // SQL syntax highlighting and keyword/identifier autocompletion.
          // sql() defaults to StandardSQL. We can later pass `{ dialect, schema }`
          // here to get table/column completions from the schema sidebar.
          sql(),

          // ── Editing enhancements ──────────────────────────────────────────
          // Undo/redo history stack (Cmd+Z, Cmd+Shift+Z).
          history(),
          // Highlight matching bracket pairs: ( [ { " '
          bracketMatching(),
          // Re-indent the current line when typing ;, ), }, etc.
          indentOnInput(),
          // Dropdown autocomplete for SQL keywords and future schema items.
          autocompletion(),

          // ── Themes ───────────────────────────────────────────────────────
          // oneDark provides syntax token colors (keywords, strings, comments).
          oneDark,
          // dbpeekTheme overrides backgrounds, gutters, and font to match the app.
          // Must come AFTER oneDark so its selectors take precedence.
          dbpeekTheme,

          // ── Placeholder ───────────────────────────────────────────────────
          // Shown only when the editor document is empty. Fades out on first keystroke.
          placeholder(
            "-- Connect to a database and run a query\nSELECT * FROM ..."
          ),

          // ── Keybindings ───────────────────────────────────────────────────
          keymap.of([
            // PRIMARY: Cmd+Enter (Mac) / Ctrl+Enter (Win/Linux) runs the query.
            // "Mod" is CodeMirror's cross-platform alias for Cmd/Ctrl.
            // Returning `true` marks the event as handled so the browser doesn't
            // also act on it (some browsers interpret Ctrl+Enter to submit forms).
            {
              key: "Mod-Enter",
              run: (v) => {
                onRunRef.current(v.state.doc.toString());
                return true;
              },
            },
            // Tab / Shift+Tab: indent/dedent the selection by one level.
            // Must be before defaultKeymap so Tab is not captured by default first.
            indentWithTab,
            // Standard text editing: arrows, Home/End, Backspace, Delete, etc.
            ...defaultKeymap,
            // Undo (Cmd+Z) and redo (Cmd+Shift+Z / Cmd+Y).
            ...historyKeymap,
            // Tab / Enter to accept the highlighted autocomplete suggestion.
            ...completionKeymap,
          ]),

          // ── Change listener ───────────────────────────────────────────────
          // Fires on every transaction that modifies the document. We use it to
          // keep the Zustand tab store (tab.sql) in sync with the editor content.
          // Using ref.current means we never need to recreate the editor when the
          // onChange prop identity changes (e.g., after a Zustand selector update).
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              onChangeRef.current?.(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: containerRef.current,
    });

    viewRef.current = view;

    // Cleanup: destroy the view when the component unmounts.
    // In React Strict Mode this runs twice in development — that's fine, because
    // the second effect re-creates the view from scratch with no side effects.
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — editor is created once; props flow through refs

  return (
    // The div that CodeMirror mounts into. w-full h-full makes it fill the
    // flex-1 panel allocated in App.tsx.
    <div
      ref={containerRef}
      className="w-full h-full"
      // These ARIA attributes help screen readers identify the editable region.
      // CodeMirror also renders its own internal accessible textarea, so this
      // is supplemental context for the wrapper element.
      role="textbox"
      aria-multiline="true"
      aria-label="SQL editor"
    />
  );
}
