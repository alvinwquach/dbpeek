/**
 * WarningCallout — Amber callout for write-mode and destructive operation warnings.
 *
 * WHY: Some features (write mode, full mode, DROP TABLE) are powerful but
 * potentially dangerous. An amber warning box that stands out from surrounding
 * prose ensures readers don't miss important caveats before trying a command.
 *
 * HOW: Mirrors PrivacyCallout structurally but uses the warning (#ebab40) color
 * palette. The TriangleAlert icon is a universally understood caution signal.
 *
 * Usage in MDX:
 *   <WarningCallout>
 *     Running in --full mode allows DROP and TRUNCATE statements.
 *   </WarningCallout>
 */

import React from 'react';
import { TriangleAlert } from 'lucide-react';

interface WarningCalloutProps {
  children: React.ReactNode;
  /** Optional custom title. Defaults to "Warning". */
  title?: string;
}

/**
 * An amber-accented callout box for important warnings and cautions.
 */
export const WarningCallout: React.FC<WarningCalloutProps> = ({
  children,
  title = 'Warning',
}) => (
  <aside
    role="alert"
    className="border-l-4 border-[#ebab40] bg-[#ebab40]/5 rounded-r-lg p-4 my-6"
  >
    {/* Header row: icon + label */}
    <div className="flex items-center gap-2 mb-2">
      <TriangleAlert
        size={16}
        className="text-[#ebab40] shrink-0"
        aria-hidden="true"
      />
      <span className="text-[#ebab40] text-sm font-semibold">{title}</span>
    </div>
    {/* Content area */}
    <div className="text-[#0a0a0f] dark:text-[#ededf0] text-sm leading-relaxed [&>p]:mb-0">
      {children}
    </div>
  </aside>
);

export default WarningCallout;
