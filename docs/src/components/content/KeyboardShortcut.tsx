/**
 * KeyboardShortcut — Renders a sequence of keyboard keys joined by "+".
 *
 * WHY: Keyboard shortcuts appear throughout the docs (quickstart, keyboard
 * shortcuts page, feature descriptions). A dedicated component keeps the
 * key-cap styling consistent and ensures the "+" separator is styled
 * differently from the key labels.
 *
 * HOW: Maps each key string to a <Kbd> element (see ui/Kbd.tsx), then
 * interleaves "+" separators between them using Array.reduce. Wraps the
 * result in an inline container for correct flow layout.
 *
 * Usage:
 *   <KeyboardShortcut keys={['⌘', 'K']} />
 *   <KeyboardShortcut keys={['Ctrl', 'Shift', 'P']} />
 */

import React from 'react';
import { Kbd } from '../ui/Kbd';

interface KeyboardShortcutProps {
  /** Ordered list of key labels to display. */
  keys: string[];
  /** Optional additional Tailwind classes for the wrapper. */
  className?: string;
}

/**
 * Displays a keyboard shortcut as a sequence of styled key-cap elements.
 * Keys are separated by a muted "+" character.
 */
export const KeyboardShortcut: React.FC<KeyboardShortcutProps> = ({
  keys,
  className = '',
}) => (
  <span
    className={['inline-flex items-center gap-1', className]
      .filter(Boolean)
      .join(' ')}
    aria-label={keys.join(' + ')}
  >
    {keys.map((key, index) => (
      <React.Fragment key={`${key}-${index}`}>
        {index > 0 && (
          <span className="text-[#525252] dark:text-[#555566] text-xs select-none" aria-hidden="true">
            +
          </span>
        )}
        <Kbd>{key}</Kbd>
      </React.Fragment>
    ))}
  </span>
);

export default KeyboardShortcut;
