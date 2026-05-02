/**
 * src/client/components/Editor/SqlEditor.tsx
 *
 * WHAT:
 *   A React component that mounts a CodeMirror 6 SQL editor into the DOM,
 *   with live schema-aware autocomplete powered by the connected database.
 *   Also detects $N (Postgres positional) and :name (named) parameter
 *   placeholders in the SQL and renders a compact input strip below the
 *   editor for each distinct parameter — letting the user fill values once
 *   and re-run without editing the SQL itself.
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
 *
 * PARAMETER BINDING:
 *   parseSqlParams() scans the SQL document for $N and :name placeholders using
 *   two regex passes. The results are merged into a stable ordered list and stored
 *   in React state (params). Below the CodeMirror mount, a row of labelled <input>
 *   fields renders one input per distinct parameter. Values are collected in
 *   paramValues state and forwarded via onRun(sql, values) when Cmd+Enter fires.
 *
 *   WHY parse in SqlEditor instead of in a hook:
 *     The parser needs to run on every doc change (onChange) so the input strip
 *     stays in sync as the user types. SqlEditor already subscribes to every doc
 *     change via CodeMirror's updateListener — tying the parse there avoids a
 *     separate observer. No other component needs this parsed state.
 *
 *   WHY keep paramValues as local state (not in Zustand):
 *     Parameter values are ephemeral input state tied to the current editing
 *     session. They have the same lifespan as a form's controlled inputs. Putting
 *     them in the global store would require per-tab param value maps and
 *     cleanup on tab removal — complexity that buys nothing given that the
 *     values reset naturally when the param list changes.
 */

import { useEffect, useRef, useMemo, useState, useCallback } from "react";
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
import { useThemeStore } from "../../stores/theme";

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

// ===== PARAMETER PARSING =====

/**
 * SqlParam — one detected placeholder in the SQL string.
 *
 * WHY discriminated union instead of a single interface with optional fields:
 *   "positional" ($1) and "named" (:country) have different display labels and
 *   different serialization rules. A discriminated union makes the distinction
 *   explicit at the type level; callers that need the key use a type guard
 *   without an `as` cast.
 *
 * WHY `order` on positional params:
 *   $1, $2, $3 must be passed to knex.raw() as a positional array in numeric
 *   order, not in the order they happen to appear in the SQL. Storing the
 *   numeric index (parsed from the $N literal) allows the caller to sort them
 *   correctly even if the user writes "WHERE id=$2 AND x=$1".
 */
export type SqlParam =
  | { kind: "positional"; label: string; order: number }   // $1, $2, …
  | { kind: "named";      label: string; key: string };    // :country, :user_id

/**
 * parseSqlParams — extracts all unique $N and :name placeholders from `sql`.
 *
 * WHAT it does:
 *   1. Scans for /\$(\d+)/g (Postgres positional style): collects unique indexes
 *      sorted numerically, e.g. ["$1", "$2", "$3"].
 *   2. Scans for /:([a-zA-Z_][a-zA-Z0-9_]*)/g (named style) but skips matches
 *      that look like URL patterns (e.g. "://") or Postgres casts ("::int").
 *   3. Returns a stable array: positional params first (sorted by $N number),
 *      then named params (in appearance order, deduplicated).
 *
 * WHY we skip strings/comments in the SQL when scanning:
 *   A naive regex would match "$1" inside a string literal like '$1 store' and
 *   produce a spurious input field. We strip single-quoted literals and -- line
 *   comments before scanning. Block comments (/* ... *\/) are also stripped.
 *   This is not a full parser — it handles the 99% case. Exotic quoting (e.g.
 *   dollar-quoted strings in Postgres: $$...$$) is left as-is; a match inside
 *   one would produce an extra input field that the user can simply leave blank.
 *
 * @param sqlText  The raw SQL string from the CodeMirror document.
 * @returns        Ordered array of unique SqlParam descriptors.
 */
