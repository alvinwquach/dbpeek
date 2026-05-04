/**
 * CopyButton — Copies text to clipboard with visual feedback.
 *
 * WHY: Every code block and terminal block needs a copy action. Centralizing
 * the state machine (idle → copied → idle) here avoids duplicating the
 * two-second reset timer in every consumer.
 *
 * HOW: navigator.clipboard.writeText() writes to the system clipboard.
 * On success, we swap the icon from Copy to Check for 2 seconds via
 * a setTimeout, then restore. The parent passes className for positioning
 * (usually absolute top-2 right-2 on a relative container).
 */

import React, { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';

interface CopyButtonProps {
  /** The text to write to the clipboard when clicked. */
  text: string;
  /** Optional Tailwind classes for positioning/layout overrides. */
  className?: string;
}

/**
 * A small icon button that copies `text` to the clipboard.
 * Shows a checkmark for 2 seconds after a successful copy.
 */
export const CopyButton: React.FC<CopyButtonProps> = ({ text, className = '' }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      // Revert the icon back to Copy after 2 seconds.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in some browser contexts; fail silently.
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      className={[
        'p-1.5 rounded transition-colors',
        copied
          ? 'text-[#2dd4a0]'
          : 'text-[#525252] dark:text-[#555566] hover:text-[#0a0a0f] dark:hover:text-[#8a8a9a] hover:bg-[#e4e4e7] dark:hover:bg-[#1e1e2e]',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
    </button>
  );
};

export default CopyButton;
