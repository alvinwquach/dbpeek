/**
 * FeatureGrid — Grid of feature cards on overview and landing pages.
 *
 * WHY: Overview pages need a visually scannable layout to present multiple
 * features at once. A card grid is faster to scan than a prose list, and
 * clicking a card navigates to the relevant deep-dive page.
 *
 * HOW: Accepts an array of feature descriptors. Each card renders a title,
 * description, and optionally an icon. If `href` is provided, the entire
 * card becomes a clickable link. Internal hrefs use React Router <Link>;
 * external hrefs (starting with "http") use a plain <a> with target="_blank".
 *
 * Usage in MDX:
 *   <FeatureGrid features={[
 *     { title: "Privacy first", description: "No telemetry, ever.", href: "/privacy/model" },
 *     { title: "Fast", description: "Results in milliseconds." },
 *   ]} />
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

interface Feature {
  /** Card heading. */
  title: string;
  /** Supporting description shown below the title. */
  description: string;
  /** Optional Lucide icon component to display above the title. */
  icon?: React.ReactNode;
  /**
   * If provided, the card becomes a link.
   * Relative paths (no protocol) use React Router <Link>.
   * Absolute URLs use <a target="_blank">.
   */
  href?: string;
}

interface FeatureGridProps {
  features: Feature[];
  /** Override the default 2-column grid. E.g. "3" for a 3-column layout. */
  columns?: 1 | 2 | 3;
}

const columnClass: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 md:grid-cols-2',
  3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
};

/** The inner card content — shared between linked and non-linked cards. */
const CardContent: React.FC<{ feature: Feature; isExternal?: boolean }> = ({
  feature,
  isExternal = false,
}) => (
  <>
    {feature.icon && (
      <div className="text-[#4a8af4] mb-3" aria-hidden="true">
        {feature.icon}
      </div>
    )}
    <div className="flex items-start justify-between gap-2">
      <h3 className="text-[#0a0a0f] dark:text-[#ededf0] font-medium text-sm mb-2 leading-snug">
        {feature.title}
      </h3>
      {isExternal && (
        <ExternalLink
          size={12}
          className="text-[#555566] shrink-0 mt-0.5"
          aria-hidden="true"
        />
      )}
    </div>
    <p className="text-[#525252] dark:text-[#8a8a9a] text-sm leading-relaxed">{feature.description}</p>
  </>
);

/** Shared Tailwind classes for the card wrapper. */
const cardBase =
  'bg-[#f4f4f5] dark:bg-[#111118] border border-[#e4e4e7] dark:border-[#1e1e2e] rounded-lg p-5 transition-colors';
const cardHoverable =
  'hover:border-[#4a8af4]/40 cursor-pointer';

/**
 * A responsive grid of feature cards. Cards with an `href` are fully clickable.
 */
export const FeatureGrid: React.FC<FeatureGridProps> = ({
  features,
  columns = 2,
}) => (
  <div
    className={`grid ${columnClass[columns] ?? columnClass[2]} gap-4 my-6`}
  >
    {features.map((feature, index) => {
      // No link — static card
      if (!feature.href) {
        return (
          <div key={index} className={cardBase}>
            <CardContent feature={feature} />
          </div>
        );
      }

      // External link
      const isExternal =
        feature.href.startsWith('http://') ||
        feature.href.startsWith('https://') ||
        feature.href.startsWith('//');

      if (isExternal) {
        return (
          <a
            key={index}
            href={feature.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`${cardBase} ${cardHoverable} block no-underline`}
          >
            <CardContent feature={feature} isExternal />
          </a>
        );
      }

      // Internal link — React Router handles the /docs basename
      return (
        <Link
          key={index}
          to={feature.href}
          className={`${cardBase} ${cardHoverable} block no-underline`}
        >
          <CardContent feature={feature} />
        </Link>
      );
    })}
  </div>
);

export default FeatureGrid;