export function parseSqlParams(sqlText: string): SqlParam[] {
  // Strip content that should not be scanned for placeholders.
  // Order matters: block comments first, then line comments, then string literals.
  const stripped = sqlText
    // Block comments: /* ... */ (non-greedy, dot-all via [\s\S])
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Line comments: -- to end of line
    .replace(/--[^\n]*/g, "")
    // Single-quoted string literals: '...' (handles escaped quotes '' inside)
    .replace(/'(?:[^']|'')*'/g, "''");

  // ── Positional: $1, $2, … ────────────────────────────────────────────────
  const positionalSeen = new Set<number>();
  const positional: SqlParam[] = [];
  for (const match of stripped.matchAll(/\$(\d+)/g)) {
    const n = parseInt(match[1]!, 10);
    if (!positionalSeen.has(n)) {
      positionalSeen.add(n);
      positional.push({ kind: "positional", label: `$${n}`, order: n });
    }
  }
  // Sort by numeric index so $1 always appears before $2 in the input strip,
  // even if the user wrote them in a different order in the SQL.
  positional.sort((a, b) =>
    (a as { order: number }).order - (b as { order: number }).order
  );

  // ── Named: :country, :user_id, … ─────────────────────────────────────────
  // Exclude "://" (URL scheme) and "::" (Postgres cast operator) by requiring
  // that the character immediately before ":" is NOT another ":" or "/".
  const namedSeen = new Set<string>();
  const named: SqlParam[] = [];
  for (const match of stripped.matchAll(/(?<![:/]):([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    const key = match[1]!;
    if (!namedSeen.has(key)) {
      namedSeen.add(key);
      named.push({ kind: "named", label: `:${key}`, key });
    }
  }

  return [...positional, ...named];
}

/**
 * buildParamValues — assembles the values array/object to pass to the server.
 *
 * WHAT it does:
 *   For positional params ($N), returns a plain array ordered by $N index,
 *   e.g. [$1 value, $2 value, …].  The server passes this directly to
 *   knex.raw(sql, values[]).
 *
 *   For named params (:name), returns a plain object { name: value }.
 *   The server passes this to knex.raw(sql, bindings).
 *
 *   When the set is mixed (positional AND named together), positional wins —
 *   the named params are ignored and the array form is used. Mixed use of $N
 *   and :name in the same SQL is non-standard and both drivers would reject it.
 *
 * WHY exported:
 *   useQuery.ts calls this to produce the `params` field in the POST body.
 *
 * @param params      The parsed SqlParam descriptors.
 * @param paramValues Map of label → user-entered string value.
 * @returns           Array for positional, Record for named, or undefined if no params.
 */
export function buildParamValues(
  params: SqlParam[],
  paramValues: Record<string, string>
): unknown[] | Record<string, string> | undefined {
  if (params.length === 0) return undefined;

  const hasPositional = params.some((p) => p.kind === "positional");

  if (hasPositional) {
    // Build a sparse-safe array indexed by $N order (1-based → 0-based).
    const positional = params.filter(
      (p): p is Extract<SqlParam, { kind: "positional" }> =>
        p.kind === "positional"
    );
    const maxOrder = Math.max(...positional.map((p) => p.order));
    const arr: (string | undefined)[] = new Array(maxOrder).fill(undefined);
    for (const p of positional) {
      arr[p.order - 1] = paramValues[p.label] ?? "";
    }
    return arr as unknown[];
  }

  // Named params: return { key: value } pairs.
  const result: Record<string, string> = {};
  for (const p of params) {
    if (p.kind === "named") {
      result[p.key] = paramValues[p.label] ?? "";
    }
  }
  return result;
}

// ===== THEME =====

/**
 * Create the dbpeekTheme override based on the current theme.
 * This overrides the oneDark theme's background and gutter colors to
 * match the app-wide palette.
 *
 * WHY placed AFTER oneDark in the extensions array:
 *   CodeMirror 6 themes are applied in extension order. A later theme wins on
 *   conflicting selectors. Placing dbpeekTheme after oneDark ensures our
 *   background overrides land without needing `!important` everywhere.
 */
function createDbpeekTheme(isDark: boolean) {
  const darkColors = {
    bg: "#0a0a0f",
    bgSecondary: "#0c0c14",
    bgTertiary: "#0f0f1a",
    text: "#ededf0",
    textMuted: "#6b7280",
    textSecondary: "#9ca3af",
    textLight: "#374151",
    border: "#1f2033",
    selection: "#2a2a4a",
    placeholder: "#2d3047",
  };

  const lightColors = {
    bg: "#ffffff",
    bgSecondary: "#f9f9fb",
    bgTertiary: "#f3f3f6",
    text: "#1f2937",
    textMuted: "#9ca3af",
    textSecondary: "#6b7280",
    textLight: "#e5e7eb",
    border: "#e5e7eb",
    selection: "#dbeafe",
    placeholder: "#d1d5db",
  };

  const colors = isDark ? darkColors : lightColors;

  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: colors.bg,
      color: colors.text,
    },
    "&.cm-focused": {
      outline: "none",
    },
    ".cm-scroller": {
      overflow: "auto",
      fontFamily:
        "'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, monospace",
      fontSize: "13px",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: colors.bgSecondary,
      borderRight: `1px solid ${colors.border}`,
      color: colors.textLight,
    },
    ".cm-activeLineGutter": {
      backgroundColor: colors.bgTertiary,
      color: colors.textMuted,
    },
    ".cm-activeLine": {
      backgroundColor: colors.bgTertiary,
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: colors.text,
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: `${colors.selection} !important`,
    },
    ".cm-placeholder": {
      color: colors.placeholder,
      fontStyle: "italic",
    },
  });
}

