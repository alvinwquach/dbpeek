/**
 * build-search-index.ts — Pre-build script that generates public/search-index.json.
 *
 * WHAT: Walks src/content/**\/*.mdx, extracts frontmatter and plain-text body,
 * and writes a JSON array of search documents to public/search-index.json.
 *
 * WHY build-time: Client-side indexing of 40+ pages on first load would block
 * the main thread for ~200ms. Pre-indexing at build time means the browser
 * just loads and queries a ready-made index — zero indexing cost per user.
 *
 * HOW:
 *   1. Walk src/content recursively for .mdx files.
 *   2. Parse each file with gray-matter to extract frontmatter (title, category,
 *      description, keywords) and the raw Markdown body.
 *   3. Strip MDX/Markdown syntax from the body to produce searchable plain text.
 *   4. Derive the slug from the file path (mirrors App.tsx route paths).
 *   5. Merge sidebar config keywords into each document's keywords field.
 *   6. Write the resulting SearchDoc[] array to public/search-index.json.
 *
 * The JSON format is a plain array — NOT FlexSearch's internal export format.
 * FlexSearch's import/export format changes between versions; a plain array
 * is portable and lets the client rebuild the in-memory index from it on the
 * first search.
 *
 * Run via: pnpm build:search-index  (or tsx scripts/build-search-index.ts)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'fs';
import { join, relative, extname, basename } from 'path';
import matter from 'gray-matter';
import { sidebar } from '../src/lib/sidebar-config.js';

/** Shape written to public/search-index.json — matches SearchDoc in search-client.ts. */
interface SearchDoc {
  slug: string;
  title: string;
  category: string;
  content: string;
  keywords?: string;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const CONTENT_DIR = new URL('../src/content', import.meta.url).pathname;
const PUBLIC_DIR = new URL('../public', import.meta.url).pathname;
const OUTPUT_FILE = join(PUBLIC_DIR, 'search-index.json');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Recursively collect all .mdx file paths under a directory.
 */
function walkMdx(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkMdx(fullPath));
    } else if (extname(entry) === '.mdx') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Convert a file path under src/content/ to the React Router slug used in App.tsx.
 *
 * Examples:
 *   src/content/index.mdx                           → "/"
 *   src/content/getting-started/installation.mdx   → "/getting-started/installation"
 *   src/content/advanced/architecture.mdx          → "/advanced/architecture"
 */
function filePathToSlug(filePath: string): string {
  // Get path relative to src/content, e.g. "getting-started/installation.mdx"
  const rel = relative(CONTENT_DIR, filePath);
  // Strip the .mdx extension
  const noExt = rel.replace(/\.mdx$/, '');

  // The root index page
  if (noExt === 'index') return '/';

  // All other pages: convert OS path separators to URL slashes
  return '/' + noExt.split('/').join('/');
}

/**
 * Strip MDX and Markdown syntax to produce plain searchable text.
 *
 * We remove (in order):
 *   - MDX import/export statements (JS code at the top of MDX files)
 *   - Fenced code blocks (``` ... ```) — code is too noisy for prose search
 *   - Inline code (`...`) — keep the text but remove backticks
 *   - HTML tags (e.g. <Callout>, <Steps>)
 *   - Markdown headings (#, ##, ###)
 *   - Bold/italic markers (**, *, __, _)
 *   - Markdown links [text](url) → keep text
 *   - Markdown images
 *   - Horizontal rules
 *   - Excess whitespace and blank lines
 *
 * This is intentionally simple regex-based stripping, not a full AST parse.
 * For a search index we care about recall (finding the page) not precision
 * (perfect sentence extraction), so "good enough" is genuinely good enough.
 */
function stripMdxToText(raw: string): string {
  let text = raw;

  // Remove MDX import/export statements
  text = text.replace(/^import\s+.*$/gm, '');
  text = text.replace(/^export\s+.*$/gm, '');

  // Remove fenced code blocks (```lang\n...\n```)
  text = text.replace(/```[\s\S]*?```/g, '');

  // Remove inline code — keep the text content
  text = text.replace(/`([^`]*)`/g, '$1');

  // Remove HTML/JSX tags
  text = text.replace(/<[^>]+>/g, '');

  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, '');

  // Remove bold and italic
  text = text.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, '$2');

  // Convert links to just their text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Remove image syntax
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // Remove horizontal rules
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '');

  // Collapse excess whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Build a flat keyword→slug lookup from the sidebar config so we can
 * attach sidebar keywords to each document.
 */
function buildKeywordMap(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const group of sidebar) {
    for (const item of group.items) {
      if (item.keywords && item.keywords.length > 0) {
        map.set(item.slug, item.keywords);
      }
    }
  }
  return map;
}

/**
 * Derive the sidebar group label for a given slug.
 * Used as the "category" field in search results.
 */
function getCategoryForSlug(slug: string): string {
  for (const group of sidebar) {
    if (group.items.some((item) => item.slug === slug)) {
      return group.label;
    }
  }
  return 'Docs';
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Building search index...');

  // Ensure public/ exists (it might not in a fresh checkout)
  mkdirSync(PUBLIC_DIR, { recursive: true });

  const mdxFiles = walkMdx(CONTENT_DIR);
  const keywordMap = buildKeywordMap();
  const docs: SearchDoc[] = [];

  for (const filePath of mdxFiles) {
    const raw = readFileSync(filePath, 'utf-8');
    const { data: frontmatter, content: body } = matter(raw);

    const slug = filePathToSlug(filePath);
    const plainText = stripMdxToText(body);

    /**
     * Title resolution priority:
     *   1. frontmatter.title — explicit, preferred
     *   2. First h1 in the body — derive from the # heading
     *   3. Filename — last resort fallback
     */
    let title: string = frontmatter.title as string ?? '';
    if (!title) {
      const h1Match = /^#\s+(.+)$/m.exec(body);
      title = h1Match ? h1Match[1].trim() : basename(filePath, '.mdx');
    }

    // Merge sidebar keywords with any frontmatter keywords
    const sidebarKeywords = keywordMap.get(slug) ?? [];
    const fmKeywords: string[] = Array.isArray(frontmatter.keywords)
      ? (frontmatter.keywords as string[])
      : [];
    const allKeywords = [...new Set([...sidebarKeywords, ...fmKeywords])];

    docs.push({
      slug,
      title,
      category: getCategoryForSlug(slug),
      content: plainText,
      keywords: allKeywords.length > 0 ? allKeywords.join(' ') : undefined,
    });

    console.log(`  ${slug} — "${title}"`);
  }

  // Sort by slug for deterministic output (makes git diffs readable)
  docs.sort((a, b) => a.slug.localeCompare(b.slug));

  writeFileSync(OUTPUT_FILE, JSON.stringify(docs, null, 2), 'utf-8');
  console.log(`\nSearch index written to public/search-index.json (${docs.length} pages)`);
}

main().catch((err) => {
  console.error('build-search-index failed:', err);
  process.exit(1);
});
