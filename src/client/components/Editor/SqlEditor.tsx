/**
 * src/client/components/Editor/SqlEditor.tsx
 *
 * WHAT:
 *   A React component that mounts a CodeMirror 6 SQL editor into the DOM,
 *   with live schema-aware autocomplete powered by the connected database.
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
 *   Compartment  — a wrapper that makes a slice of the extension tree hot-
 *                  swappable at runtime, without tearing down the whole editor.
 *                  We use one to hold the sql() language extension so we can
 *                  inject the live schema object after the initial mount.
 *
 * REACT / CODEMIRROR BRIDGE:
 *   The EditorView is an imperative widget, not a React component. We bridge
 *   them via two refs:
 *     containerRef  — the <div> element that becomes the CM parent.
 *     viewRef       — holds the live EditorView so callbacks can read its state.
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
 *
 * SCHEMA AUTOCOMPLETE ARCHITECTURE:
 *   @codemirror/lang-sql's sql() function accepts a `schema` option shaped as:
 *     { tableName: ["col1", "col2", ...], ... }
 *   When this is present the extension provides:
 *     - Table name completion after FROM, JOIN, UPDATE, INTO, etc.
 *     - Column name completion after "tableName." (dot notation).
 *     - SQL keyword completion everywhere (SELECT, WHERE, GROUP BY, …).
 *   Completions are triggered automatically on every keystroke — no Ctrl+Space
 *   needed.  The dropdown shows a type badge for each entry: "table", "column",
 *   or "keyword".
 *
 *   The schema arrives asynchronously (fetched by useSchema on App mount).  To
 *   avoid recreating the editor when it lands, the sql() extension lives inside
 *   a Compartment.  When schemaMap changes in Zustand, a second useEffect
 *   dispatches compartment.reconfigure(sql({ schema: schemaMap })) — a cheap
 *   transaction that swaps only the language extension while preserving cursor,
 *   undo stack, and selection.
 */

import { useEffect, useRef, useMemo } from "react";
import { EditorState, Compartment } from "@codemirror/state";
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
import { sql, type SQLNamespace } from "@codemirror/lang-sql";
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { useAppStore } from "../../stores/app";

// ===== UTILITIES =====

/**
 * toggleLineComments — toggles SQL line comments (-- prefix) on each line
 * of the given text. If a line starts with --, it's uncommented. Otherwise
 * it's commented.
 */
