/**
 * src/client/components/Editor/SqlEditor.tsx
 *
 * WHAT: A React wrapper around a CodeMirror 6 editor pre-configured for SQL
 * with PostgreSQL syntax highlighting, one-dark theme, and a Cmd/Ctrl+Enter
 * keymap that submits the query.
 *
 * WHY: The plain <textarea> in the original EditorPane offered no syntax
 * highlighting, no line numbers, and no code-aware keyboard shortcuts. CodeMirror
 * gives us all of that in a single component while keeping React out of the
 * hot path — the editor manages its own internal document state so the parent
 * never re-renders on every keystroke.
 *
 * HOW: Imported by App.tsx's EditorPane. The parent must pass an `onRun`
 * callback; it is called with the full editor content when Cmd/Ctrl+Enter is
 * pressed. The parent controls tab switching by supplying `key={activeTab.id}`,
 * which forces React to unmount/remount this component (and therefore create a
 * fresh EditorView) whenever the active tab changes.
 */

import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql, PostgreSQL } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion } from '@codemirror/autocomplete';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SqlEditorProps {
  /**
   * SQL text to populate the editor with at mount time.
   * Not reactive — changing this prop after mount has no effect.
   * Use `key` to force a remount with new content instead.
   */
  initialValue?: string;
  /**
   * Called with the full editor content when the user presses Cmd/Ctrl+Enter.
   * This is the only mechanism by which content leaves the editor — the parent
   * never reads the SQL on each keystroke.
   */
  onRun: (sql: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * SqlEditor
 *
 * Renders a CodeMirror 6 editor configured for SQL. The editor owns its
 * document state; React only mounts/unmounts it.
 *
 * Key design decisions:
 *   - The EditorView is created once per mount (useEffect with empty deps).
 *     Recreating it on every render would reset cursor position, undo history,
 *     and fold state — a jarring experience for the user.
 *   - `onRun` is stored in a ref (onRunRef) so the keymap closure can always
 *     call the latest version of the callback without being recreated whenever
 *     the parent re-renders with a new function identity.
 *   - Tab switching is handled by the parent via `key={activeTab.id}`, not by
 *     programmatically swapping the document inside an existing EditorView.
 *     Remounting is simpler and guarantees a clean slate (undo history, etc.).
 *
 * @param initialValue - Starting SQL text (default: empty string).
 * @param onRun        - Callback invoked with the full editor content on Cmd/Ctrl+Enter.
 *
 * @example
 *   <SqlEditor
 *     key={activeTab.id}
 *     initialValue={activeTab.sql}
 *     onRun={(sql) => execute(sql)}
 *   />
 */
export function SqlEditor({ initialValue = '', onRun }: SqlEditorProps) {
  // The container div that CodeMirror will attach itself to. We use a ref
  // rather than an id so this component is safe to mount multiple times on
  // the same page (e.g. one per tab).
  const containerRef = useRef<HTMLDivElement>(null);

  // Store the latest onRun in a ref so the keymap closure (created once at
  // mount) always calls the current callback, even if the parent re-renders
  // and produces a new function identity. Without this, the keymap would hold
  // a stale closure referencing the callback from the first render.
  const onRunRef = useRef(onRun);

  // Keep the ref up to date on every render (cheap synchronous assignment).
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  // ── CodeMirror mount / unmount ─────────────────────────────────────────────

  useEffect(() => {
    // PSEUDOCODE:
    // 1. Guard: bail out if the container ref isn't attached yet (shouldn't happen,
    //    but useEffect can theoretically fire before the DOM is ready in SSR).
    // 2. Build the EditorState with all extensions:
    //    a. history()        — undo/redo
    //    b. lineNumbers()    — gutter with line numbers
    //    c. sql(PostgreSQL)  — syntax highlighting + keyword autocomplete
    //    d. oneDark          — colour theme
    //    e. autocompletion() — popup for SQL keyword suggestions
    //    f. keymap           — Mod-Enter (run) and Tab (2-space indent)
    //    g. EditorView.theme — layout overrides (fill container, mono font)
    // 3. Create the EditorView, attached to containerRef.current.
    // 4. Return a cleanup function that destroys the view when the component
    //    unmounts (tab switch triggers remount via key change).

    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: initialValue,
        extensions: [
          // Undo/redo history. Exposed via Cmd/Ctrl+Z through historyKeymap.
          history(),

          // Gutter showing 1-based line numbers on the left.
          lineNumbers(),

          // SQL language support. PostgreSQL dialect adds PG-specific keywords
          // (e.g. RETURNING, ON CONFLICT) to the highlighting and autocomplete.
          // NOTE: We hard-code PostgreSQL here for Phase 1. In a later phase,
          // the dialect will be read from the Zustand connectionInfo so MySQL
          // and SQLite users get appropriate keyword suggestions.
          sql({ dialect: PostgreSQL }),

          // One-dark colour theme: matches the app's dark palette closely enough
          // that the editor blends in without requiring custom token overrides.
          oneDark,

          // Autocompletion popup. sql() registers its keyword completions
          // automatically; this extension provides the UI popup infrastructure.
          autocompletion(),

          // Custom keymap — defined before defaultKeymap so our bindings take
          // priority over any conflicting defaults.
          keymap.of([
            {
              // Mod-Enter is CodeMirror's cross-platform notation for
              // Cmd+Enter on macOS and Ctrl+Enter on Windows/Linux.
              key: 'Mod-Enter',
              run: (v) => {
                // We read from the view's current state, not from a React prop,
                // because the content lives in CodeMirror — not in React state.
                onRunRef.current(v.state.doc.toString());
                return true; // returning true tells CodeMirror this key was handled
              },
            },
            {
              // Tab inserts two spaces instead of a hard tab character.
              // This keeps the SQL copyable into tools that don't handle tabs.
              key: 'Tab',
              run: (v) => {
                v.dispatch(v.state.replaceSelection('  '));
                return true;
              },
            },
            // Standard undo/redo — Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z.
            ...historyKeymap,
            // All other platform-standard keybindings (cursor, selection,
            // clipboard, etc.) from the CodeMirror default set.
            ...defaultKeymap,
          ]),

          // Layout overrides applied on top of the one-dark theme.
          EditorView.theme({
            // Make the root .cm-editor div fill its flex parent (the container div).
            // Without this, CodeMirror defaults to a content-sized height and the
            // flex layout collapses the editor to zero height.
            '&': { height: '100%' },

            // Allow the scroller to grow and scroll independently of the editor root.
            '.cm-scroller': {
              overflow: 'auto',
              // Fall back through the app's mono stack if JetBrains Mono hasn't
              // loaded yet (e.g. during first paint).
              fontFamily: 'var(--font-mono, "JetBrains Mono", monospace)',
              fontSize: '13px',
              lineHeight: '1.6',
            },

            // Give the content area the same padding as the old textarea had so
            // the text doesn't hug the very edge of the editor.
            '.cm-content': { padding: '12px 16px' },

            // Remove the browser's default blue focus ring. CodeMirror's blinking
            // cursor already provides a clear focus indicator.
            '&.cm-focused': { outline: 'none' },

            // Match the gutter border to the app's border colour token so it
            // doesn't stand out as a foreign colour in the dark palette.
            '.cm-gutters': { borderRight: '1px solid #1f2033' },
          }),
        ],
      }),
      parent: containerRef.current,
    });

    // Cleanup: destroy the EditorView when the component unmounts. This releases
    // the DOM nodes CodeMirror created and prevents memory leaks when the user
    // closes a tab (which triggers a remount of SqlEditor with a new key).
    return () => {
      view.destroy();
    };

    // NOTE: Empty dependency array is intentional. The editor mounts once per
    // component lifetime. Tab switching is handled by the parent supplying a
    // new `key` prop, which causes React to unmount the old SqlEditor and mount
    // a fresh one with the new tab's initialValue — not by re-running this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The container div that CodeMirror attaches its DOM tree to. flex-1 makes it
  // grow to fill the available vertical space inside EditorPane's flex column.
  // overflow-hidden clips any CodeMirror chrome that overflows (shouldn't happen,
  // but prevents a double scrollbar if CodeMirror and the container both scroll).
  return <div ref={containerRef} className="flex-1 overflow-hidden" />;
}
