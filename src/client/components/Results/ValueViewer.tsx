/**
 * src/client/components/Results/ValueViewer.tsx
 *
 * WHAT:
 *   A fixed-height panel rendered below the data grid that shows the complete,
 *   untruncated value of the most recently clicked cell. Inspired by DBeaver's
 *   "Value" panel.
 *
 * WHY this exists:
 *   Grid cells use whitespace-nowrap + text-ellipsis to keep rows scannable.
 *   That means long strings, multi-line text, and JSON objects are all cut off.
 *   This panel provides a dedicated scrollable viewport for the full value so
 *   users can inspect JSON columns, UUIDs, long descriptions, etc. without
 *   copying or running a separate query.
 *
 * ARCHITECTURE:
 *   Pure presentational component — state (which cell is selected) lives in
 *   ResultsTable and is passed down as props. ValueViewer only knows the raw
 *   value and the column name.
 *
 *   Rendering pipeline:
 *     analyzeValue()   — classify value type, format for display
 *     tokenizeJson()   — convert JSON.stringify output to highlighted React nodes
 *     <ValueViewer />  — render header + content area
 *
 * INTEGRATION:
 *   Rendered inside ResultsTable's flex column container, below the scroll
 *   container. The scroll container shrinks (min-h-0 + flex-1) to give this
 *   panel its fixed 200px height.
 */

import {
  useState,
  useMemo,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

// ===== TYPES =====

/** Props for the ValueViewer panel. */
interface ValueViewerProps {
  /** The raw DB cell value to display — whatever the driver returned. */
  value: unknown;
  /** Column name shown in the panel header. */
  columnName: string;
  /** Called when the user clicks ✕ or presses Escape. */
  onClose: () => void;
}

/**
 * ValueKind — the semantic category of the cell value, used to choose the
 * rendering path and header type badge.
 *
 *   null    → "NULL" italic muted label
 *   json    → pretty-printed JSON with syntax highlighting
 *   boolean → "true" (green) or "false" (red)
 *   number  → amber monospace
 *   text    → plain monospace with word-wrap toggle
 */
type ValueKind = "null" | "json" | "boolean" | "number" | "text";

/** Output of analyzeValue — the classified value ready for rendering. */
interface AnalyzedValue {
  kind: ValueKind;
  /**
   * The formatted text for the content area.
   * Empty string when kind === 'null' (nothing to render).
   * JSON values are already JSON.stringify'd with 2-space indent.
   */
  displayText: string;
}

// ===== VALUE ANALYSIS =====

/**
 * analyzeValue — classifies a raw DB cell value and prepares it for rendering.
 *
 * WHY a dedicated function (not inline in the component):
 *   The result is memoized with useMemo. Having the logic here keeps the
 *   component body readable and the memoization dependency explicit ([value]).
 *
 * Classification order matters:
 *   1. null/undefined must be checked before typeof === 'object' because
 *      typeof null === 'object' in JavaScript.
 *   2. boolean before number — both are primitives but have different display.
 *   3. object/array next — these come from DB drivers that parse JSON columns
 *      natively (e.g. pg returns JSONB as a JS object).
 *   4. string last — check if it looks like JSON before treating as plain text.
 *      We only parse strings that start with { or [ to avoid false positives
 *      on ISO date strings, numeric strings, etc.
 */
function analyzeValue(value: unknown): AnalyzedValue {
  // ── Null ──────────────────────────────────────────────────────────────────
  if (value === null || value === undefined) {
    return { kind: "null", displayText: "" };
  }

  // ── Boolean ───────────────────────────────────────────────────────────────
  if (typeof value === "boolean") {
    return { kind: "boolean", displayText: String(value) };
  }

  // ── Numeric (number or BigInt — some drivers return BigInt for BIGINT cols) ─
  if (typeof value === "number" || typeof value === "bigint") {
    return { kind: "number", displayText: String(value) };
  }

  // ── Object / Array (already parsed JSON from DB driver) ───────────────────
  // pg returns JSONB as a JS object; MySQL2 can do the same.
  if (typeof value === "object") {
    return {
      kind: "json",
      displayText: JSON.stringify(value, null, 2),
    };
  }

  // ── String ────────────────────────────────────────────────────────────────
  if (typeof value === "string") {
    const trimmed = value.trim();

    // Only attempt JSON.parse for strings that look like objects or arrays.
    // This skips ISO dates, plain numbers stored as text, etc.
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed: unknown = JSON.parse(value);
        // Confirm the result is actually an object/array (JSON.parse("123") returns
        // a number — we don't want to pretty-print those as JSON).
        if (typeof parsed === "object" && parsed !== null) {
          return {
            kind: "json",
            displayText: JSON.stringify(parsed, null, 2),
          };
        }
      } catch {
        // Invalid JSON — fall through to plain text.
      }
    }

    return { kind: "text", displayText: value };
  }

  // ── Fallback (Symbol, etc.) ───────────────────────────────────────────────
  return { kind: "text", displayText: String(value) };
}