// ===== TYPES =====

/**
 * Props for the SqlEditor component.
 *
 * WHY onRun receives params separately instead of embedding them in the SQL:
 *   The SQL string is what the user typed — it must stay unchanged so the
 *   editor doesn't clobber the user's $1/$2 placeholders. The param values
 *   are passed alongside so the caller (App.tsx → useQueryExecution) can
 *   forward both to the server as { sql, params }.
 */
interface SqlEditorProps {
  /**
   * Called with the raw SQL and resolved param values when Cmd/Ctrl+Enter fires.
   * params is undefined when the SQL contains no placeholders.
   */
  onRun: (sql: string, params?: unknown[] | Record<string, string>) => void;
  /**
   * Called on every keystroke with the current editor content.
   * Wires into the Zustand updateTab action so tab.sql stays in sync.
   */
  onChange?: (sql: string) => void;
  /**
   * Called with the selected text (or full doc) when Cmd+Shift+Enter fires.
   * params are forwarded so a selection-only run also gets bound values.
   */
  onRunSelection?: (sql: string, params?: unknown[] | Record<string, string>) => void;
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
 * SqlEditor — mounts a CodeMirror 6 editor into a ref-attached div, and
 * renders a parameter binding strip below it when the SQL contains $N or
 * :name placeholders.
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

  // ── Theme state ────────────────────────────────────────────────────────────
  const theme = useThemeStore((s) => s.theme);

  // ── Parameter binding state ───────────────────────────────────────────────
  // params: ordered list of detected $N / :name placeholders, re-derived on
  //   every doc change so the input strip stays in sync as the user types.
  // paramValues: map of param.label → user-entered string. Keyed by label
  //   (e.g. "$1", ":country") so it survives re-ordering (positional) and is
  //   human-readable in React DevTools.
  const [params, setParams] = useState<SqlParam[]>(() =>
    parseSqlParams(initialDoc)
  );
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  // Stable ref so the CM change listener (inside the mount effect) can always
  // reach the latest setter without capturing a stale closure.
  const setParamsRef = useRef(setParams);
  setParamsRef.current = setParams;

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
  const themeCompartment = useMemo(() => new Compartment(), []);

  // ── Callback refs (the "always-current" pattern) ─────────────────────────
  // These are assigned synchronously on every render, before any effects fire.
  // The closures inside useEffect always call .current, so they always get the
  // latest version of the callback without needing to close over it directly.
  const onRunRef = useRef<(sql: string, params?: unknown[] | Record<string, string>) => void>(onRun);
  const onChangeRef = useRef<((sql: string) => void) | undefined>(onChange);
  const onRunSelectionRef = useRef<
    ((sql: string, params?: unknown[] | Record<string, string>) => void) | undefined
  >(onRunSelection);
  const onToggleLineCommentRef = useRef<((sql: string) => void) | undefined>(
    onToggleLineComment
  );
  onRunRef.current = onRun;
  onChangeRef.current = onChange;
  onRunSelectionRef.current = onRunSelection;
  onToggleLineCommentRef.current = onToggleLineComment;

  // Stable ref so keymaps can always read the latest paramValues without being
  // rebuilt every time paramValues state changes (which would require tearing
  // down the whole EditorView — the same problem onRunRef solves for callbacks).
  const paramValuesRef = useRef<Record<string, string>>(paramValues);
  paramValuesRef.current = paramValues;

