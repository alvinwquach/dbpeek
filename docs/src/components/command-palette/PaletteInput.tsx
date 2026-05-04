/**
 * PaletteInput — Search input row at the top of the command palette.
 *
 * WHY: The input needs a Search icon on the left and an ESC badge on the
 * right, with the text field in between. Putting this in its own component
 * keeps CommandPalette.tsx concise and makes the input easy to style or
 * replace independently.
 *
 * HOW: The input autofocuses via the `autoFocus` prop when the palette opens.
 * We use a controlled input — value and onChange are passed from the parent
 * hook. onKeyDown is forwarded so the palette's keyboard navigation handler
 * (usePalette.handleKeyDown) fires on every keypress.
 *
 * The 56px height matches the TopNav height for visual rhythm.
 */

import React, { useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

interface PaletteInputProps {
  /** Current search query (controlled). */
  value: string;
  /** Called whenever the user types. */
  onChange: (value: string) => void;
  /** Forwarded to the input element for palette keyboard navigation. */
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  /** Whether to autofocus the input on mount. Default true. */
  autoFocus?: boolean;
}

/**
 * The search input row for the command palette.
 * 56px tall, with a search icon on the left and ESC hint on the right.
 */
export const PaletteInput: React.FC<PaletteInputProps> = ({
  value,
  onChange,
  onKeyDown,
  autoFocus = true,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when the palette opens.
  useEffect(() => {
    if (autoFocus) {
      // Small delay ensures the modal animation doesn't steal the focus event.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [autoFocus]);

  return (
    <div
      className="flex items-center gap-3 px-4 border-b border-[#e4e4e7] dark:border-[#1e1e2e]"
      style={{ height: '56px' }}
    >
      {/* Search icon */}
      <Search
        size={18}
        className="text-[#555566] shrink-0"
        aria-hidden="true"
      />

      {/* Text input */}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-label="Search documentation"
        placeholder="Search docs..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={[
          'flex-1 bg-transparent text-[#0a0a0f] dark:text-[#ededf0] text-sm placeholder:text-[#525252] dark:placeholder:text-[#555566]',
          'outline-none border-none ring-0 focus:ring-0',
          'min-w-0',
        ].join(' ')}
        autoComplete="off"
        spellCheck={false}
      />

      {/* ESC hint badge */}
      <kbd
        className={[
          'hidden sm:inline-flex items-center justify-center',
          'px-1.5 py-0.5 rounded text-xs font-mono',
          'bg-[#f4f4f5] dark:bg-[#0d0d14] border border-[#e4e4e7] dark:border-[#1e1e2e] text-[#525252] dark:text-[#555566]',
          'shrink-0 select-none',
        ].join(' ')}
        aria-hidden="true"
      >
        ESC
      </kbd>
    </div>
  );
};

export default PaletteInput;
