/**
 * Pill — Small status badge/pill.
 *
 * WHY: Version badges, status indicators, and feature tags all need a
 * consistent pill shape. This component encodes the design system's five
 * semantic variants (default, accent, success, warning, danger) so each
 * usage site only needs to name the intent, not the hex color.
 *
 * HOW: Variant → class map applied to a span with rounded-full base styles.
 * The border is always present for visual clarity on dark backgrounds.
 */

import React from 'react';

type PillVariant = 'default' | 'accent' | 'success' | 'warning' | 'danger';

interface PillProps {
  children: React.ReactNode;
  /** Visual style variant. Defaults to 'default'. */
  variant?: PillVariant;
  /** Optional additional Tailwind classes. */
  className?: string;
}

/** Map each variant name to its Tailwind color classes. */
const variantClasses: Record<PillVariant, string> = {
  default: 'bg-[#f4f4f5] dark:bg-[#111118] text-[#525252] dark:text-[#8a8a9a] border-[#e4e4e7] dark:border-[#1e1e2e]',
  accent:  'bg-[#4a8af4]/10 text-[#4a8af4] border-[#4a8af4]/20',
  success: 'bg-[#2dd4a0]/10 text-[#2dd4a0] border-[#2dd4a0]/20',
  warning: 'bg-[#ebab40]/10 text-[#ebab40] border-[#ebab40]/20',
  danger:  'bg-[#e84c4c]/10 text-[#e84c4c] border-[#e84c4c]/20',
};

/**
 * A compact inline badge. Use `variant` to communicate semantic meaning.
 */
export const Pill: React.FC<PillProps> = ({
  children,
  variant = 'default',
  className = '',
}) => (
  <span
    className={[
      'px-2 py-0.5 rounded-full text-xs font-medium border inline-block',
      variantClasses[variant],
      className,
    ]
      .filter(Boolean)
      .join(' ')}
  >
    {children}
  </span>
);

export default Pill;
