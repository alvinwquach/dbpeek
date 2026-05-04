/**
 * PrivacyCallout — Highlighted callout for privacy-related information.
 *
 * WHY: dbpeek's core value proposition is privacy. When a section explains
 * a privacy guarantee (e.g. "no telemetry", "local-only"), this callout
 * box draws the reader's eye with the green success accent — the same color
 * used for read-only (safe) scope badges.
 *
 * HOW: Left-border accent with a tinted background. The header row uses the
 * Shield icon from lucide-react to reinforce the privacy theme visually.
 * Children are rendered verbatim so callers can pass any MDX content.
 *
 * Usage in MDX:
 *   <PrivacyCallout>
 *     dbpeek never sends your SQL queries over the network.
 *   </PrivacyCallout>
 */

import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface PrivacyCalloutProps {
  children: React.ReactNode;
  /** Optional custom title. Defaults to "Privacy". */
  title?: string;
}

/**
 * A green-accented callout box for privacy guarantees and safety notes.
 */
export const PrivacyCallout: React.FC<PrivacyCalloutProps> = ({
  children,
  title = 'Privacy',
}) => (
  <aside
    role="note"
    className="border-l-4 border-[#2dd4a0] bg-[#2dd4a0]/5 rounded-r-lg p-4 my-6"
  >
    {/* Header row: icon + label */}
    <div className="flex items-center gap-2 mb-2">
      <ShieldCheck
        size={16}
        className="text-[#2dd4a0] shrink-0"
        aria-hidden="true"
      />
      <span className="text-[#2dd4a0] text-sm font-semibold">{title}</span>
    </div>
    {/* Content area — inherits MDX prose styles from parent */}
    <div className="text-[#0a0a0f] dark:text-[#ededf0] text-sm leading-relaxed [&>p]:mb-0">
      {children}
    </div>
  </aside>
);

export default PrivacyCallout;
