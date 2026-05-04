/**
 * ScopeBadge — Shows which permission mode a feature requires.
 *
 * WHY: dbpeek operates in three permission modes. Inline visual indicators
 * help readers immediately understand whether a command is safe (read-only)
 * or requires elevated flags before running.
 *
 * HOW: Three variants map directly to dbpeek's --write and --full CLI flags.
 * - read-only: green — safe default, no extra flags needed
 * - write:     amber — requires passing --write
 * - full:      red   — requires passing --full (destructive operations)
 */

import React from 'react';

type ScopeMode = 'read-only' | 'write' | 'full';

interface ScopeBadgeProps {
  /** The permission mode this badge represents. */
  mode: ScopeMode;
  /** Optional additional Tailwind classes. */
  className?: string;
}

/** Tailwind classes for each permission mode. */
const modeClasses: Record<ScopeMode, string> = {
  'read-only': 'bg-[#2dd4a0]/10 text-[#2dd4a0] border border-[#2dd4a0]/20',
  write:       'bg-[#ebab40]/10 text-[#ebab40] border border-[#ebab40]/20',
  full:        'bg-[#e84c4c]/10 text-[#e84c4c] border border-[#e84c4c]/20',
};

/** Human-readable labels matching the dbpeek CLI flag names. */
const modeLabels: Record<ScopeMode, string> = {
  'read-only': 'read-only',
  write:       'write',
  full:        'full',
};

/**
 * An inline pill badge indicating the required permission scope.
 * Use next to headings or feature descriptions to signal safety level.
 */
export const ScopeBadge: React.FC<ScopeBadgeProps> = ({ mode, className = '' }) => (
  <span
    className={[
      'px-2 py-0.5 rounded text-xs font-medium font-mono inline-block',
      modeClasses[mode],
      className,
    ]
      .filter(Boolean)
      .join(' ')}
    title={`Requires ${mode === 'read-only' ? 'no extra' : `--${mode}`} flag`}
  >
    {modeLabels[mode]}
  </span>
);

export default ScopeBadge;
