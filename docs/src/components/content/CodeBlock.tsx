/**
 * CodeBlock — Syntax-highlighted code block with copy button.
 *
 * WHY: MDX files run through @shikijs/rehype at build time, which injects
 * syntax-highlighted HTML directly into <pre><code> elements. This component
 * wraps that output with:
 *   1. A dark surface container matching the design system
 *   2. An optional filename label (e.g. "src/index.ts")
 *   3. A CopyButton that extracts the raw text from the code node
 *
 * HOW: For MDXProvider's <pre> override, the children prop is the shiki-
 * processed <code> element with class="shiki …" and data attributes.
 * We render children as-is (preserving shiki's colored spans), then
 * layer the CopyButton on top with absolute positioning.
 *
 * For manually-placed CodeBlock instances in component code, the `code`
 * prop is rendered inside a plain <code> element.
 *
 * Usage — manually placed:
 *   <CodeBlock code="SELECT 1;" language="sql" filename="example.sql" />
 *
 * Usage — MDXProvider wraps shiki output automatically (see MDXProvider.tsx).
 */

import React, { useRef } from 'react';
import { CopyButton } from '../ui/CopyButton';

interface CodeBlockProps {
  /** Raw code string to display (used when NOT going through MDX/shiki). */
  code?: string;
  /** Language identifier shown in the filename bar if no filename is given. */
  language?: string;
  /** Optional filename label shown above the code (e.g. "tsconfig.json"). */
  filename?: string;
  /**
   * Children are passed by MDXProvider when wrapping shiki <pre> output.
   * Mutually exclusive with the `code` prop.
   */
  children?: React.ReactNode;
  /** Optional additional Tailwind classes for the outer wrapper. */
  className?: string;
}

/**
 * A styled code block container with optional filename bar and copy button.
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language,
  filename,
  children,
  className = '',
}) => {
  // Reference to the code container so we can extract text for copying
  // when children are used (MDX/shiki path).
  const codeRef = useRef<HTMLDivElement>(null);

  /**
   * Derive the text to copy:
   * - If `code` prop is given, copy it directly.
   * - If children are given (shiki path), extract textContent from the DOM.
   */
  const getCopyText = (): string => {
    if (code) return code;
    return codeRef.current?.textContent ?? '';
  };

  const labelText = filename ?? (language ? `.${language}` : undefined);

  return (
    <div
      className={[
        'bg-[#fafafa] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg overflow-hidden my-4',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* Filename / language label bar */}
      {labelText && (
        <div className="flex items-center justify-between bg-[#f4f4f5] dark:bg-[#111118] border-b border-[#e4e4e7] dark:border-[#1e1e2e] px-4 py-2">
          <span className="text-xs text-[#525252] dark:text-[#8a8a9a] font-mono">{labelText}</span>
        </div>
      )}

      {/* Code area — relative so the CopyButton can be absolutely positioned */}
      <div className="relative" ref={codeRef}>
        {/* Copy button — always top-right of the code area */}
        <div className="absolute top-2 right-2 z-10">
          <CopyButton text={getCopyText()} />
        </div>

        {/* Plain code path (no shiki) */}
        {code && !children && (
          <pre className="overflow-x-auto p-4 pr-10">
            <code className="text-sm font-mono text-[#0a0a0f] dark:text-[#ededf0] leading-relaxed">
              {code}
            </code>
          </pre>
        )}

        {/* MDX/shiki path — children are already highlighted HTML */}
        {children && (
          <div className="overflow-x-auto p-4 pr-10 [&>pre]:m-0 [&>pre]:p-0 [&>pre]:bg-transparent [&>pre]:border-0 [&_code]:text-sm">
            {children}
          </div>
        )}
      </div>
    </div>
  );
};

export default CodeBlock;