// ===== JSON SYNTAX HIGHLIGHTING =====

/**
 * tokenizeJson — converts a formatted JSON string (JSON.stringify with 2-space
 * indent) into an array of React nodes, each span-wrapped with a Tailwind color
 * class for syntax highlighting.
 *
 * WHY build React nodes instead of using dangerouslySetInnerHTML:
 *   Cell values come from user data in a database. Using innerHTML would require
 *   HTML-escaping every token before injection, which is easy to get wrong and
 *   silently unsafe. Building React elements keeps everything in the React tree
 *   where React handles escaping automatically.
 *
 * WHY a regex tokenizer rather than a library:
 *   The input is always JSON.stringify output — well-formed, 2-space indented,
 *   no trailing commas. A targeted regex covers every token without pulling in
 *   a syntax-highlight dependency (Prism, highlight.js, etc. are heavy).
 *
 * Regex alternation groups (tried left-to-right at each position):
 *   1. Object key:    "string"\s*:  — a quoted string followed by a colon
 *   2. String value:  "string"      — a quoted string not followed by a colon
 *   3. Number:        -123.45e+6
 *   4. Keyword:       true | false | null
 *   5. Structural:    { } [ ] , :
 *   (Whitespace and newlines between tokens are emitted as plain text nodes.)
 *
 * Token colors (matching the project dark palette):
 *   Object key     — text-[#7c85d6]   blue-purple
 *   String value   — text-[#34d399]   green
 *   Number         — text-[#f59e0b]   amber
 *   Boolean true   — text-[#34d399]   green
 *   Boolean false  — text-[#f87171]   red
 *   null keyword   — text-[#4b5563]   muted + italic
 *   Structural     — text-[#4b5563]   muted
 */
