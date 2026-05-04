/**
 * EditOnGitHub — Link to edit the current page on GitHub.
 *
 * WHY: Open-source docs should be easy to contribute to. A direct "Edit
 * this page" link at the bottom of every page removes friction for people
 * who spot a typo or want to add an example.
 *
 * HOW: Derives the GitHub edit URL from the current React Router pathname.
 * The MDX source files live at docs/src/content/{path}.mdx in the repo,
 * mirroring the route structure. The link targets the `main` branch.
 *
 * Route "/"       → docs/src/content/index.mdx
 * Route "/foo/bar"→ docs/src/content/foo/bar.mdx
 *
 * Opens in a new tab since it exits the docs site entirely.
 */

import React from 'react';
import { useLocation } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';

const GITHUB_BASE =
  'https://github.com/alvinwquach/dbpeek/edit/main/docs/src/content';

/**
 * Converts a React Router pathname into a GitHub edit URL for the .mdx source.
 */
function buildEditUrl(pathname: string): string {
  // "/" → /index.mdx; "/getting-started/installation" → /getting-started/installation.mdx
  const path = pathname === '/' ? '/index' : pathname;
  return `${GITHUB_BASE}${path}.mdx`;
}

/**
 * A small "Edit this page on GitHub" link shown at the bottom of each doc.
 */
export const EditOnGitHub: React.FC = () => {
  const { pathname } = useLocation();
  const editUrl = buildEditUrl(pathname);

  return (
    <a
      href={editUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-[#525252] dark:text-[#8a8a9a] hover:text-[#4a8af4] transition-colors"
    >
      <ExternalLink size={14} aria-hidden="true" />
      Edit this page on GitHub
    </a>
  );
};

export default EditOnGitHub;
