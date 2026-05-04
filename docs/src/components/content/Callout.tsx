/**
 * Callout.tsx — Styled aside block for docs content.
 *
 * WHAT: A visually distinct block for notes, warnings, tips, and danger
 * notices. Used in MDX files as <Callout type="warning">...</Callout>.
 *
 * WHY: Callouts draw attention to important information that might be
 * missed in body text — e.g. security notes, breaking change warnings,
 * or tips for common patterns.
 *
 * HOW: Uses a left border + background tint in the appropriate semantic
 * color. The icon and color are determined by the `type` prop. All colors
 * use the design system's brand palette via Tailwind arbitrary values.
 *
 * Types:
 *   - info (default) — accent blue, general notes
 *   - success        — green, confirmation or "done" notes
 *   - warning        — amber, things to watch out for
 *   - danger         — red, data loss or security risks
 *
 * Usage in MDX:
 *   <Callout type="warning">
 *     Enabling `full` mode allows DDL statements including DROP TABLE.
 *   </Callout>
 */

import { type ReactNode } from 'react';
import { Info, CheckCircle, AlertTriangle, AlertOctagon } from 'lucide-react';

type CalloutType = 'info' | 'success' | 'warning' | 'danger';

interface CalloutProps {
  type?: CalloutType;
  /** Optional title displayed above the content in bold. */
  title?: string;
  children: ReactNode;
}

/** Per-type styling and icon mapping. */
const variants: Record<
  CalloutType,
  {
    border: string;
    bg: string;
    iconColor: string;
    titleColor: string;
    Icon: typeof Info;
  }
> = {
  info: {
    border: 'border-[#4a8af4]',
    bg: 'bg-[#4a8af4]/8',
    iconColor: 'text-[#4a8af4]',
    titleColor: 'text-[#4a8af4]',
    Icon: Info,
  },
  success: {
    border: 'border-[#2dd4a0]',
    bg: 'bg-[#2dd4a0]/8',
    iconColor: 'text-[#2dd4a0]',
    titleColor: 'text-[#2dd4a0]',
    Icon: CheckCircle,
  },
  warning: {
    border: 'border-[#ebab40]',
    bg: 'bg-[#ebab40]/8',
    iconColor: 'text-[#ebab40]',
    titleColor: 'text-[#ebab40]',
    Icon: AlertTriangle,
  },
  danger: {
    border: 'border-[#e84c4c]',
    bg: 'bg-[#e84c4c]/8',
    iconColor: 'text-[#e84c4c]',
    titleColor: 'text-[#e84c4c]',
    Icon: AlertOctagon,
  },
};

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const { border, bg, iconColor, titleColor, Icon } = variants[type];

  return (
    <aside
      className={[
        'my-6 flex gap-3 rounded-lg border-l-[3px] p-4',
        border,
        bg,
      ].join(' ')}
      role="note"
    >
      {/* Icon column */}
      <Icon
        size={18}
        className={['flex-shrink-0 mt-0.5', iconColor].join(' ')}
        aria-hidden="true"
      />

      {/* Content column */}
      <div className="min-w-0 flex-1">
        {title && (
          <p className={['mb-1 text-sm font-semibold', titleColor].join(' ')}>
            {title}
          </p>
        )}
        {/* Callout body text — slightly brighter than secondary for readability on tinted bg */}
        <div className="text-sm text-[#0a0a0f] dark:text-[#ededf0] [&>p]:mb-0 [&>p]:leading-6">
          {children}
        </div>
      </div>
    </aside>
  );
}
