/**
 * TerminalBlock — Renders terminal output with $ prompt styling.
 *
 * WHY: Installation guides and CLI usage docs frequently show terminal
 * sessions. Distinguishing the typed command from its output helps readers
 * understand what they should type vs. what they should expect to see.
 *
 * HOW: The command line prefixes with a colored "$" prompt (accent blue).
 * The command text itself is primary (white) for readability. Output lines
 * are rendered in secondary text color (muted). A CopyButton in the
 * top-right copies only the command (not the output), which is what the
 * reader actually wants to run.
 *
 * Props:
 *   command — the shell command the user types
 *   output  — optional multiline output text shown below the command
 *
 * Usage in MDX:
 *   <TerminalBlock command="npx dbpeek postgres://localhost/mydb" />
 *   <TerminalBlock
 *     command="npx dbpeek --version"
 *     output="dbpeek v0.4.2"
 *   />
 */

import React from 'react';
import { CopyButton } from '../ui/CopyButton';

interface TerminalBlockProps {
  /** The shell command to display (without the "$" prefix). */
  command: string;
  /** Optional output text shown below the command line. */
  output?: string;
}

/**
 * A styled terminal block showing a command and optional output.
 * The copy button copies only the command string.
 */
export const TerminalBlock: React.FC<TerminalBlockProps> = ({
  command,
  output,
}) => (
  <div className="relative bg-[#fafafa] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg p-4 my-4 font-mono text-sm overflow-x-auto">
    {/* Copy button — copies the command text */}
    <div className="absolute top-2 right-2">
      <CopyButton text={command} />
    </div>

    {/* Command line with colored "$" prompt */}
    <div className="flex items-start gap-2 pr-8">
      <span className="text-[#4a8af4] select-none shrink-0" aria-hidden="true">
        $
      </span>
      <span className="text-[#0a0a0f] dark:text-[#ededf0] break-all">{command}</span>
    </div>

    {/* Optional output lines */}
    {output && (
      <div className="mt-2 text-[#525252] dark:text-[#8a8a9a] whitespace-pre-wrap leading-relaxed">
        {output}
      </div>
    )}
  </div>
);

export default TerminalBlock;