  // Stable ref so keymaps can always read the latest params list.
  const paramsRef = useRef<SqlParam[]>(params);
  paramsRef.current = params;

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
          // Wrapped in themeCompartment for hot-swapping when theme changes.
          themeCompartment.of(createDbpeekTheme(theme === "dark")),

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
                // Build resolved param values from the ref so we always have
                // the latest user input without restarting the editor.
                const resolved = buildParamValues(
                  paramsRef.current,
                  paramValuesRef.current
                );
                onRunRef.current(v.state.doc.toString(), resolved);
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
                const resolved = buildParamValues(
                  paramsRef.current,
                  paramValuesRef.current
                );
                onRunSelectionRef.current?.(textToRun, resolved);
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
          // Fires on every transaction that modifies the document. We use it to:
          //   1. Keep the Zustand tab store (tab.sql) in sync via onChangeRef.
          //   2. Re-parse placeholders so the param input strip stays accurate.
          // Using ref.current means we never need to recreate the editor when
          // the onChange prop identity changes.
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged) {
              const newSql = update.state.doc.toString();
              onChangeRef.current?.(newSql);
              // Re-parse every doc change. parseSqlParams is cheap (two regex
              // scans over a few hundred bytes at most) so no debounce is needed.
              setParamsRef.current(parseSqlParams(newSql));
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

  // ── Theme change effect ────────────────────────────────────────────────────
  // Runs when the theme changes. Reconfigures the theme compartment with the
  // new colors without disrupting the editor state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;

    view.dispatch({
      effects: themeCompartment.reconfigure(createDbpeekTheme(theme === "dark")),
    });
  }, [theme, themeCompartment]);

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

    // Re-parse the new tab's SQL and reset param values so the input strip
    // reflects the new tab's placeholders from scratch.
    setParams(parseSqlParams(newSql));
    setParamValues({});
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

    // Re-parse the injected SQL and reset param values so the input strip
    // shows the correct placeholders for the newly loaded query.
    setParams(parseSqlParams(newSql));
    setParamValues({});
  // loadNonce is the trigger; tabs + activeTabIndex supply the content.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadNonce]);

  // ── Param value change handler ────────────────────────────────────────────
  /**
   * handleParamChange — updates a single param's value in state.
   *
   * WHY useCallback:
   *   The param input strip maps over `params` and renders one <input> per
   *   entry. If handleParamChange changed reference on every render, each
   *   <input>'s onChange prop would change reference too, which would be
   *   fine for correctness but wastes a reconciliation pass. useCallback
   *   with stable deps keeps the reference stable.
   */
  const handleParamChange = useCallback(
    (label: string, value: string) => {
      setParamValues((prev) => ({ ...prev, [label]: value }));
    },
    []
  );

  return (
    // Outer wrapper: column flex so the CM editor is on top and the param
    // strip sits flush below it. h-full fills the flex-1 panel from App.tsx.
    <div className="flex flex-col w-full h-full">

      {/* ── CodeMirror mount point ── */}
      {/*
        flex-1 min-h-0: grows to fill remaining space above the param strip.
        overflow-hidden: prevents CM's internal scrollbar from overflowing the
        flex container while still allowing CM's own .cm-scroller to scroll.
      */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-hidden"
        role="textbox"
        aria-multiline="true"
        aria-label="SQL editor"
      />

      {/* ── Parameter binding strip ── */}
      {/*
        Rendered only when the SQL contains at least one $N or :name placeholder.
        Uses a single scrollable row so it doesn't push the editor up when there
        are many params (rare, but possible for an N-way join filter).
        shrink-0 prevents the flex parent from collapsing this strip.
      */}
      {params.length > 0 && (
        <div
          className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-[#1f2033] bg-[#0c0c14] overflow-x-auto"
          aria-label="Query parameters"
        >
          {/* Label on the far left so the user knows what this strip is */}
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-widest text-[#4b5563] select-none">
            Params
          </span>

          {/* One labelled input per detected placeholder */}
          {params.map((param) => (
            <label
              key={param.label}
              className="shrink-0 flex items-center gap-1.5"
            >
              {/*
                Param label: styled to echo the SQL token ($1 in blue-ish,
                :name in the same hue). Monospace so it aligns with the editor.
              */}
              <span className="text-[11px] font-mono text-[#7c85d6] select-none">
                {param.label}
              </span>

              {/*
                Value input: minimal styling matches the dark palette.
                w-28 gives enough room for typical values (UUIDs get cut off
                but the user can still type them — the input scrolls horizontally).
                focus:ring-1 gives a subtle focus indicator without a jarring border.
              */}
              <input
                type="text"
                value={paramValues[param.label] ?? ""}
                onChange={(e) => handleParamChange(param.label, e.target.value)}
                placeholder="value"
                className="w-28 h-6 px-2 text-[11px] font-mono bg-[#0a0a0f] border border-[#1f2033] rounded text-[#ededf0] placeholder-[#374151] focus:outline-none focus:ring-1 focus:ring-[#2a2a4a] transition-colors duration-100"
                aria-label={`Value for ${param.label}`}
              />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
