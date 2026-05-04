/**
 * Kbd — Single keyboard key styled element.
 *
 * WHY: The HTML <kbd> element is semantically correct for keyboard input,
 * but browsers give it no useful default styling. This component applies
 * the design system's key-cap appearance (raised border, monospace font)
 * consistently across all usage sites.
 *
 * HOW: Renders a native <kbd> element with Tailwind classes. The border-b-2
 * trick creates a subtle 3D "key cap" effect by making the bottom border
 * slightly thicker than the others.
 */

import React from 'react';

interface KbdProps {
  /** The key label to display (e.g. "⌘", "K", "Enter", "Escape"). */
  children: React.ReactNode;
  /** Optional additional Tailwind classes. */
  className?: string;
}

/**
 * A single styled keyboard key.
 * Compose multiple <Kbd> elements with "+" separators for shortcuts,
 * or use <KeyboardShortcut keys={[...]} /> for a full sequence.
 */
export const Kbd: React.FC<KbdProps> = ({ children, className = '' }) => (
  <kbd
    className={[
      'bg-[#f4f4f5] dark:bg-[#111118] border border-b-2 border-[#e4e4e7] dark:border-[#1e1e2e]',
      'rounded px-1.5 py-0.5 text-xs font-mono text-[#0a0a0f] dark:text-[#ededf0]',
      'inline-block',
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </kbd>
);

export default Kbd;