function toggleLineComments(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("--")) {
        // Remove comment and preserve original indentation
        const indent = line.match(/^\s*/)?.[0] ?? "";
        return indent + trimmed.slice(2).trimStart();
      } else if (trimmed.length > 0) {
        // Add comment, preserve indentation
        const indent = line.match(/^\s*/)?.[0] ?? "";
        return indent + "-- " + trimmed;
      }
      return line; // Empty lines stay empty
    })
    .join("\n");
}

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
   * Wires into the Zustand updateTab action so tab.sql stays in sync.
   */
  onChange?: (sql: string) => void;
  /**
   * Called with the selected text when Cmd/Shift+Enter is pressed.
   * If no selection, called with the full document.
   */
  onRunSelection?: (sql: string) => void;
  /**
   * Called when Cmd+/ is pressed to toggle line comments (-- prefix).
   */
  onToggleLineComment?: (sql: string) => void;
  /**
   * The SQL content to show on first mount.
   * After mount, the editor owns its document — prop changes are ignored
   * EXCEPT when `tabId` changes (tab switch), which resets the document to
   * the new tab's stored SQL via a dedicated effect below.
   */
  initialDoc?: string;
  /**
   * The id of the currently active tab.
   * When this changes the editor replaces its document with the SQL stored
   * in the new tab, preserving the cursor at position 0.
   */
  tabId?: string | undefined;
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
  onRunSelection,
  onToggleLineComment,
  initialDoc = "",
  tabId,
}: SqlEditorProps) {
  // ── Zustand: schema map + active tab SQL ──────────────────────────────────
  // schemaMap: null until useSchema completes; triggers the reconfigure effect.
  // tabs + activeTabIndex: used in both the tab-switch effect and the loadNonce
  // effect to read the stored SQL for the currently active tab.
  // loadNonce: a per-tab counter incremented by loadSqlFromHistory(); when it
  // changes the nonce effect below replaces the CodeMirror document with the
  // new tab.sql value, mirroring how the tab-switch effect works but for
  // in-place SQL injections (history, schema preview) without a tab change.
  const schemaMap = useAppStore((s) => s.schemaMap);
  const tabs = useAppStore((s) => s.tabs);
  const activeTabIndex = useAppStore((s) => s.activeTabIndex);
  const loadNonce = useAppStore((s) => s.tabs[s.activeTabIndex]?.loadNonce ?? 0);

  // The <div> that CM will mount its DOM tree into.
  const containerRef = useRef<HTMLDivElement>(null);

  // Holds the live EditorView after mount so it can be destroyed on cleanup.
  const viewRef = useRef<EditorView | null>(null);

  // ── Language compartment ──────────────────────────────────────────────────
  // A Compartment wraps the sql() language extension so we can hot-swap it
  // (with a new schema object) via a dispatch transaction, without tearing
  // down the entire EditorView.  The compartment instance must be stable
  // across renders — useMemo with an empty dep array guarantees this.
  //
  // WHY useMemo instead of useRef:
  //   Both give stable values across renders, but useMemo makes the intent
  //   explicit: "compute once, never recompute." useRef would work but the
  //   initializer runs inside the render function regardless — there's no
  //   functional difference here, just semantics.
  const sqlCompartment = useMemo(() => new Compartment(), []);

  // ── Callback refs (the "always-current" pattern) ─────────────────────────
  // These are assigned synchronously on every render, before any effects fire.
  // The closures inside useEffect always call .current, so they always get the
  // latest version of the callback without needing to close over it directly.
  const onRunRef = useRef<(sql: string) => void>(onRun);
  const onChangeRef = useRef<((sql: string) => void) | undefined>(onChange);
  const onRunSelectionRef = useRef<((sql: string) => void) | undefined>(
    onRunSelection
  );
  const onToggleLineCommentRef = useRef<((sql: string) => void) | undefined>(
    onToggleLineComment
  );
  onRunRef.current = onRun;
  onChangeRef.current = onChange;
  onRunSelectionRef.current = onRunSelection;
  onToggleLineCommentRef.current = onToggleLineComment;

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

          // ── Language support (inside a Compartment) ───────────────────────
          // Wrapped in sqlCompartment so the schema can be hot-swapped later
          // via compartment.reconfigure(sql({ schema: ... })) without
          // recreating the editor.  On initial mount the schema is null, so we
          // start with keyword-only completion and upgrade once useSchema loads.
          sqlCompartment.of(sql()),

          // ── Editing enhancements ──────────────────────────────────────────
          // Undo/redo history stack (Cmd+Z, Cmd+Shift+Z).
          history(),
          // Highlight matching bracket pairs: ( [ { " '
          bracketMatching(),
          // Re-indent the current line when typing ;, ), }, etc.
          indentOnInput(),
          // Dropdown autocomplete for SQL keywords and schema items.
          // `activateOnTyping: true` makes completions appear on every keystroke
          // (the default), not just on explicit Ctrl+Space.
          autocompletion({ activateOnTyping: true }),

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
            // Cmd+Shift+Enter runs only the selected text (or full doc if no selection).
            {
              key: "Mod-Shift-Enter",
              run: (v) => {
                const selectedText = v.state.sliceDoc(
                  v.state.selection.main.from,
                  v.state.selection.main.to
                );
                const textToRun = selectedText || v.state.doc.toString();
                onRunSelectionRef.current?.(textToRun);
                return true;
              },
            },
            // Cmd+/ toggles line comments (-- prefix) on selected lines.
            {
              key: "Mod-/",
              run: (v) => {
                const { from, to } = v.state.selection.main;
                const selectedText = v.state.sliceDoc(from, to);
                const toggled = toggleLineComments(selectedText);
                onToggleLineCommentRef.current?.(toggled);
                // Update the editor with the toggled text
                v.dispatch({
                  changes: { from, to, insert: toggled },
                  selection: { anchor: from },
                });
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

  // ── Schema reconfigure effect ─────────────────────────────────────────────
  // Runs whenever schemaMap changes in Zustand (null → populated, or refreshed).
  // Dispatches a Compartment.reconfigure() transaction to swap in a new sql()
  // extension that carries the live schema object.
  //
  // WHY this is a separate effect from the mount effect:
  //   The mount effect runs once with [] deps. If we put schema reconfiguration
  //   inside it, we'd have to add schemaMap as a dep — which would recreate the
  //   entire editor (and lose cursor position + undo history) every time the
  //   schema changes. A separate effect with [schemaMap] as its dep reconfigures
  //   only the compartment slot, leaving the rest of the editor state intact.
  //
  // WHY we cast schemaMap to SQLNamespace:
  //   SQLNamespace is { [name: string]: SQLNamespace } | string[] | Completion[].
  //   SchemaMap is Record<string, string[]> which satisfies the nested-object
  //   variant — TypeScript just needs the explicit cast because SchemaMap's
  //   leaf values are string[] not SQLNamespace (even though string[] IS a valid
  //   SQLNamespace leaf).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    // Build the sql() config: no schema = keyword-only; schema present = full
    // table + column + keyword completions.
    const sqlExtension =
      schemaMap != null
        ? sql({ schema: schemaMap as SQLNamespace, upperCaseKeywords: false })
        : sql();

    view.dispatch({
      effects: sqlCompartment.reconfigure(sqlExtension),
    });
  }, [schemaMap, sqlCompartment]);

  // ── Tab-switch effect ─────────────────────────────────────────────────────
  // Runs when tabId changes (i.e. the user clicked a different tab).
  // Replaces the CodeMirror document with the SQL stored in the newly active
  // tab, placing the cursor at position 0 so the view doesn't jump mid-document.
  //
  // WHY we use a dispatch transaction instead of recreating the editor:
  //   Recreating would blow away the undo history and flash the editor.
  //   A replaceWith transaction swaps only the document content — the schema
  //   compartment, theme, and keymaps all survive intact.
  //
  // WHY we read from tabs[activeTabIndex].sql instead of closing over tabId:
  //   tabId changing is the signal to reload; the content source of truth is
  //   the store (tabs array), not a separate prop.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    const newSql = tabs[activeTabIndex]?.sql ?? "";
    const currentSql = view.state.doc.toString();

    // Skip the dispatch if the content is already identical — avoids a
    // spurious history entry and an unnecessary re-render cycle.
    if (newSql === currentSql) return;

    view.dispatch({
      changes: { from: 0, to: currentSql.length, insert: newSql },
      // Reset cursor to start of document so the view doesn't scroll to a
      // position that doesn't exist in the newly loaded SQL.
      selection: { anchor: 0 },
    });
  // tabId is the trigger; tabs + activeTabIndex provide the content to load.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  // ── External SQL injection effect (history / schema preview) ─────────────
  // Fires when loadNonce increments — meaning an external caller (e.g. the
  // history panel) wrote new SQL directly into the active tab via
  // loadSqlFromHistory(). The tab id has NOT changed, so the tab-switch effect
  // above won't fire. We read tabs[activeTabIndex].sql (just updated in the
  // store by that action) and dispatch a CodeMirror document-replacement
  // transaction so the editor reflects the change immediately.
  //
  // WHY a separate effect keyed on loadNonce instead of reusing [tabId]:
  //   tabId only changes on tab switches. loadNonce changes on in-place SQL
  //   injections within the same tab. Merging them would require tabId to
  //   change every time the history panel injects SQL, which would be wrong.
  //
  // WHY we skip nonce === 0:
  //   Every tab starts at loadNonce: 0. We don't want the effect to fire
  //   on initial mount or on tab switches (the tab-switch effect handles those).
  //   A nonce of 0 means "never been externally loaded", so we bail early.
  useEffect(() => {
    if (loadNonce === 0) return;

    const view = viewRef.current;
    if (!view) return;

    const newSql = tabs[activeTabIndex]?.sql ?? "";
    const currentSql = view.state.doc.toString();

    // Guard: skip if the editor already shows the correct content. This
    // prevents a spurious undo-history entry when the injected SQL happens
    // to match what the user had already typed.
    if (newSql === currentSql) return;

    view.dispatch({
      changes: { from: 0, to: currentSql.length, insert: newSql },
      // Reset cursor to start so the view doesn't scroll to a stale position.
      selection: { anchor: 0 },
    });
  // loadNonce is the trigger; tabs + activeTabIndex supply the content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNonce]);

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