function tokenizeJson(jsonStr: string): ReactNode[] {
  const TOKEN_RE =
    /("(?:[^"\\]|\\.)*")\s*:|("(?:[^"\\]|\\.)*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b|\bnull\b)|([{}[\],:])/g;

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let nodeKey = 0;
  let match: RegExpExecArray | null;

  while ((match = TOKEN_RE.exec(jsonStr)) !== null) {
    // Emit whitespace / indentation between matched tokens as a plain text node.
    // This preserves the 2-space indent and newlines that make the JSON readable.
    if (match.index > lastIndex) {
      nodes.push(jsonStr.slice(lastIndex, match.index));
    }

    const [full, keyStr, strVal, numVal, keyword, punct] = match;

    if (keyStr !== undefined) {
      // Object key — "name": — the full match is `"name":`.
      // Split into the quoted part (purple) and the trailing colon (muted).
      // lastIndexOf(':') is safe here because JSON.stringify never puts a colon
      // inside a key string in a formatted way — the colon is always at the end.
      const colonIdx = full.lastIndexOf(":");
      nodes.push(
        <span key={nodeKey++} className="text-[#7c85d6]">
          {full.slice(0, colonIdx)}
        </span>
      );
      nodes.push(
        <span key={nodeKey++} className="text-[#4b5563]">
          {full.slice(colonIdx)}
        </span>
      );
    } else if (strVal !== undefined) {
      // String value
      nodes.push(
        <span key={nodeKey++} className="text-[#34d399]">
          {strVal}
        </span>
      );
    } else if (numVal !== undefined) {
      // Numeric value
      nodes.push(
        <span key={nodeKey++} className="text-[#f59e0b]">
          {numVal}
        </span>
      );
    } else if (keyword !== undefined) {
      // true / false / null
      nodes.push(
        <span
          key={nodeKey++}
          className={
            keyword === "false"
              ? "text-[#f87171]"
              : keyword === "true"
              ? "text-[#34d399]"
              : "text-[#4b5563] italic" // null
          }
        >
          {keyword}
        </span>
      );
    } else if (punct !== undefined) {
      // Structural punctuation — braces, brackets, commas, colons
      nodes.push(
        <span key={nodeKey++} className="text-[#4b5563]">
          {punct}
        </span>
      );
    } else {
      // Unreachable with this regex, but emit as plain text for safety.
      nodes.push(full);
    }

    lastIndex = match.index + full.length;
  }

  // Emit any trailing text after the last match (typically a closing newline).
  if (lastIndex < jsonStr.length) {
    nodes.push(jsonStr.slice(lastIndex));
  }

  return nodes;
}

// ===== COMPONENT =====

/**
 * ValueViewer — fixed-height panel showing the full, untruncated value of the
 * selected grid cell, rendered directly below the results table scroll area.
 *
 * FEATURES:
 *   Plain text  — monospace, word-wrap toggle, full content visible
 *   JSON        — pretty-printed (2-space indent) with syntax highlighting;
 *                 JSON auto-detected from string columns containing JSON text
 *   NULL        — muted italic "NULL" label, no copy/wrap controls
 *   Boolean     — green (true) / red (false) to match grid rendering
 *   Number      — amber tabular-nums to match grid rendering
 *
 * HEADER CONTROLS:
 *   Column name  — identifies which column the value belongs to
 *   Type badge   — JSON / BOOL / NUM / NULL (absent for plain text)
 *   Wrap button  — toggles whitespace-pre-wrap ↔ whitespace-pre
 *   Copy button  — writes the full formatted value to the clipboard
 *   ✕ button    — closes the panel (also triggered by Escape key)
 *
 * KEYBOARD:
 *   Escape — closes the panel (window-level listener, removed on unmount).
 */
export function ValueViewer({ value, columnName, onClose }: ValueViewerProps) {
  // ── State ──────────────────────────────────────────────────────────────────

  /**
   * Word wrap mode.
   * true  → whitespace-pre-wrap break-words (default, most useful for inspection)
   * false → whitespace-pre overflow-x-auto (useful to see raw line structure)
   * Resets to true whenever a new cell is selected (value prop changes).
   */
  const [wordWrap, setWordWrap] = useState(true);

  /**
   * Clipboard feedback state. true → "Copied!" label visible on the Copy button.
   * Auto-resets to false after 1.5 s via useEffect below.
   */
  const [copied, setCopied] = useState(false);

  // ── Analyze value (memoized) ───────────────────────────────────────────────

  /**
   * analyzeValue is called once per new value. Memoized to avoid re-running
   * JSON.stringify + JSON.parse on every re-render (e.g. on wrap toggle).
   */
  const analyzed = useMemo(() => analyzeValue(value), [value]);

  // ── Side effects ───────────────────────────────────────────────────────────

  /**
   * Reset UI state whenever the user selects a new cell (new value arrives).
   * Avoids showing "Copied!" from a previous cell, and restores word wrap.
   */
  useEffect(() => {
    setWordWrap(true);
    setCopied(false);
  }, [value]);

  /**
   * Close the panel on Escape key — DBeaver-style dismiss.
   *
   * WHY window-level (not a focusable element with onKeyDown):
   *   The panel isn't an interactive container — the user may have focus
   *   elsewhere (e.g. on the grid or editor) while the panel is open. A
   *   window listener fires regardless of focus location.
   *
   * Cleanup removes the listener on unmount or when onClose changes so there
   * are never multiple stale listeners registered.
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  /**
   * handleCopy — writes the full formatted value to the clipboard.
   * For JSON this copies the pretty-printed string (2-space indent).
   * For plain text it copies the raw string as-is.
   * Stable via useCallback — passed as onClick prop to a button.
   */
  const handleCopy = useCallback(() => {
    if (analyzed.kind === "null") return;
    navigator.clipboard
      .writeText(analyzed.displayText)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard write failed (permissions, non-secure context, etc.).
        // Silently ignore — this is a non-critical convenience feature.
      });
  }, [analyzed]);

  // ── Derived display values ─────────────────────────────────────────────────

  /**
   * Type badge text shown next to the column name.
   * Null for plain text — no badge needed since text is the default assumption.
   */
  const typeBadge =
    analyzed.kind === "null"
      ? "NULL"
      : analyzed.kind === "json"
      ? "JSON"
      : analyzed.kind === "boolean"
      ? "BOOL"
      : analyzed.kind === "number"
      ? "NUM"
      : null;

  /** True when there is an actual value to display (as opposed to NULL). */
  const hasContent = analyzed.kind !== "null";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    /*
     * Root container — fixed 200px height, border-t separates it from the grid.
     * shrink-0 prevents the flex parent from ever squeezing this panel shorter.
     * The grid scroll container above this uses flex-1 min-h-0 to absorb the
     * space reduction when this panel appears.
     */
    <div className="border-t border-[#1f2033] flex flex-col h-[200px] shrink-0">

      {/* ── Panel header ────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-8 shrink-0 border-b border-[#1f2033] bg-[#0d0d17]">

        {/* "Value" section label — muted, acts as a DBeaver-style panel title */}
        <span className="text-[10px] uppercase tracking-wider text-[#2d3047] select-none">
          Value
        </span>

        {/* Column name — truncated at 200px to prevent overflow on long names */}
        <span
          className="text-xs font-mono text-[#7c85d6] font-medium truncate max-w-[200px]"
          title={columnName}
        >
          {columnName}
        </span>

        {/* Type badge — shown for JSON, BOOL, NUM, NULL; absent for plain text */}
        {typeBadge !== null && (
          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#0a0a0f] border border-[#1f2033] text-[#4b5563] select-none shrink-0 font-mono">
            {typeBadge}
          </span>
        )}

        {/* ── Right-side controls ─────────────────────────────────────────── */}
        <div className="ml-auto flex items-center gap-1 shrink-0">

          {/*
            Word wrap toggle — only shown when there is content to wrap.
            Active state uses a blue tint so users can see wrap is ON at a glance.
          */}
          {hasContent && (
            <button
              onClick={() => setWordWrap((w) => !w)}
              title={wordWrap ? "Disable word wrap" : "Enable word wrap"}
              className={[
                "px-2 py-0.5 rounded text-[10px] font-mono border transition-colors duration-100 select-none",
                wordWrap
                  ? "border-[#3b5fa0] text-[#7c85d6] bg-[#050a14]"
                  : "border-[#1f2033] text-[#4b5563] hover:border-[#2d3047] hover:text-[#6b7280]",
              ].join(" ")}
            >
              Wrap
            </button>
          )}

          {/*
            Copy button — writes the full displayText to clipboard.
            min-w-[50px] prevents the button from jumping when "Copied!" is wider
            than "Copy".
          */}
          {hasContent && (
            <button
              onClick={handleCopy}
              title="Copy full value to clipboard"
              className="px-2 py-0.5 rounded text-[10px] font-mono border border-[#1f2033] text-[#4b5563] hover:border-[#2d3047] hover:text-[#ededf0] transition-colors duration-100 select-none min-w-[50px] text-center"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          )}

          {/* Close button — red hover tint signals dismiss action */}
          <button
            onClick={onClose}
            title="Close value panel (Esc)"
            className="px-1.5 py-0.5 rounded text-[10px] font-mono border border-[#1f2033] text-[#4b5563] hover:border-[#3d1f1f] hover:text-[#f87171] transition-colors duration-100 select-none"
          >
            ✕
          </button>
        </div>
      </div>

      {/* ── Content area ────────────────────────────────────────────────────── */}
      {/*
        overflow-auto makes this area independently scrollable.
        min-h-0 ensures flex doesn't prevent shrinking below content size.
        p-3 gives a comfortable inset from the panel border.
      */}
      <div className="flex-1 min-h-0 overflow-auto px-3 py-2">

        {analyzed.kind === "null" && (
          /*
           * NULL — italic muted text, matches the grid cell rendering.
           * No wrap/copy controls since there is no value to act on.
           */
          <span className="italic text-[#4b5563] text-xs font-mono">NULL</span>
        )}

        {analyzed.kind === "boolean" && (
          /* Boolean — green for true, red for false, matching the grid. */
          <span
            className={[
              "text-xs font-mono",
              analyzed.displayText === "true"
                ? "text-[#34d399]"
                : "text-[#f87171]",
            ].join(" ")}
          >
            {analyzed.displayText}
          </span>
        )}

        {analyzed.kind === "number" && (
          /* Number — amber tabular-nums, matching the grid cell style. */
          <span className="text-xs font-mono text-[#f59e0b] tabular-nums">
            {analyzed.displayText}
          </span>
        )}

        {analyzed.kind === "json" && (
          /*
           * JSON — syntax-highlighted pre block.
           * whitespace-pre-wrap + break-words in wrap mode keeps indentation
           * while still wrapping long single-line values.
           * whitespace-pre in nowrap mode preserves the exact formatted layout.
           */
          <pre
            className={[
              "text-xs font-mono text-[#ededf0] m-0",
              wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            ].join(" ")}
          >
            {tokenizeJson(analyzed.displayText)}
          </pre>
        )}

        {analyzed.kind === "text" && (
          /*
           * Plain text — monospace pre block with wrap toggle.
           * Multi-line strings (e.g. addresses, code snippets) render their
           * newlines because we use <pre> not a regular div.
           */
          <pre
            className={[
              "text-xs font-mono text-[#ededf0] m-0",
              wordWrap ? "whitespace-pre-wrap break-words" : "whitespace-pre",
            ].join(" ")}
          >
            {analyzed.displayText}
          </pre>
        )}
      </div>
    </div>
  );
}
